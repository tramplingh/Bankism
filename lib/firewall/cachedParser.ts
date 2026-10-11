/**
 * Caches the LLM *parse* (never the verdict) for identical normalized inputs.
 * The policy engine still re-checks every request against current account state,
 * so a cached parse cannot approve anything the policy would not. Failures are
 * not cached, so a transient 429/503 is retried on the next request.
 */
import { createHash } from "node:crypto";
import { createTtlCache } from "../server/ttlCache";
import type { ParserFn } from "./pipeline";
import { ParsedRequest } from "../types";

export function withParseCache(
  parse: (text: string, memo: string | null, signal?: AbortSignal) => Promise<unknown>,
  { max, ttlMs, label }: { max: number; ttlMs: number; label: string },
): ParserFn {
  const cache = createTtlCache<unknown>({ max, ttlMs });
  const fn: ParserFn = async (text, memo, signal) => {
    const key = createHash("sha256").update(`${label}\u0000${text}\u0000${memo ?? ""}`).digest("hex");
    const hit = cache.get(key);
    if (hit !== undefined) return structuredClone(hit);
    const value = await parse(text, memo, signal);
    // Only well-formed parses are cached; malformed output is retried next time.
    if (ParsedRequest.safeParse(value).success) cache.set(key, value);
    return structuredClone(value);
  };
  fn.label = label;
  return fn;
}
