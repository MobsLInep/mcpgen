import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./ratelimit.js";

describe("rate limiter", () => {
  it("allows up to max per window, then blocks", () => {
    const now = 1_000;
    const limiter = createRateLimiter({
      windowMs: 1000,
      max: 3,
      now: () => now,
    });
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
  });

  it("tracks buckets per IP independently", () => {
    const now = 0;
    const limiter = createRateLimiter({
      windowMs: 1000,
      max: 1,
      now: () => now,
    });
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("b").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
  });

  it("resets after the window elapses", () => {
    let now = 0;
    const limiter = createRateLimiter({
      windowMs: 1000,
      max: 1,
      now: () => now,
    });
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
    now += 1001;
    expect(limiter.check("a").allowed).toBe(true);
  });
});
