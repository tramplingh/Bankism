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
import { decide, type PolicyOutcome } from "./policy";

export type ParserFn = ((text: string, memo: string | null, signal?: AbortSignal) => Promise<unknown>) & {
  /** Shown in the trace, e.g. the model name behind a cached parser. */
  label?: string;
};

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

type Step = (layer: TraceStep["layer"], status: TraceStep["status"], detail: string, since: number) => void;

/** Collects per-layer trace entries with elapsed time since `since`. */
function createTrace(): { trace: TraceStep[]; step: Step } {
  const trace: TraceStep[] = [];
  const step: Step = (layer, status, detail, since) =>
    trace.push({ layer, status, detail, ms: Math.round((performance.now() - since) * 10) / 10 });
  return { trace, step };
}

/** L1: split an inline memo out of the text, normalize both, and collect obfuscation signals. */
function normalizeInput(text: string, memoIn: string) {
  const { request, memo: inlineMemo } = splitInlineMemo(text);
  const memoRaw = [memoIn, inlineMemo].filter(Boolean).join(" | ") || null;
  const nText = normalize(request);
  const nMemo: NormalizeResult | null = memoRaw ? normalize(memoRaw) : null;
  const normalization: Verdict["normalization"] = {
    normalized: nText.normalized + (nMemo ? `  [memo: ${nMemo.normalized}]` : ""),
    changed: nText.changed || Boolean(nMemo?.changed),
    notes: [...nText.notes, ...(nMemo?.notes.map((n) => `memo: ${n}`) ?? [])],
  };
  return { nText, nMemo, normalization, signals: [...nText.signals, ...(nMemo?.signals ?? [])] };
}

interface ParseOutcome {
  parsed: ParsedRequest;
  degraded: boolean;
  signals: Signal[];
}

/**
 * L3: run the selected parser. LLM output is untrusted: it is time-boxed, schema-validated,
 * and any failure falls back to the deterministic parser in degraded mode.
 */
async function runParser(opts: AnalyzeOptions, text: string, memo: string | null, step: Step): Promise<ParseOutcome> {
  const t = performance.now();
  if (opts.parser === "regex") {
    step("L3_LLM", "pass", "deterministic parser (offline eval mode)", t);
    return { parsed: regexParse(text, memo), degraded: false, signals: [] };
  }
  if (opts.parser === "hostile") {
    const parsed = hostileParse(text);
    step("L3_LLM", "flag", `COMPROMISED LLM returned: transfer ₹${parsed.amount} to “${parsed.payee}”, flags=[]`, t);
    return { parsed, degraded: false, signals: [] };
  }

  const custom = typeof opts.parser === "function" ? opts.parser : null;
  const call: ParserFn =
    custom ??
    ((a, b, signal) => {
      if (!llmAvailable()) throw new Error("GEMINI_API_KEY not configured");
      return geminiParse(a, b, signal);
    });
  const ctrl = new AbortController();
  try {
    const raw = await withTimeout(call(text, memo, ctrl.signal), opts.timeoutMs, ctrl);
    const v = ParsedRequest.safeParse(raw);
    if (!v.success) throw new Error(`malformed output: ${v.error.issues[0]?.path.join(".") || "root"} ${v.error.issues[0]?.message}`);
    const parsed = v.data;
    const signals: Signal[] = parsed.threat_flags.map((f) => ({
      layer: "L3_LLM",
      id: `LLM-${f}`,
      category: f,
      severity: "HIGH",
      evidence: `LLM flagged ${f.toLowerCase().replace(/_/g, " ")}`,
    }));
    const label = custom ? (custom.label ?? "custom parser") : modelName();
    step(
      "L3_LLM",
      parsed.threat_flags.length ? "flag" : "pass",
      `${label} → ${parsed.intent}${parsed.amount ? ` ₹${parsed.amount}` : ""}${parsed.payee ? ` → ${parsed.payee}` : ""}; flags=[${parsed.threat_flags.join(", ")}]`,
      t,
    );
    return { parsed, degraded: false, signals };
  } catch (e) {
    step("L3_LLM", "error", `LLM unavailable (${(e as Error).message}); degraded mode: deterministic parser, no auto-approved transfers`, t);
    return { parsed: regexParse(text, memo), degraded: true, signals: [] };
  }
}

/** Data returned for an approved read-only request. Always the session account, never one named in the text. */
function readResult(kind: NonNullable<PolicyOutcome["read"]>, account: Account) {
  if (kind === "balance") return { account: account.id, balance: account.balance };
  if (kind === "history") return { account: account.id, transactions: account.history.slice(0, 5) };
  return {
    limits: { step_up_above: LIMITS.stepUpAbove, per_transfer: LIMITS.perTransfer },
    saved_beneficiaries: BENEFICIARIES.map((b) => b.name),
    note: "New beneficiaries are added in the app with OTP verification.",
  };
}

/** Executor: acts only on APPROVED outcomes, and only on the typed command the policy engine built. */
function execute(p: PolicyOutcome, account: Account, step: Step): Verdict["execution"] {
  const t = performance.now();
  if (p.decision !== "APPROVED") {
    step("EXECUTOR", "skipped", "nothing executed", t);
    return { executed: false };
  }
  if (p.command) {
    const r = executeTransfer(account, p.command);
    step("EXECUTOR", "pass", `transfer ${r.reference} executed from ${r.from}`, t);
    return { executed: true, reference: r.reference, result: r };
  }
  if (p.read) {
    const result = readResult(p.read, account);
    step("EXECUTOR", "pass", `read-only ${p.read} served`, t);
    return { executed: true, reference: `READ-${p.read.toUpperCase()}`, result };
  }
  return { executed: false };
}

const POLICY_STATUS: Record<PolicyOutcome["decision"], TraceStep["status"]> = { APPROVED: "pass", REVIEW: "flag", BLOCKED: "block" };

type Core = Pick<Verdict, "decision" | "risk_level" | "threat_category" | "rationale" | "execution" | "grounding">;

const failClosed = (rationale: string, threat_category: Core["threat_category"]): Core => ({
  decision: "BLOCKED",
  risk_level: "HIGH",
  threat_category,
  rationale,
  execution: { executed: false },
  grounding: null,
});

/**
 * Runs one request through L1 → L2 → L3 → L4 → executor and returns the verdict.
 * Every path is fail-closed: any exception yields BLOCKED / SYSTEM_ERROR.
 */
export async function analyze(input: FirewallInput, options: Partial<AnalyzeOptions> = {}): Promise<Verdict> {
  const opts: AnalyzeOptions = { mode: "live", parser: "gemini", rules: true, timeoutMs: 10000, account: sessionAccount, ...options };
  const t0 = performance.now();
  const { trace, step } = createTrace();
  const parserSource: ParserSource = opts.parser === "hostile" ? "hostile" : opts.parser === "regex" ? "regex" : "llm";
  let normalization: Verdict["normalization"] = { normalized: "", changed: false, notes: [] };
  let parsed: ParsedRequest | null = null;
  let degraded = false;
  const signals: Signal[] = [];

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
      return finish(failClosed(`Blocked: message must be 1–${MAX_TEXT} characters and memo at most ${MAX_MEMO}.`, "AMBIGUOUS"));
    }

    // ── L1 normalize ──
    let t = performance.now();
    const l1 = normalizeInput(text, memoIn);
    normalization = l1.normalization;
    signals.push(...l1.signals);
    step("L1_NORMALIZE", l1.signals.length ? "flag" : "pass", normalization.notes.join("; ") || "no obfuscation found", t);
    const policyInput = { text: l1.nText.normalized, memo: l1.nMemo?.normalized ?? null, account: opts.account };

    // ── L2 rules ──
    t = performance.now();
    if (opts.rules) {
      const hits = runRules(l1.nText, l1.nMemo);
      signals.push(...hits);
      const worst = hits[0];
      step("L2_RULES", worst ? (worst.severity === "MEDIUM" ? "flag" : "block") : "pass",
        worst ? `${hits.length} rule(s) hit; worst ${worst.id} (${worst.severity})` : "no signatures matched", t);
      if (worst?.severity === "CRITICAL") {
        step("L3_LLM", "skipped", "CRITICAL rule hit — LLM never sees this input", performance.now());
        const p = decide({ ...policyInput, parsed: null, signals, degraded });
        step("L4_POLICY", "block", p.rationale, performance.now());
        return finish({ ...p, execution: { executed: false } });
      }
    } else {
      step("L2_RULES", "skipped", "rules disabled (ablation)", t);
    }

    // ── L3 parser (untrusted) ──
    const l3 = await runParser(opts, l1.nText.normalized, l1.nMemo?.normalized ?? null, step);
    parsed = l3.parsed;
    degraded = l3.degraded;
    signals.push(...l3.signals);

    // ── L4 policy (the security boundary) ──
    t = performance.now();
    const p = decide({ ...policyInput, parsed, signals, degraded });
    step("L4_POLICY", POLICY_STATUS[p.decision], `[${p.check}] ${p.rationale}`, t);

    // ── Executor ──
    return finish({ ...p, execution: execute(p, opts.account, step) });
  } catch (e) {
    step("L4_POLICY", "error", `internal error: ${(e as Error).message} — failing closed`, t0);
    return finish(failClosed("Blocked: internal error. The firewall fails closed.", "SYSTEM_ERROR"));
  }
}
