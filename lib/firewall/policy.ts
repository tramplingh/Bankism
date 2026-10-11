/**
 * L4 — Policy engine. THE security boundary.
 *
 * Pure deterministic code. It receives the parser's output as untrusted data and
 * re-checks everything against the user's own text and the bank's rules. It is the
 * only place an ApprovedTransfer can be constructed. Rationale strings are written
 * here, by code — never by the LLM — so an attacker cannot inject the explanation.
 */
import type { Decision, ParsedRequest, RiskLevel, Signal, ThreatCategory } from "../types";
import { LIMITS, resolveBeneficiary, type Account, type ApprovedTransfer, type Beneficiary } from "../bank/ledger";
import { extractAmounts } from "./amounts";
import { findBeneficiaryMentions } from "./fallbackParser";
import { rank } from "./rules";

export interface PolicyInput {
  text: string; // normalized request text (memo removed)
  memo: string | null; // normalized memo supplied by the user
  parsed: ParsedRequest | null;
  signals: Signal[];
  degraded: boolean;
  account: Account;
}

export interface PolicyOutcome {
  decision: Decision;
  risk_level: RiskLevel;
  threat_category: ThreatCategory;
  rationale: string;
  command: ApprovedTransfer | null;
  read: "balance" | "history" | "help" | null;
  grounding: { amount?: string; payee?: string } | null;
  check: string; // id of the check that decided
}

const out = (
  decision: Decision,
  risk_level: RiskLevel,
  threat_category: ThreatCategory,
  check: string,
  rationale: string,
  extra: Partial<PolicyOutcome> = {},
): PolicyOutcome => ({ decision, risk_level, threat_category, check, rationale, command: null, read: null, grounding: null, ...extra });

const OBFUSCATION_IDS = /^OBF-/;

/** Highest-severity signal decides the threat category; obfuscation used to deliver an attack is called out. */
function categoryFor(signals: Signal[]): ThreatCategory {
  const top = signals[0];
  const obfuscated = signals.some((s) => OBFUSCATION_IDS.test(s.id));
  if (top.category === "MEMO_INJECTION") return "MEMO_INJECTION";
  if (obfuscated && top.layer === "L2_RULES") return "OBFUSCATION";
  return top.category;
}

const MEMO_ALLOWED = /^[\p{L}\p{N}\s.,'&!?()₹/-]*$/u;

export function decide(input: PolicyInput): PolicyOutcome {
  const { text, memo, parsed, degraded, account } = input;
  const signals = [...input.signals].sort((a, b) => rank(b.severity) - rank(a.severity));
  const top = signals[0];

  // 1. Detection signals (rules + LLM flags). Risk = max severity.
  if (top && (top.severity === "CRITICAL" || top.severity === "HIGH")) {
    return out("BLOCKED", top.severity, categoryFor(signals), `signal:${top.id}`, `Blocked: ${top.evidence}.`);
  }
  const medium = top?.severity === "MEDIUM" ? top : null;

  if (!parsed) return out("BLOCKED", "HIGH", "SYSTEM_ERROR", "no-parse", "Blocked: request could not be parsed.");

  // 2. Intent allowlist.
  if (parsed.intent === "other") {
    return out("REVIEW", "MEDIUM", "AMBIGUOUS", "intent", "Not a supported banking action; routed to a human agent.");
  }
  if (parsed.intent !== "p2p_transfer") {
    const read = parsed.intent === "balance_inquiry" ? "balance" : parsed.intent === "transaction_history" ? "history" : "help";
    if (medium) return out("REVIEW", "MEDIUM", medium.category, `signal:${medium.id}`, `Read-only request, but ${medium.evidence}; step-up required.`);
    // Read-only actions always run on the session account — the text cannot choose another one.
    return out("APPROVED", "LOW", "NONE", "read-only", `Read-only ${read} request on the signed-in account (${account.id}).`, { read });
  }

  // 3. Transfers: everything must be grounded in what the user actually typed.
  if (parsed.amount === null || !parsed.payee) {
    return out("REVIEW", "MEDIUM", "AMBIGUOUS", "incomplete", "Transfer is missing an amount or a payee; asking the customer to clarify.");
  }
  const amounts = extractAmounts(text);
  const amountMatch = amounts.find((a) => a.value === parsed.amount);
  if (!amountMatch) {
    return out("BLOCKED", "HIGH", "GROUNDING_VIOLATION", "grounding:amount",
      `Blocked: parser proposed ₹${parsed.amount}, which does not appear in the customer's message.`);
  }

  const mentioned = findBeneficiaryMentions(text);
  const proposed = resolveBeneficiary(parsed.payee);
  const payeeInText = new RegExp(`(?<![\\p{L}\\p{N}])${parsed.payee.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(text);
  const grounded: Beneficiary | null = proposed && mentioned.some((b) => b.id === proposed.id) ? proposed : null;
  if (!grounded && !payeeInText) {
    return out("BLOCKED", "HIGH", "GROUNDING_VIOLATION", "grounding:payee",
      `Blocked: parser proposed payee “${parsed.payee}”, who is not named in the customer's message.`);
  }
  const grounding = { amount: amountMatch.raw.trim(), payee: grounded ? grounded.name : parsed.payee };

  // 4. Hard limits.
  if (parsed.amount > LIMITS.perTransfer) {
    return out("BLOCKED", "HIGH", "LIMIT_VIOLATION", "limit:per-transfer",
      `Blocked: ₹${parsed.amount.toLocaleString("en-IN")} exceeds the ₹${LIMITS.perTransfer.toLocaleString("en-IN")} per-transfer limit.`, { grounding });
  }
  if (parsed.amount > account.balance) {
    return out("BLOCKED", "HIGH", "LIMIT_VIOLATION", "limit:balance", "Blocked: amount exceeds available balance.", { grounding });
  }

  // 5. Step-up conditions (REVIEW never executes).
  if (new Set(amounts.map((a) => a.value)).size > 1 || mentioned.length > 1) {
    return out("REVIEW", "MEDIUM", "AMBIGUOUS", "ambiguous", "Message mentions more than one amount or payee; one transfer at a time.", { grounding });
  }
  if (!grounded) {
    return out("REVIEW", "MEDIUM", "NONE", "new-payee", `“${parsed.payee}” is not a saved beneficiary; new payees need OTP verification.`, { grounding });
  }
  if (parsed.amount > LIMITS.stepUpAbove) {
    return out("REVIEW", "MEDIUM", "NONE", "step-up",
      `₹${parsed.amount.toLocaleString("en-IN")} is above the ₹${LIMITS.stepUpAbove.toLocaleString("en-IN")} step-up threshold; OTP required.`, { grounding });
  }
  if (memo && (memo.length > LIMITS.memoMaxLength || !MEMO_ALLOWED.test(memo) || /\d{6,}/.test(memo))) {
    return out("REVIEW", "MEDIUM", "MEMO_INJECTION", "memo-structure",
      "Memo is too long or contains characters/numbers not allowed in a payment note.", { grounding });
  }
  if (degraded) {
    return out("REVIEW", "MEDIUM", "NONE", "degraded",
      "LLM parser unavailable (degraded mode): transfers are never auto-approved without it.", { grounding });
  }
  if (medium) {
    return out("REVIEW", "MEDIUM", medium.category, `signal:${medium.id}`, `Transfer looks valid, but ${medium.evidence}; step-up required.`, { grounding });
  }

  return out("APPROVED", "LOW", "NONE", "approved",
    `₹${parsed.amount.toLocaleString("en-IN")} to saved beneficiary ${grounded.name}; amount and payee grounded in the message, within limits.`,
    { grounding, command: { kind: "approved_transfer", beneficiary: grounded, amount: parsed.amount, memo } });
}
