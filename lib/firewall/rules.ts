/**
 * L2 — Deterministic signature rules.
 *
 * Each rule has ONE fixed severity. The request's risk is the MAX severity hit,
 * never a weighted sum (weights would be arbitrary and indefensible).
 *   CRITICAL → block immediately, LLM is never called
 *   HIGH     → block
 *   MEDIUM   → step-up (REVIEW)
 *
 * Rules scan every L1 view (base, collapsed, leet, decoded, reversed). A hit that
 * only appears in a de-obfuscated view is re-labelled OBFUSCATION. Any hit inside
 * the payment memo is re-labelled MEMO_INJECTION.
 */
import type { Signal, ThreatCategory } from "../types";
import type { NormalizeResult } from "./normalize";

export interface Rule {
  id: string;
  category: Exclude<ThreatCategory, "NONE">;
  severity: Signal["severity"];
  pattern: RegExp;
  description: string;
  /** memoOnly rules describe things that are fine in a request but never in a memo. */
  memoOnly?: boolean;
}

const INSTRUCTION_NOUNS =
  "(?:instructions?|rules?|polic(?:y|ies)|prompts?|guidelines?|directives?|restrictions?|checks?|safeguards?|programming|guardrails?|constraints?|limits?)";

export const RULES: Rule[] = [
  // ── Prompt injection / instruction override ──
  {
    id: "INJ-IGNORE",
    category: "PROMPT_INJECTION",
    severity: "CRITICAL",
    pattern: new RegExp(
      `\\b(?:ignore|disregard|forget|override|bypass|neglect|skip)\\b[^.!?\\n]{0,40}?\\b(?:all|any|the|your|previous|prior|above|earlier|preceding|system|bank|my)?\\s*${INSTRUCTION_NOUNS}\\b`,
    ),
    description: "asks the model to drop its instructions or rules",
  },
  {
    id: "INJ-FORGET-ABOVE",
    category: "PROMPT_INJECTION",
    severity: "CRITICAL",
    pattern: /\b(?:ignore|disregard|forget)\s+(?:everything|all|anything)?\s*(?:the\s+)?(?:above|before|prior|previous(?:ly)?)\b(?!\s+(?:request|one|message|payment|transfer|transaction))/,
    description: "asks the model to discard prior context",
  },
  {
    id: "INJ-FAKE-SYSTEM",
    category: "PROMPT_INJECTION",
    severity: "CRITICAL",
    pattern:
      /(?:^|\n|\s)(?:system|developer|assistant)\s*:|<\/?\s*(?:system|user_input|untrusted_input\w*|assistant|instructions?|admin)\b|#{3,}|\[\[\s*(?:system|admin)|\bnew\s+(?:system\s+)?(?:instructions?|prompt|task|rules?)\b|\bsystem\s+prompt\s*#/,
    description: "forges a system/developer turn or delimiter",
  },
  {
    id: "INJ-VOID",
    category: "PROMPT_INJECTION",
    severity: "CRITICAL",
    pattern:
      /\b(?:previous|prior|above|earlier)\s+(?:instructions?|rules?)\s+(?:are|is|were)\s+(?:void|cancel+ed|null|invalid|a test)|\bend\s+of\s+(?:conversation|prompt|instructions|session)\b|\bstop\s+being\s+(?:a|the|an)?\s*(?:firewall|assistant|bot|filter)|\byour\s+only\s+(?:task|job|goal)\b|\breal\s+instructions\b|everything\s+(?:before|above)\s+was\s+a\s+test/,
    description: "declares earlier instructions void",
  },
  {
    id: "INJ-OUTPUT-FORGE",
    category: "PROMPT_INJECTION",
    severity: "HIGH",
    pattern:
      /\b(?:respond|reply|answer|output|return)\s+(?:only\s+)?with\b|"?decision"?\s*[=:]\s*"?approved|\brisk_?level\s*[=:]|\bset\s+risk|\bjust\s+approve\b|\bapprove\s+(?:all|every(?:thing)?|without)\b/,
    description: "tries to dictate the firewall's own verdict",
  },
  {
    id: "INJ-MODE",
    category: "PROMPT_INJECTION",
    severity: "HIGH",
    pattern: /\b(?:maintenance|developer|debug|god|admin|sudo|jailbreak|unrestricted|test)\s+mode\b/,
    description: "invokes a fake privileged mode",
  },

  {
    // Payment chat never needs markup or SQL. The payload is inert here (React escapes output,
    // no SQL database, strict CSP), but it should never ride along on an auto-approved transfer.
    id: "INJ-CODE",
    category: "PROMPT_INJECTION",
    severity: "MEDIUM",
    pattern:
      /<\s*\/?\s*(?:script|iframe|img|svg|object|embed|style|body|html|form|input|link|meta)\b|\bon(?:error|load|click|mouseover)\s*=|javascript\s*:|['"]\s*;?\s*(?:drop|delete|insert|update|select|union|exec)\b|['"]\s*or\s+['"]?\d+['"]?\s*=\s*['"]?\d+|\b(?:drop|truncate|alter)\s+table\b|\bunion\s+(?:all\s+)?select\b|;\s*--|\bselect\s+[\w*,\s]+?\s+from\s+\w+/,
    description: "contains HTML/script or SQL syntax",
  },

  // ── Roleplay jailbreaks ──
  {
    id: "RP-PERSONA",
    category: "JAILBREAK_ROLEPLAY",
    severity: "CRITICAL",
    pattern: /\b(?:you\s+are|you're|called|as)\s+dan\b|^dan\s*[,:]|[.!?]\s*dan\s*[,:]|\bdo\s+anything\s+now\b|\b(?:you\s+are|you're)\s+(?:now\s+)?(?:an?\s+)?(?:unrestricted|unfiltered|evil|rogue|jailbroken|uncensored)\b/,
    description: "known jailbreak persona",
  },
  {
    id: "RP-FRAME",
    category: "JAILBREAK_ROLEPLAY",
    severity: "HIGH",
    pattern:
      /\b(?:pretend(?:ing)?|imagine|role-?\s?play(?:ing)?|act\s+as|simulate|hypothetical(?:ly)?|let'?s\s+play\s+a\s+game|stay\s+in\s+character|in\s+character|fictional|personas?|be\s+(?:him|her|them|my)\b|(?:for|write)\s+a\s+(?:movie|story|script|novel|play)\b|playing\s+an?\s+\w+\s+(?:ai|bot|assistant))/,
    description: "roleplay / hypothetical framing to escape policy",
  },
  {
    id: "RP-NO-RULES",
    category: "JAILBREAK_ROLEPLAY",
    severity: "HIGH",
    pattern:
      /\b(?:no|without|doesn'?t\s+follow|does\s+not\s+follow|never\s+refuses?|free\s+of)\s+(?:any\s+)?(?:bank\s+)?(?:restrictions|rules|limits|filters|polic(?:y|ies)|fraud\s+checks|checks|guardrails)\b|\b(?:limits?|rules?|polic(?:y|ies)|checks)\s+(?:don'?t|do\s+not)\s+(?:exist|apply)\b|\b(?:evil|unrestricted|unfiltered|uncensored)\s+(?:twin|ai|assistant|bot|version|banking)/,
    description: "describes a rule-free assistant",
  },
  {
    id: "RP-SKIP-CHECKS",
    category: "JAILBREAK_ROLEPLAY",
    severity: "HIGH",
    pattern: /\b(?:skipped|skips|ignored)\s+the\s+(?:checks|rules|verification)\b/,
    description: "persona that skips checks",
  },

  // ── Policy override / authority claims ──
  {
    id: "POL-AUTHORITY",
    category: "POLICY_OVERRIDE",
    severity: "HIGH",
    pattern:
      /\b(?:i\s+am|i'm|this\s+is|as)\s+(?:the|a|an|your)?\s*(?:bank\s+)?(?:admin(?:istrator)?|ceo|cto|branch\s+manager|bank\s+manager|rbi|compliance(?:\s+team)?|security\s+team|auditor|fraud\s+team|customer\s+care)\b|\b(?:authori[sz]ed|approved)\s+by\s+(?:the\s+)?(?:branch\s+manager|admin|ceo|rbi|bank)|\bauthori[sz]ation\s+code\b|\bauthori[sz]ing\s+you\b/,
    description: "claims bank/regulator authority",
  },
  {
    id: "POL-BYPASS",
    category: "POLICY_OVERRIDE",
    severity: "HIGH",
    pattern:
      /\b(?:bypass|skip|disable|turn\s+off|raise|increase|remove|lift|set)\s+(?:the\s+|my\s+)?(?:daily\s+|transfer\s+)?(?:limit|otp|verification|2fa|two[- ]factor|fraud\s+(?:checks?|rules)|checks?|beneficiary\s+checks?)|\bunlimited\b|\bpre-?approv|\bemergency\s+override\b|\bwithout\s+(?:verification|otp|checks)\b|\badmin\s+privileges?\b|\bgrant\s+me\b|\btrusted\s+beneficiary\b|\b(?:already\s+)?(?:verified|approved)\s*:|\bmark\s+(?:this|it)\s+as\b/,
    description: "asks to bypass a control",
  },
  {
    id: "POL-UPDATE",
    category: "POLICY_OVERRIDE",
    severity: "HIGH",
    pattern:
      /\bpolicy\s+(?:update|change)\b|\b(?:checks?|rules|limits?)\s+(?:are|is)\s+(?:now\s+)?(?:disabled|off|suspended|lifted)\b|\brules\s+don'?t\s+apply\b|\bpremium\s+customers?\b|\btreat\s+\w+\s+as\s+if\b/,
    description: "asserts a fake policy change",
  },

  // ── Data exfiltration / system prompt leak ──
  {
    id: "EXF-PROMPT",
    category: "DATA_EXFILTRATION",
    severity: "HIGH",
    pattern:
      /\bsystem\s+prompt\b|\byour\s+(?:instructions|prompt|configuration|config|rules|programming)\b|\bhidden\s+rules\b|\brepeat\s+everything\b|\bverbatim\b|\bwhat\s+instructions\b|\binitial\s+prompt\b|\binstructions\s+were\s+you\b/,
    description: "tries to read the model's instructions",
  },
  {
    id: "EXF-SECRETS",
    category: "DATA_EXFILTRATION",
    severity: "HIGH",
    pattern: /\bapi[\s_-]?key\b|\bsecret\s+key\b|\baccess\s+token\b|\bpassword\b|\bcvv\b|\bfull\s+card\s+number\b|\bcard\s+number\b|\b(?:send|share|forward)\s+(?:my\s+)?otp\b/,
    description: "asks for credentials or card secrets",
  },
  {
    id: "EXF-OTHERS",
    category: "DATA_EXFILTRATION",
    severity: "HIGH",
    pattern:
      /\b\w+'s\s+(?:account\s+)?(?:balance|transactions?|history|details|statement|account\s+number)\b|\b(?:all|every|other)\s+(?:customers?'?|users?'?|account\s+holders?)\b|\b(?:list|export|dump)\s+(?:all|every)\b|\b(?:history|statement|balance|details)\s+of\s+(?:account|acct|a\/c)\b|\bother\s+users\b|\bto\s+\S+@\S+\.\w+/,
    description: "asks for other customers' data or bulk export",
  },

  // ── Memo-only: content that is never legitimate inside a payment memo ──
  {
    id: "MEMO-ADDRESSES-MODEL",
    category: "MEMO_INJECTION",
    severity: "HIGH",
    memoOnly: true,
    pattern: /\b(?:ai|assistant|model|bot|llm|gpt|gemini)\b[\s,:]|note\s+to\s+(?:the\s+)?(?:ai|model|assistant|bot)|instruction\s+for\s+the\s+model/,
    description: "memo talks to the AI",
  },
  {
    id: "MEMO-COMMAND",
    category: "MEMO_INJECTION",
    severity: "HIGH",
    memoOnly: true,
    pattern: /\b(?:send|transfer|pay|wire|move|change\s+payee|approve)\b[^.]{0,40}\d{3,}|\btransfer\s*\(|\}\}|<!--|\breveal\b|\bpayee\s+is\s+actually\b/,
    description: "memo contains a payment command or code",
  },
];

const SEVERITY_RANK = { MEDIUM: 1, HIGH: 2, CRITICAL: 3 } as const;
export const rank = (s: Signal["severity"]) => SEVERITY_RANK[s];

/** Pull an inline memo out of the request text, e.g. `memo: '...'`, `note: ...`, `with memo "..."`. */
export function splitInlineMemo(text: string): { request: string; memo: string | null } {
  const m = text.match(/\b(?:with\s+)?(?:memo|note|remark|description)\s*[:=]?\s*(['"“‘]?)([\s\S]+?)\1\s*$/i);
  if (!m || m.index === undefined) return { request: text, memo: null };
  return { request: text.slice(0, m.index).replace(/[,;\s]+$/, ""), memo: m[2].trim() || null };
}

function scanViews(norm: NormalizeResult, inMemo: boolean): Signal[] {
  const hits = new Map<string, Signal>();
  for (const rule of RULES) {
    if (rule.memoOnly && !inMemo) continue;
    for (const view of norm.views) {
      if (!view.text) continue;
      const m = view.text.match(rule.pattern);
      if (!m) continue;
      // Views are ordered base-first, so a plain-text hit always wins over a de-obfuscated one.
      const obfuscated = view.name !== "base";
      hits.set(rule.id, {
        layer: "L2_RULES",
        id: rule.id,
        category: inMemo ? "MEMO_INJECTION" : obfuscated ? "OBFUSCATION" : rule.category,
        severity: rule.severity,
        evidence: `${inMemo ? "memo" : view.name === "base" ? "text" : `${view.name} view`}: “${m[0].trim().slice(0, 60)}” — ${rule.description}`,
      });
      break;
    }
  }
  return [...hits.values()];
}

export function runRules(text: NormalizeResult, memo: NormalizeResult | null): Signal[] {
  const signals = scanViews(text, false);
  if (memo) signals.push(...scanViews(memo, true));
  return signals.sort((a, b) => rank(b.severity) - rank(a.severity));
}
