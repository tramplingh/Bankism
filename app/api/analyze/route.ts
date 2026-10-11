import { NextResponse } from "next/server";
import { analyze, MAX_MEMO, MAX_TEXT } from "@/lib/firewall/pipeline";
import { geminiParse, llmAvailable, modelName } from "@/lib/firewall/llm";
import { withParseCache } from "@/lib/firewall/cachedParser";
import { createRateLimiter } from "@/lib/server/rateLimit";
import { BENEFICIARIES, LIMITS } from "@/lib/bank/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY_BYTES = 8_000;

// One shared Gemini parser per instance: identical requests (e.g. demo presets) reuse the parse.
const gemini = withParseCache(geminiParse, { max: 256, ttlMs: 10 * 60_000, label: modelName() });
// 20-request burst, then 1 request / 3 s per client. Keeps one visitor from spending the daily LLM quota.
const limiter = createRateLimiter({ capacity: 20, refillPerSec: 1 / 3, maxKeys: 5_000 });

function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

export async function GET() {
  return NextResponse.json({
    llm: llmAvailable() ? "configured" : "missing-key (degraded mode)",
    model: modelName(),
    limits: { step_up_above: LIMITS.stepUpAbove, per_transfer: LIMITS.perTransfer, max_text: MAX_TEXT, max_memo: MAX_MEMO },
    beneficiaries: BENEFICIARIES.map((b) => b.name),
  });
}

export async function POST(req: Request) {
  const rl = limiter.take(clientKey(req));
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many requests. Try again in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } },
    );
  }

  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "payload too large" }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "body must be JSON: {text, memo?, mode?}" }, { status: 400 });
  }
  const b = (body ?? {}) as { text?: unknown; memo?: unknown; mode?: unknown };
  const mode = b.mode === "compromised" ? "compromised" : "live";
  const verdict = await analyze(
    { text: typeof b.text === "string" ? b.text : "", memo: typeof b.memo === "string" ? b.memo : undefined },
    { mode, parser: mode === "compromised" ? "hostile" : gemini },
  );
  return NextResponse.json(verdict, { headers: { "cache-control": "no-store" } });
}
