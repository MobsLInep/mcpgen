/**
 * Unit tests for the LLM boundary: env resolution (never hardcoded), the mock
 * client, and the Anthropic client adapter's response-flattening.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createAnthropicClient,
  DEFAULT_MODEL,
  MissingApiKeyError,
  MockLlmClient,
  resolveApiKey,
  resolveModel,
} from "./llm.js";

describe("resolveApiKey", () => {
  it("prefers MCPGEN_ANTHROPIC_API_KEY, then ANTHROPIC_API_KEY", () => {
    expect(
      resolveApiKey({ MCPGEN_ANTHROPIC_API_KEY: "a", ANTHROPIC_API_KEY: "b" }),
    ).toBe("a");
    expect(resolveApiKey({ ANTHROPIC_API_KEY: "b" })).toBe("b");
  });

  it("throws MissingApiKeyError when no key is present", () => {
    expect(() => resolveApiKey({})).toThrow(MissingApiKeyError);
  });
});

describe("resolveModel", () => {
  it("reads MCPGEN_MODEL and falls back to the default", () => {
    expect(resolveModel({ MCPGEN_MODEL: "claude-x" })).toBe("claude-x");
    expect(resolveModel({})).toBe(DEFAULT_MODEL);
  });
});

describe("MockLlmClient", () => {
  it("returns canned text by tag and throws on unknown tags", async () => {
    const client = new MockLlmClient({ plan: "PLAN" }, "mock-x");
    expect(client.model).toBe("mock-x");
    const res = await client.complete({
      tag: "plan",
      messages: [{ role: "user", content: "x" }],
    });
    expect(res.text).toBe("PLAN");
    // complete() throws synchronously on an unknown tag.
    expect(() =>
      client.complete({
        tag: "missing",
        messages: [{ role: "user", content: "x" }],
      }),
    ).toThrow(/no response for tag "missing"/);
  });
});

describe("createAnthropicClient", () => {
  it("flattens text blocks and passes through model + request fields", async () => {
    const create = vi.fn(async () => ({
      content: [
        { type: "text", text: "Hello " },
        { type: "tool_use", id: "x" }, // non-text blocks are ignored
        { type: "text", text: "world" },
      ],
    }));
    // Stub the SDK module so no network/key is needed.
    vi.doMock("@anthropic-ai/sdk", () => ({
      default: class {
        messages = { create };
        constructor(public opts: unknown) {}
      },
    }));

    const client = await createAnthropicClient({
      apiKey: "k",
      model: "claude-test",
    });
    expect(client.model).toBe("claude-test");
    const res = await client.complete({
      tag: "plan",
      system: "sys",
      maxTokens: 100,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res.text).toBe("Hello world");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-test",
        max_tokens: 100,
        system: "sys",
      }),
    );
    vi.doUnmock("@anthropic-ai/sdk");
  });
});
