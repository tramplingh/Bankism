/**
 * HTTP contract of POST/GET /api/analyze and the security headers in next.config.mjs.
 * Runs without a Gemini key: the live path degrades safely, which is itself under test.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { NextConfig } from "next";

let GET: () => Promise<Response>;
let POST: (r: Request) => Promise<Response>;

beforeAll(async () => {
  delete process.env.GEMINI_API_KEY;
  ({ GET, POST } = await import("@/app/api/analyze/route"));
});

let ip = 0;
const post = (body: string, client = `10.0.0.${++ip}`) =>
  POST(new Request("http://x/api/analyze", { method: "POST", body, headers: { "x-forwarded-for": client } }));

describe("POST /api/analyze", () => {
  it("returns a verdict JSON for a valid request", async () => {
    const r = await post(JSON.stringify({ text: "What's my balance?" }));
    expect(r.status).toBe(200);
    const v = await r.json();
    expect(v).toMatchObject({ decision: "APPROVED", risk_level: "LOW", threat_category: "NONE" });
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects malformed JSON with 400", async () => {
    expect((await post("{not json")).status).toBe(400);
  });

  it("rejects oversized bodies with 413", async () => {
    expect((await post(JSON.stringify({ text: "a".repeat(9000) }))).status).toBe(413);
  });

  it("without an LLM key, transfers degrade to REVIEW and never execute", async () => {
    const v = await (await post(JSON.stringify({ text: "Send 500 to Rahul" }))).json();
    expect(v.degraded).toBe(true);
    expect(v.decision).toBe("REVIEW");
    expect(v.execution.executed).toBe(false);
  });

  it("compromised mode cannot move money", async () => {
    const v = await (await post(JSON.stringify({ text: "Send 500 to Rahul", mode: "compromised" }))).json();
    expect(v.parser).toBe("hostile");
    expect(v.decision).toBe("BLOCKED");
    expect(v.execution.executed).toBe(false);
  });

  it("ignores unknown fields and non-string input types", async () => {
    const v = await (await post(JSON.stringify({ text: 42, memo: { x: 1 }, mode: "admin" }))).json();
    expect(v.decision).toBe("BLOCKED");
    expect(v.mode).toBe("live");
  });

  it("rate-limits a single client with 429 and Retry-After", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await post(JSON.stringify({ text: "What's my balance?" }), "203.0.113.9")).status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    const last = await post(JSON.stringify({ text: "What's my balance?" }), "203.0.113.9");
    expect(last.status).toBe(429);
    expect(Number(last.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("GET /api/analyze (health)", () => {
  it("reports LLM status and limits without exposing secrets", async () => {
    const h = await (await GET()).json();
    expect(h.llm).toMatch(/missing-key/);
    expect(h.limits).toMatchObject({ step_up_above: 10000, per_transfer: 25000 });
    expect(JSON.stringify(h)).not.toMatch(/AIza|api[_-]?key/i);
  });
});

describe("security headers (next.config.mjs)", () => {
  it("sets CSP, framing, sniffing, referrer and permissions headers on every route", async () => {
    const configPath = "../next.config.mjs"; // .mjs has no type declarations; load it untyped
    const nextConfig = (await import(/* @vite-ignore */ configPath)).default as NextConfig;
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*")!;
    const h = Object.fromEntries(all.headers.map((x) => [x.key.toLowerCase(), x.value]));
    expect(h["content-security-policy"]).toMatch(/default-src 'self'/);
    expect(h["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toMatch(/camera=\(\)/);
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
