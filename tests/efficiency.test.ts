/**
 * Efficiency controls: a bounded TTL cache for LLM parses and a per-client rate limiter.
 * Both protect the Gemini quota (free tier: 15 req/min, 500 req/day).
 */
import { describe, expect, it } from "vitest";
import { createTtlCache } from "@/lib/server/ttlCache";
import { createRateLimiter } from "@/lib/server/rateLimit";
import { withParseCache } from "@/lib/firewall/cachedParser";
import { analyze } from "@/lib/firewall/pipeline";
import { createAccount } from "@/lib/bank/ledger";

describe("TTL cache", () => {
  it("returns stored values until they expire", () => {
    const c = createTtlCache<string>({ max: 10, ttlMs: 1000 });
    c.set("k", "v", 0);
    expect(c.get("k", 500)).toBe("v");
    expect(c.get("k", 1001)).toBeUndefined();
  });

  it("evicts the least recently used entry when full", () => {
    const c = createTtlCache<number>({ max: 2, ttlMs: 10_000 });
    c.set("a", 1, 0);
    c.set("b", 2, 0);
    c.get("a", 1); // a is now most recently used
    c.set("c", 3, 2);
    expect(c.get("b", 3)).toBeUndefined();
    expect(c.get("a", 3)).toBe(1);
    expect(c.size()).toBe(2);
  });
});

describe("rate limiter", () => {
  it("allows a burst up to capacity, then refuses with a retry hint", () => {
    const rl = createRateLimiter({ capacity: 3, refillPerSec: 1, maxKeys: 100 });
    expect([rl.take("ip", 0), rl.take("ip", 0), rl.take("ip", 0)].every((r) => r.ok)).toBe(true);
    const denied = rl.take("ip", 0);
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it("refills over time and keeps clients independent", () => {
    const rl = createRateLimiter({ capacity: 1, refillPerSec: 1, maxKeys: 100 });
    expect(rl.take("a", 0).ok).toBe(true);
    expect(rl.take("a", 0).ok).toBe(false);
    expect(rl.take("b", 0).ok).toBe(true);
    expect(rl.take("a", 1000).ok).toBe(true);
  });

  it("bounds memory: tracks at most maxKeys clients", () => {
    const rl = createRateLimiter({ capacity: 1, refillPerSec: 1, maxKeys: 5 });
    for (let i = 0; i < 50; i++) rl.take(`ip${i}`, 0);
    expect(rl.size()).toBeLessThanOrEqual(5);
  });
});

describe("parse cache in front of the LLM", () => {
  it("calls the LLM once for repeated identical requests", async () => {
    let calls = 0;
    const llm = async () => {
      calls++;
      return { intent: "p2p_transfer", amount: 500, payee: "Rahul", memo: null, threat_flags: [] };
    };
    const parser = withParseCache(llm, { max: 10, ttlMs: 60_000, label: "test-model" });
    for (let i = 0; i < 3; i++) {
      const v = await analyze({ text: "Send 500 to Rahul" }, { parser, account: createAccount() });
      expect(v.decision).toBe("APPROVED");
    }
    expect(calls).toBe(1);
  });

  it("never caches a failure, so the next request retries the LLM", async () => {
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 1) throw new Error("503");
      return { intent: "balance_inquiry", amount: null, payee: null, memo: null, threat_flags: [] };
    };
    const parser = withParseCache(flaky, { max: 10, ttlMs: 60_000, label: "test-model" });
    const first = await analyze({ text: "What's my balance?" }, { parser, account: createAccount() });
    const second = await analyze({ text: "What's my balance?" }, { parser, account: createAccount() });
    expect(first.degraded).toBe(true);
    expect(second.degraded).toBe(false);
    expect(calls).toBe(2);
  });

  it("caches only the parse: policy still re-checks every request", async () => {
    // A cached parse cannot bypass limits that depend on account state.
    const llm = async () => ({ intent: "p2p_transfer", amount: 9000, payee: "Rahul", memo: null, threat_flags: [] });
    const parser = withParseCache(llm, { max: 10, ttlMs: 60_000, label: "test-model" });
    const poor = { ...createAccount(), balance: 100 };
    const v = await analyze({ text: "Send 9000 to Rahul" }, { parser, account: createAccount() });
    const w = await analyze({ text: "Send 9000 to Rahul" }, { parser, account: poor });
    expect(v.decision).toBe("APPROVED");
    expect(w.decision).toBe("BLOCKED");
  });

  it("labels the trace with the model name, not a generic parser", async () => {
    const parser = withParseCache(async () => ({ intent: "help", amount: null, payee: null, memo: null, threat_flags: [] }), {
      max: 10,
      ttlMs: 60_000,
      label: "gemini-x",
    });
    const v = await analyze({ text: "What is my limit?" }, { parser, account: createAccount() });
    expect(v.trace.find((t) => t.layer === "L3_LLM")?.detail).toMatch(/^gemini-x/);
  });
});
