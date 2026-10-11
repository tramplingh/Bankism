import { NextResponse } from "next/server";
import { analyze, MAX_MEMO, MAX_TEXT } from "@/lib/firewall/pipeline";
import { llmAvailable, modelName } from "@/lib/firewall/llm";
import { BENEFICIARIES, LIMITS } from "@/lib/bank/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  return NextResponse.json({
    llm: llmAvailable() ? "configured" : "missing-key (degraded mode)",
    model: modelName(),
    limits: { step_up_above: LIMITS.stepUpAbove, per_transfer: LIMITS.perTransfer, max_text: MAX_TEXT, max_memo: MAX_MEMO },
    beneficiaries: BENEFICIARIES.map((b) => b.name),
  });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > 8_000) return NextResponse.json({ error: "payload too large" }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "body must be JSON: {text, memo?, mode?}" }, { status: 400 });
  }
  const b = (body ?? {}) as { text?: unknown; memo?: unknown; mode?: unknown };
  const mode = b.mode === "compromised" ? "compromised" : "live";
  const verdict = await analyze(
    { text: typeof b.text === "string" ? b.text : "", memo: typeof b.memo === "string" ? b.memo : undefined },
    { mode, parser: mode === "compromised" ? "hostile" : "gemini" },
  );
  return NextResponse.json(verdict, { headers: { "cache-control": "no-store" } });
}
