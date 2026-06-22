import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isLowConfidence } from "../ir.js";
import { codeSource } from "./code.js";

const repo = (name: string): string =>
  fileURLToPath(new URL(`../../test/fixtures/repo/${name}`, import.meta.url));

describe("codeSource", () => {
  it("detects Express route registrations", async () => {
    const { metadata, tools } = await codeSource(repo("express")).parse();

    expect(metadata.kind).toBe("repo");
    expect(tools).toHaveLength(5);

    const bindings = tools.map((t) =>
      t.operation.protocol === "http"
        ? `${t.operation.method} ${t.operation.path}`
        : t.operation.field,
    );
    expect(bindings.sort()).toEqual([
      "DELETE /users/:id",
      "GET /health",
      "GET /users/:id",
      "POST /users",
      "PUT /users/:id",
    ]);

    // Every code candidate is best-effort / low confidence.
    expect(tools.every(isLowConfidence)).toBe(true);

    // Path params are extracted; provenance points at file:line.
    const showUser = tools.find(
      (t) =>
        t.operation.protocol === "http" &&
        t.operation.method === "GET" &&
        t.operation.path === "/users/:id",
    );
    expect(showUser?.parameters).toEqual([
      {
        name: "id",
        location: "path",
        required: true,
        schema: { type: "string" },
      },
    ]);
    expect(showUser?.provenance.file).toBe("app.ts");
    expect(showUser?.provenance.line).toBeGreaterThan(0);

    // Write methods get an opaque body parameter.
    const createUser = tools.find(
      (t) => t.operation.protocol === "http" && t.operation.method === "POST",
    );
    expect(createUser?.parameters.some((p) => p.location === "body")).toBe(
      true,
    );
  });

  it("detects Fastify method calls and the route() object form", async () => {
    const { tools } = await codeSource(repo("fastify")).parse();

    const bindings = tools
      .map((t) =>
        t.operation.protocol === "http"
          ? `${t.operation.method} ${t.operation.path}`
          : "",
      )
      .sort();
    expect(bindings).toEqual([
      "DELETE /items/:itemId",
      "GET /items/:itemId",
      "GET /ping",
      "POST /items",
    ]);

    // The object form (fastify.route) is found and confirmed as fastify.
    const del = tools.find(
      (t) => t.operation.protocol === "http" && t.operation.method === "DELETE",
    );
    expect(del?.operation).toMatchObject({ path: "/items/:itemId" });
    expect(del?.confidence).toBe(0.6);
  });
});
