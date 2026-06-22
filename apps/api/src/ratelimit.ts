/**
 * @fileoverview A tiny in-memory, per-IP fixed-window rate limiter.
 *
 * No external store — this service is single-process, so a `Map` keyed by IP is
 * enough. Buckets are lazily pruned on access; there is no background timer.
 */

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /** Max requests allowed per window. */
  readonly max: number;
  /** Clock injection for tests. */
  readonly now?: () => number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  /** Requests remaining in the current window. */
  readonly remaining: number;
  /** Epoch ms when the current window resets. */
  readonly resetAt: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Create a limiter; call `.check(ip)` per request. */
export function createRateLimiter(options: RateLimitOptions) {
  const { windowMs, max } = options;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  return {
    check(ip: string): RateLimitResult {
      const t = now();
      let bucket = buckets.get(ip);
      if (!bucket || bucket.resetAt <= t) {
        bucket = { count: 0, resetAt: t + windowMs };
        buckets.set(ip, bucket);
      }
      // Opportunistically prune a few expired buckets to bound memory.
      if (buckets.size > 1000) {
        for (const [key, b] of buckets) {
          if (b.resetAt <= t) buckets.delete(key);
        }
      }
      if (bucket.count >= max) {
        return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
      }
      bucket.count += 1;
      return {
        allowed: true,
        remaining: max - bucket.count,
        resetAt: bucket.resetAt,
      };
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
