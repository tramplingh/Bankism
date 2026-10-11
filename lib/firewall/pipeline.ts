/**
 * Orchestrates L1 → L2 → L3 → L4 → executor and builds the machine-readable verdict.
 * Every path is fail-closed: an exception anywhere yields BLOCKED / SYSTEM_ERROR.
 */
import { randomUUID } from "node:crypto";
import {
  POLICY_VERSION,
  ParsedRequest,
  type FirewallInput,
  type Mode,
  type ParserSource,
  type Signal,
  type TraceStep,
  type Verdict,
} from "../types";
import { createAccount, executeTransfer, LIMITS, BENEFICIARIES, type Account } from "../bank/ledger";
import { normalize, type NormalizeResult } from "./normalize";
import { runRules, splitInlineMemo } from "./rules";
import { regexParse, hostileParse } from "./fallbackParser";
import { geminiParse, llmAvailable, modelName } from "./llm";
import { decide } from "./policy";

export type ParserFn = (text: string, memo: string | null) => Promise<unknown>;

export interface AnalyzeOptions {
  mode: Mode;
  /** "gemini" in production; "regex" for offline evals; "hostile" simulates a compromised LLM. */
  parser: "gemini" | "regex" | "hostile" | ParserFn;
  /** Disable L2 to prove the policy engine stands on its own (ablation). */
  rules: boolean;
  timeoutMs: number;
  account: Account;
}

export const MAX_TEXT = 1000;
export const MAX_MEMO = 200;

// Demo session account. Serverless instances may reset it — this is a mock ledger.
const sessionAccount = createAccount();

function withTimeout<T>(p: Promise<T>, ms: number, ctrl: AbortController): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      ctrl.abort();
      reject(new Error(`timed out after ${ms}ms`));
    }, ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

export async function analyze(input: FirewallInput, options: Partial<AnalyzeOptions> = {}): Promise<Verdict> {
  const opts: AnalyzeOptions = {
    mode: "live",
    parser: "gemini",
    rules: true,
    timeoutMs: 6000,
    account: sessionAccount,
    ...options,
  };
  const t0 = performance.now();
  const trace: TraceStep[] = [];
  const step = (layer: TraceStep["layer"], status: TraceStep["status"], detail: string, since: number) =>
    trace.push({ layer, status, detail, ms: Math.round((performance.now() - since) * 10) / 10 });

  const parserSource: ParserSource =
    opts.parser === "hostile" ? "hostile" : opts.parser === "regex" ? "regex" : "llm";
  let normalization: Verdict["normalization"] = { normalized: "", changed: false, notes: [] };
  let parsed: ParsedRequest | null = null;
  let degraded = false;
  let signals: Signal[] = [];

  type Core = Pick<Verdict, "decision" | "risk_level" | "threat_category" | "rationale" | "execution" | "grounding">;
  const finish = (v: Core): Verdict => ({
    request_id: randomUUID(),
    decision: v.decision,
    risk_level: v.risk_level,
    threat_category: v.threat_category,
    rationale: v.rationale,
    execution: v.execution,
    grounding: v.grounding,
    parsed_action: parsed,
    signals,
    trace,
    normalization,
    mode: opts.mode,
    parser: parserSource,
    degraded,
    policy_version: POLICY_VERSION,
    latency_ms: Math.round((performance.now() - t0) * 10) / 10,
  });

  try {
    // ── Input contract ──
    const text = typeof input.text === "string" ? input.text : "";
    const memoIn = typeof input.memo === "string" ? input.memo.trim() : "";
    if (!text.trim() || text.length > MAX_TEXT || memoIn.length > MAX_MEMO) {
      step("L1_NORMALIZE", "block", "input empty or over size limit", t0);
      return finish({
        decision: "BLOCKED",
        risk_level: "HIGH",
        threat_category: "AMBIGUOUS",
        rationale: `Blocked: message must be 1–${MAX_TEXT} characters and memo at most ${MAX_MEMO}.`,
        execution: { executed: false },
        grounding: null,
      });
    }

    // ── L1 normalize ──
    let t = performance.now();
    const { request, memo: inlineMemo } = splitInlineMemo(text);
    const memoRaw = [memoIn, inlineMemo].filter(Boolean).join(" | ") || null;
    const nText = normalize(request);
    const nMemo: NormalizeResult | null = memoRaw ? normalize(memoRaw) : null;
    normalization = {
      normalized: nText.normalized + (nMemo ? `  [memo: ${nMemo.normalized}]` : ""),
      changed: nText.changed || Boolean(nMemo?.changed),
      notes: [...nText.notes, ...(nMemo?.notes.map((n) => `memo: ${n}`) ?? [])],
    };
    signals.push(...nText.signals, ...(nMemo?.signals ?? []));
    step("L1_NORMALIZE", nText.signals.length || nMemo?.signals.length ? "flag" : "pass",
      normalization.notes.join("; ") || "no obfuscation found", t);

    // ── L2 rules ──
    t = performance.now();
    if (opts.rules) {
      const hits = runRules(nText, nMemo);
      signals.push(...hits);
      const worst = hits[0];
      step("L2_RULES", worst ? (worst.severity === "MEDIUM" ? "flag" : "block") : "pass",
        worst ? `${hits.length} rule(s) hit; worst ${worst.id} (${worst.severity})` : "no signatures matched", t);
      if (worst?.severity === "CRITICAL") {
        step("L3_LLM", "skipped", "CRITICAL rule hit — LLM never sees this input", performance.now());
        const p = decide({ text: nText.normalized, memo: nMemo?.normalized ?? null, parsed: null, signals, degraded, account: opts.account });
        step("L4_POLICY", "block", p.rationale, performance.now());
        return finish({ ...p, execution: { executed: false } });
      }
    } else {
      step("L2_RULES", "skipped", "rules disabled (ablation)", t);
    }

    // ── L3 parser (untrusted) ──
    t = performance.now();
    const memoForParser = nMemo?.normalized ?? null;
    if (opts.parser === "regex") {
      parsed = regexParse(nText.normalized, memoForParser);
      step("L3_LLM", "pass", "deterministic parser (offline eval mode)", t);
    } else if (opts.parser === "hostile") {
      parsed = hostileParse(nText.normalized);
      step("L3_LLM", "flag", `COMPROMISED LLM returned: transfer ₹${parsed.amount} to “${parsed.payee}”, flags=[]`, t);
    } else {
      const fn: ParserFn = typeof opts.parser === "function" ? opts.parser : (a, b) => {
        if (!llmAvailable()) throw new Error("GEMINI_API_KEY not configured");
        return geminiParse(a, b, ctrl.signal);
      };
      const ctrl = new AbortController();
      try {
        const raw = await withTimeout(fn(nText.normalized, memoForParser), opts.timeoutMs, ctrl);
        const v = ParsedRequest.safeParse(raw);
        if (!v.success) throw new Error(`malformed output: ${v.error.issues[0]?.path.join(".") || "root"} ${v.error.issues[0]?.message}`);
        parsed = v.data;
        for (const f of parsed.threat_flags) {
          signals.push({ layer: "L3_LLM", id: `LLM-${f}`, category: f, severity: "HIGH", evidence: `LLM flagged ${f.toLowerCase().replace(/_/g, " ")}` });
        }
        step("L3_LLM", parsed.threat_flags.length ? "flag" : "pass",
          `${typeof opts.parser === "function" ? "custom parser" : modelName()} → ${parsed.intent}${parsed.amount ? ` ₹${parsed.amount}` : ""}${parsed.payee ? ` → ${parsed.payee}` : ""}; flags=[${parsed.threat_flags.join(", ")}]`, t);
      } catch (e) {
        degraded = true;
        parsed = regexParse(nText.normalized, memoForParser);
        step("L3_LLM", "error", `LLM unavailable (${(e as Error).message}); degraded mode: deterministic parser, no auto-approved transfers`, t);
      }
    }

    // ── L4 policy ──
    t = performance.now();
    const p = decide({ text: nText.normalized, memo: nMemo?.normalized ?? null, parsed, signals, degraded, account: opts.account });
    step("L4_POLICY", p.decision === "APPROVED" ? "pass" : p.decision === "REVIEW" ? "flag" : "block", `[${p.check}] ${p.rationale}`, t);

    // ── Executor ──
    t = performance.now();
    let execution: Verdict["execution"] = { executed: false };
    if (p.decision === "APPROVED") {
      if (p.command) {
        const r = executeTransfer(opts.account, p.command);
        execution = { executed: true, reference: r.reference, result: r };
        step("EXECUTOR", "pass", `transfer ${r.reference} executed from ${r.from}`, t);
      } else if (p.read) {
        const result =
          p.read === "balance"
            ? { account: opts.account.id, balance: opts.account.balance }
            : p.read === "history"
              ? { account: opts.account.id, transactions: opts.account.history.slice(0, 5) }
              : {
                  limits: { step_up_above: LIMITS.stepUpAbove, per_transfer: LIMITS.perTransfer },
                  saved_beneficiaries: BENEFICIARIES.map((b) => b.name),
                  note: "New beneficiaries are added in the app with OTP verification.",
                };
        execution = { executed: true, reference: `READ-${p.read.toUpperCase()}`, result };
        step("EXECUTOR", "pass", `read-only ${p.read} served`, t);
      }
    } else {
      step("EXECUTOR", "skipped", "nothing executed", t);
    }
    return finish({ ...p, execution });
  } catch (e) {
    step("L4_POLICY", "error", `internal error: ${(e as Error).message} — failing closed`, t0);
    return finish({
      decision: "BLOCKED",
      risk_level: "HIGH",
      threat_category: "SYSTEM_ERROR",
      rationale: "Blocked: internal error. The firewall fails closed.",
      execution: { executed: false },
      grounding: null,
    });
  }
}
