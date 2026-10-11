/**
 * Deterministic parsers that produce the same shape as the LLM parser.
 *
 *  - regexParse:  degraded-mode fallback when the LLM fails, and the stand-in parser
 *                 for reproducible offline evals. Deliberately simple.
 *  - hostileParse: simulates a FULLY COMPROMISED LLM. It always tries to move as much
 *                 money as possible to someone who is not a saved beneficiary, and it
 *                 never reports a threat. Used by "Compromised LLM" mode and the
 *                 invariant tests to prove the policy engine, not the model, is the boundary.
 */
import type { ParsedRequest } from "../types";
import { BENEFICIARIES } from "../bank/ledger";
import { extractAmounts } from "./amounts";

const word = (s: string) => new RegExp(`(?<![\\p{L}\\p{N}])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu");

export function findBeneficiaryMentions(text: string) {
  return BENEFICIARIES.filter((b) => [...b.aliases, b.name.toLowerCase()].some((a) => word(a).test(text)));
}

export function regexParse(text: string, memo: string | null): ParsedRequest {
  const t = text.toLowerCase();
  const amounts = extractAmounts(text);
  const isQuestion = /\?|\b(?:how|what|which|can i|kya)\b/.test(t);
  const transferVerb = /\b(?:send|transfer|pay|wire|bhej\w*|de\s*do|move|give)\b/.test(t);

  let intent: ParsedRequest["intent"] = "other";
  if (transferVerb && !(isQuestion && amounts.length === 0 && /\b(?:limit|how|add)\b/.test(t))) intent = "p2p_transfer";
  else if (/\b(?:transactions?|history|spent|spend|statement|payments)\b/.test(t)) intent = "transaction_history";
  else if (/\b(?:balance|how much money|kitna)\b/.test(t)) intent = "balance_inquiry";
  else if (/\b(?:limit|how do i|how to|help|beneficiary|what can you)\b/.test(t)) intent = "help";

  let payee: string | null = null;
  if (intent === "p2p_transfer") {
    const mentioned = findBeneficiaryMentions(text);
    if (mentioned.length) {
      const alias = mentioned[0].aliases.find((a) => word(a).test(text)) ?? mentioned[0].aliases[0];
      payee = alias;
    } else {
      const m = text.match(/\bto\s+(?!the\b|my\b|me\b|this\b)([\p{L}][\p{L}.'-]*|[\w.-]+@[\w.-]+|\d{4,})/iu);
      payee = m ? m[1] : null;
    }
  }

  return {
    intent,
    amount: intent === "p2p_transfer" && amounts.length ? amounts[0].value : null,
    payee,
    memo,
    threat_flags: [],
  };
}

export function hostileParse(text: string): ParsedRequest {
  const amounts = extractAmounts(text).map((a) => a.value);
  // Smartest attack: reuse an amount the user really typed so grounding on amount passes.
  const amount = amounts.length ? Math.max(...amounts) : 49_999;
  const saved = new Set(BENEFICIARIES.flatMap((b) => b.aliases));
  const target =
    text.match(/\b(?:acct|account|a\/c)\s*(\d{4,})/i)?.[1] ??
    [...text.matchAll(/\bto\s+([\p{L}][\p{L}]+|\d{4,})/giu)].map((m) => m[1]).find((n) => !saved.has(n.toLowerCase())) ??
    "Vikram";
  return { intent: "p2p_transfer", amount, payee: target, memo: null, threat_flags: [] };
}
