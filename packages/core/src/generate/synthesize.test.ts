/**
 * Unit tests for per-tool synthesis: the deterministic IR fallback for every
 * parameter location and protocol, plus the LLM path (validated, one retry,
 * then fallback).
 */
import { describe, expect, it } from "vitest";
import type { ToolCandidate } from "../ir.js";
import { MockLlmClient } from "./llm.js";
import type { PlannedTool } from "./plan.js";
import {
  buildHandlerBody,
  buildInputShape,
  fallbackSynthesize,
  synthesizeTool,
} from "./synthesize.js";

function httpCandidate(overrides: Partial<ToolCandidate> = {}): ToolCandidate {
  return {
    name: "doThing",
    description: "Do a thing",
    operation: { protocol: "http", method: "POST", path: "/things/{id}" },
    parameters: [
      {
        name: "id",
        location: "path",
        required: true,
        schema: { type: "string" },
      },
      {
        name: "limit",
        location: "query",
        required: false,
        schema: { type: "integer" },
      },
      {
        name: "X-Trace",
        location: "header",
        required: false,
        schema: { type: "string" },
      },
      {
        name: "body",
        location: "body",
        required: true,
        schema: { type: "object" },
      },
    ],
    inputSchema: { type: "object" },
    auth: [],
    confidence: 0.99,
    provenance: { sourceKind: "openapi", locator: "POST /things/{id}" },
    ...overrides,
  };
}

const planned: PlannedTool = {
  sourceName: "doThing",
  toolName: "do_thing",
  title: "Do thing",
  description: "Do a thing",
};

describe("buildInputShape", () => {
  it("returns {} for a no-parameter tool", () => {
    expect(buildInputShape(httpCandidate({ parameters: [] }))).toBe("{}");
  });

  it("emits a raw shape with optionality and descriptions", () => {
    const shape = buildInputShape(
      httpCandidate({
        parameters: [
          {
            name: "id",
            location: "path",
            required: true,
            schema: { type: "string" },
            description: "the id",
          },
          {
            name: "limit",
            location: "query",
            required: false,
            schema: { type: "integer" },
          },
        ],
      }),
    );
    expect(shape).toContain('id: z.string().describe("the id"),');
    expect(shape).toContain("limit: z.number().int().optional(),");
  });
});

describe("buildHandlerBody (http)", () => {
  it("routes every parameter location into the request spec safely", () => {
    const body = buildHandlerBody(httpCandidate());
    expect(body).toContain('method: "POST"');
    expect(body).toContain('path: "/things/{id}"');
    expect(body).toContain("pathParams: { id: args.id }");
    expect(body).toContain("query: { limit: args.limit }");
    expect(body).toContain('headers: { "X-Trace": String(args["X-Trace"]) }');
    expect(body).toContain("body: args.body");
    expect(body).toContain("isError: res.status >= 400");
    // Never interpolates input into a URL — only structured fields.
    expect(body).not.toMatch(/`.*\$\{args/);
  });
});

describe("buildHandlerBody (graphql)", () => {
  it("posts the operation with variables", () => {
    const gql = httpCandidate({
      operation: { protocol: "graphql", operation: "query", field: "things" },
      parameters: [
        {
          name: "first",
          location: "arg",
          required: true,
          schema: { type: "integer" },
        },
      ],
    });
    const body = buildHandlerBody(gql);
    expect(body).toContain('method: "POST"');
    expect(body).toContain('query: "query { things }"');
    expect(body).toContain("variables: { first: args.first }");
  });
});

describe("fallbackSynthesize", () => {
  it("marks output as fallback", () => {
    const code = fallbackSynthesize(httpCandidate());
    expect(code.fallback).toBe(true);
    expect(code.inputShape.startsWith("{")).toBe(true);
    expect(code.handlerBody).toContain("ctx.http.request");
  });
});

describe("synthesizeTool", () => {
  it("uses the deterministic fallback when no client is given", async () => {
    const code = await synthesizeTool(undefined, httpCandidate(), planned);
    expect(code.fallback).toBe(true);
  });

  it("accepts valid LLM output", async () => {
    const llm = JSON.stringify({
      inputShape: "{ id: z.string() }",
      handlerBody:
        '  return { content: [{ type: "text", text: await ctx.http.request({ method: "GET", path: "/" }).then(r => JSON.stringify(r)) }] };',
    });
    const client = new MockLlmClient({ "tool.doThing": llm });
    const code = await synthesizeTool(client, httpCandidate(), planned);
    expect(code.fallback).toBe(false);
    expect(code.inputShape).toBe("{ id: z.string() }");
  });

  it("falls back when the model output is invalid both times", async () => {
    // Missing ctx.http + return → parseToolCode rejects; retry returns same →
    // synthesizeTool falls back to the deterministic synthesizer.
    const client = new MockLlmClient({
      "tool.doThing": '{"inputShape":"{}","handlerBody":"noop"}',
    });
    const code = await synthesizeTool(client, httpCandidate(), planned);
    expect(code.fallback).toBe(true);
  });

  it("falls back when the model returns non-JSON", async () => {
    const client = new MockLlmClient({
      "tool.doThing": "I cannot help with that.",
    });
    const code = await synthesizeTool(client, httpCandidate(), planned);
    expect(code.fallback).toBe(true);
  });

  it("rejects an inputShape that is not an object literal, then falls back", async () => {
    const llm = JSON.stringify({
      inputShape: "z.string()", // not a `{...}` shape
      handlerBody: "  return ctx.http.request({}); return;",
    });
    const client = new MockLlmClient({ "tool.doThing": llm });
    const code = await synthesizeTool(client, httpCandidate(), planned);
    expect(code.fallback).toBe(true);
  });
});
