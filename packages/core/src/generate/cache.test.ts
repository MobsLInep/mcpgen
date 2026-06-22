/**
 * Unit tests for the response cache + recorded-fixture replay clients.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { LlmClient, LlmRequest } from "./llm.js";
import {
  cachingClient,
  FileResponseStore,
  hashRequest,
  MemoryResponseStore,
  ScriptedLlmClient,
} from "./cache.js";

const req = (overrides: Partial<LlmRequest> = {}): LlmRequest => ({
  tag: "plan",
  system: "sys",
  messages: [{ role: "user", content: "hi" }],
  ...overrides,
});

const tmpDirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "mcpgen-cache-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe("hashRequest", () => {
  it("is deterministic and 32 hex chars", () => {
    const a = hashRequest("m", req());
    const b = hashRequest("m", req());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it("changes with model, system, or message content", () => {
    const base = hashRequest("m", req());
    expect(hashRequest("other", req())).not.toBe(base);
    expect(hashRequest("m", req({ system: "different" }))).not.toBe(base);
    expect(
      hashRequest("m", req({ messages: [{ role: "user", content: "bye" }] })),
    ).not.toBe(base);
  });
});

describe("MemoryResponseStore", () => {
  it("round-trips values and misses on unknown keys", () => {
    const store = new MemoryResponseStore();
    expect(store.get("k")).toBeUndefined();
    store.set("k", "v");
    expect(store.get("k")).toBe("v");
  });
});

describe("FileResponseStore", () => {
  it("persists values as JSON files keyed by hash", () => {
    const dir = freshDir();
    const store = new FileResponseStore(dir);
    expect(store.get("missing")).toBeUndefined();
    store.set("abc", "recorded text");
    expect(store.get("abc")).toBe("recorded text");
    // A second store over the same dir sees the persisted value.
    expect(new FileResponseStore(dir).get("abc")).toBe("recorded text");
  });
});

describe("cachingClient", () => {
  it("fetches once, then serves from the cache (and records)", async () => {
    const complete = vi.fn(async () => ({ text: "answer" }));
    const inner: LlmClient = { model: "m", complete };
    const store = new MemoryResponseStore();
    const cached = cachingClient(inner, store);

    const first = await cached.complete(req());
    const second = await cached.complete(req());
    expect(first.text).toBe("answer");
    expect(second.text).toBe("answer");
    expect(complete).toHaveBeenCalledTimes(1); // second served from cache
    // The recorded value is keyed by the request hash.
    expect(store.get(hashRequest("m", req()))).toBe("answer");
    expect(cached.model).toBe("m");
  });

  it("re-fetches for a materially different request", async () => {
    const complete = vi.fn(async (r: LlmRequest) => ({ text: r.tag }));
    const cached = cachingClient(
      { model: "m", complete },
      new MemoryResponseStore(),
    );
    await cached.complete(req({ tag: "a", system: "a" }));
    await cached.complete(req({ tag: "b", system: "b" }));
    expect(complete).toHaveBeenCalledTimes(2);
  });
});

describe("ScriptedLlmClient", () => {
  it("replays a recorded fixture by tag", async () => {
    const dir = freshDir();
    new FileResponseStore(dir); // ensure dir exists
    // write a fixture file directly via the store's path convention
    const store = new ScriptedLlmClient(dir);
    // Use FileResponseStore-independent fixture: ScriptedLlmClient reads <tag>.json
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(dir, "plan.json"), JSON.stringify({ text: "scripted" }));
    const res = await store.complete(req({ tag: "plan" }));
    expect(res.text).toBe("scripted");
    expect(store.model).toBe("scripted-model");
  });

  it("throws a helpful error for a missing fixture", () => {
    const dir = freshDir();
    const client = new ScriptedLlmClient(dir);
    // complete() throws synchronously when the fixture file is absent.
    expect(() => client.complete(req({ tag: "nope" }))).toThrow(
      /no recorded fixture for tag "nope"/,
    );
  });
});
