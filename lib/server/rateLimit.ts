/**
 * Token-bucket rate limiter keyed by client (IP). In-memory and per serverless
 * instance: it stops one browser or script from draining the shared LLM quota,
 * but is not a distributed limiter. Memory is bounded by `maxKeys`.
 */
export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
}

export interface RateLimiter {
  take(key: string, now?: number): RateLimitResult;
  size(): number;
}

export function createRateLimiter({
  capacity,
  refillPerSec,
  maxKeys,
}: {
  capacity: number;
  refillPerSec: number;
  maxKeys: number;
}): RateLimiter {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return {
    take(key, now = Date.now()) {
      const prev = buckets.get(key) ?? { tokens: capacity, at: now };
      const tokens = Math.min(capacity, prev.tokens + ((now - prev.at) / 1000) * refillPerSec);
      buckets.delete(key);
      if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value as string);
      if (tokens < 1) {
        buckets.set(key, { tokens, at: now });
        return { ok: false, retryAfterSec: Math.ceil((1 - tokens) / refillPerSec) };
      }
      buckets.set(key, { tokens: tokens - 1, at: now });
      return { ok: true, retryAfterSec: 0 };
    },
    size: () => buckets.size,
  };
}
