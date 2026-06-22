/**
 * Unit tests for the planning stage: JSON extraction, validation against the
 * IR, name de-duplication, and the single corrective retry.
 */
import { describe, expect, it } from "vitest";
import type { ParseResult } from "../ir.js";
import { MockLlmClient } from "./llm.js";
import { extractJson, PlanValidationError, runPlan } from "./plan.js";

const ir: ParseResult = {
  metadata: { kind: "openapi", title: "Demo", toolCount: 2 },
  tools: [
    {
      name: "listThings",
      description: "List things",
      operation: { protocol: "http", method: "GET", path: "/things" },
      parameters: [],
      inputSchema: { type: "object" },
      auth: [],
      confidence: 0.99,
      provenance: { sourceKind: "openapi", locator: "GET /things" },
    },
    {
      name: "getThing",
      description: "Get a thing",
      operation: { protocol: "http", method: "GET", path: "/things/{id}" },
      parameters: [
        {
          name: "id",
          location: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      auth: [],
      confidence: 0.99,
      provenance: { sourceKind: "openapi", locator: "GET /things/{id}" },
    },
  ],
};

const validPlan = JSON.stringify({
  serverName: "demo-mcp",
  serverDescription: "A demo MCP server",
  tools: [
    {
      sourceName: "listThings",
      toolName: "list_things",
      title: "List",
      description: "List things",
    },
    {
      sourceName: "getThing",
      toolName: "get_thing",
      title: "Get",
      description: "Get a thing",
    },
  ],
});

describe("extractJson", () => {
  it("extracts a bare JSON object", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it("extracts from a markdown fence", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("extracts the first balanced object amid prose", () => {
    expect(extractJson('Sure! {"a":{"b":2}} done')).toBe('{"a":{"b":2}}');
  });

  it("ignores braces inside strings", () => {
    expect(extractJson('{"a":"}{"}')).toBe('{"a":"}{"}');
  });

  it("throws when there is no object", () => {
    expect(() => extractJson("no json here")).toThrow(/no JSON object/);
  });

  it("throws on an unbalanced object", () => {
    expect(() => extractJson('{"a": 1')).toThrow(/unbalanced/);
  });
});

describe("runPlan", () => {
  it("accepts a valid plan", async () => {
    const client = new MockLlmClient({ plan: validPlan });
    const plan = await runPlan(client, ir);
    expect(plan.serverName).toBe("demo-mcp");
    expect(plan.tools.map((t) => t.toolName)).toEqual([
      "list_things",
      "get_thing",
    ]);
  });

  it("de-duplicates colliding tool names", async () => {
    const dupe = JSON.stringify({
      serverName: "x-mcp",
      serverDescription: "d",
      tools: [
        {
          sourceName: "listThings",
          toolName: "go",
          title: "a",
          description: "a",
        },
        {
          sourceName: "getThing",
          toolName: "go",
          title: "b",
          description: "b",
        },
      ],
    });
    const plan = await runPlan(new MockLlmClient({ plan: dupe }), ir);
    expect(plan.tools.map((t) => t.toolName)).toEqual(["go", "go_2"]);
  });

  it("rejects an unknown sourceName, then succeeds on the corrective retry", async () => {
    // MockLlmClient returns the same text for the tag both times, so to exercise
    // the retry path we make the first response invalid and rely on a stateful
    // client.
    let calls = 0;
    const client = {
      model: "m",
      complete: async () => {
        calls += 1;
        return {
          text:
            calls === 1
              ? JSON.stringify({
                  serverName: "x-mcp",
                  serverDescription: "d",
                  tools: [
                    {
                      sourceName: "ghost",
                      toolName: "g",
                      title: "g",
                      description: "g",
                    },
                  ],
                })
              : validPlan,
        };
      },
    };
    const plan = await runPlan(client, ir);
    expect(calls).toBe(2);
    expect(plan.tools).toHaveLength(2);
  });

  it("surfaces a PlanValidationError when the retry also fails", async () => {
    const bad = JSON.stringify({
      serverName: "",
      serverDescription: "",
      tools: [],
    });
    await expect(
      runPlan(new MockLlmClient({ plan: bad }), ir),
    ).rejects.toBeInstanceOf(PlanValidationError);
  });

  it("propagates non-validation errors without retrying", async () => {
    const client = {
      model: "m",
      complete: async () => {
        throw new Error("network down");
      },
    };
    await expect(runPlan(client, ir)).rejects.toThrow("network down");
  });
});
