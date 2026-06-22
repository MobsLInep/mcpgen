import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApiServer } from "./server.js";
import type { JobEvent } from "./protocol.js";

const PETSTORE = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Petstore", version: "1.0.0" },
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        responses: { "200": { description: "ok" } },
      },
      post: {
        operationId: "createPet",
        responses: { "201": { description: "ok" } },
      },
    },
  },
});

let server: Server;
let base: string;

beforeAll(async () => {
  server = createApiServer({ fake: true });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

describe("mcpgen API", () => {
  it("reports health and the active runner", async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; runner: string };
    expect(body.status).toBe("ok");
    expect(body.runner).toBe("fake");
  });

  it("parses an OpenAPI spec into tools", async () => {
    const res = await fetch(`${base}/api/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: PETSTORE }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      kind: string;
      tools: { name: string }[];
    };
    expect(body.kind).toBe("openapi");
    expect(body.tools.map((t) => t.name)).toContain("listPets");
  });

  it("rejects an unrecognizable source with a 400", async () => {
    const res = await fetch(`${base}/api/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "this is not a spec" }),
    });
    expect(res.status).toBe(400);
  });

  it("runs a generation job to completion and serves a zip", async () => {
    const create = await fetch(`${base}/api/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: PETSTORE,
        transport: "stdio",
        auth: "none",
        verify: true,
      }),
    });
    expect(create.status).toBe(202);
    const { id } = (await create.json()) as { id: string };

    // Drive the job via the SSE stream.
    const events = await collectEvents(`${base}/api/jobs/${id}/events`);
    const types = events.map((e) => e.type);
    expect(types).toContain("stage");
    expect(types).toContain("done");
    // Both generate and verify stages were streamed.
    const stages = events.filter((e) => e.type === "stage");
    expect(stages.some((e) => e.type === "stage" && e.group === "verify")).toBe(
      true,
    );

    const done = events.find((e) => e.type === "done");
    expect(done && done.type === "done" && done.summary.toolCount).toBe(2);

    // Files + zip are available.
    const files = (await (
      await fetch(`${base}/api/jobs/${id}/files`)
    ).json()) as Record<string, string>;
    expect(Object.keys(files)).toContain("src/server.ts");

    const zip = await fetch(`${base}/api/jobs/${id}/download`);
    expect(zip.headers.get("content-type")).toBe("application/zip");
    const buf = Buffer.from(await zip.arrayBuffer());
    expect(buf.subarray(0, 2).toString()).toBe("PK"); // zip magic

    // Config endpoint returns an mcpServers entry.
    const config = (await (
      await fetch(`${base}/api/jobs/${id}/config`)
    ).json()) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(config.mcpServers).length).toBe(1);
  });

  it("rate-limits excessive parse requests by IP", async () => {
    // The limiter allows 20 writes/min; the earlier tests already consumed a
    // few, so 25 fresh attempts must trip it.
    let limited = false;
    for (let i = 0; i < 25; i++) {
      const res = await fetch(`${base}/api/parse`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: PETSTORE }),
      });
      if (res.status === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });
});

/** Read an SSE stream to completion, returning the parsed events. */
async function collectEvents(url: string): Promise<JobEvent[]> {
  const res = await fetch(url);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: JobEvent[] = [];
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (line) events.push(JSON.parse(line.slice(6)) as JobEvent);
    }
  }
  return events;
}
