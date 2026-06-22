/**
 * @fileoverview The pluggable mock-upstream layer.
 *
 * During the smoke-call stage the generated server makes real HTTP calls to its
 * configured base URL. To keep verification hermetic — we never hit a real
 * third-party API — the verifier points the server at a tiny local mock instead
 * (via `MCPGEN_API_BASE_URL`). The default {@link openApiExampleMock} derives
 * canned responses from the IR's output schemas, but the whole layer is behind
 * the {@link MockUpstreamFactory} type so a caller can swap in any mock.
 */
import { createServer } from "node:http";
import type { ParseResult } from "../ir.js";
import type { Plan } from "../generate/plan.js";
import { sampleFromSchema } from "./sample.js";

/** A running mock upstream the generated server can call. */
export interface UpstreamMock {
  /** Base URL to set as `MCPGEN_API_BASE_URL` for the server under test. */
  readonly url: string;
  /** Shut the mock down. */
  close(): Promise<void>;
}

/** Something that can be started to yield an {@link UpstreamMock}. */
export interface MockUpstream {
  start(): Promise<UpstreamMock>;
}

/**
 * Builds a {@link MockUpstream} for a generated project. Pluggable so callers can
 * substitute a recording proxy, a contract mock, etc. — the verifier only needs
 * `start()`/`close()`.
 */
export type MockUpstreamFactory = (
  result: ParseResult,
  plan: Plan,
) => MockUpstream;

/** A single matchable upstream route with its canned response. */
interface Route {
  readonly method: string;
  readonly regex: RegExp;
  readonly status: number;
  readonly body: unknown;
}

/** Turn a path template (`/pets/{petId}`) into a matcher for concrete paths. */
function pathToRegex(template: string): RegExp {
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `\{name\}` (post-escape) becomes a non-slash segment matcher.
  const pattern = escaped.replace(/\\\{[^}]+\\\}/g, "[^/]+");
  return new RegExp(`^${pattern}/?$`);
}

/** Conventional success status for a method (DELETE → 204 No Content). */
function statusForMethod(method: string): number {
  switch (method) {
    case "POST":
      return 201;
    case "DELETE":
      return 204;
    default:
      return 200;
  }
}

/**
 * The default mock: for every HTTP tool in the IR it registers a route whose
 * response body is sampled from the operation's output schema (an
 * OpenAPI-example-shaped value), returned with a conventional success status.
 * Unmatched requests still get a benign `200 { "mock": true }` so a slightly
 * off path never masquerades as a server bug.
 */
export const openApiExampleMock: MockUpstreamFactory = (result) => ({
  async start(): Promise<UpstreamMock> {
    const routes: Route[] = [];
    for (const tool of result.tools) {
      if (tool.operation.protocol !== "http") continue;
      routes.push({
        method: tool.operation.method,
        regex: pathToRegex(tool.operation.path),
        status: statusForMethod(tool.operation.method),
        body: tool.outputSchema
          ? sampleFromSchema(tool.outputSchema, { includeOptional: true })
          : { ok: true },
      });
    }

    const server = createServer((req, res) => {
      // Always drain the request body so sockets close cleanly.
      req.resume();
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      const method = req.method ?? "GET";
      const route = routes.find((r) => r.method === method && r.regex.test(path));
      const status = route?.status ?? 200;
      if (status === 204) {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(route ? route.body : { mock: true, path }));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port =
      address && typeof address === "object" ? address.port : 0;

    return {
      url: `http://127.0.0.1:${port}`,
      close: () =>
        new Promise<void>((resolve, reject) =>
          server.close((err) => (err ? reject(err) : resolve())),
        ),
    };
  },
});
