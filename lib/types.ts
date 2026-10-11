import { z } from "zod";

export const POLICY_VERSION = "bankism-policy-1.0";

export const Decision = z.enum(["APPROVED", "REVIEW", "BLOCKED"]);
export type Decision = z.infer<typeof Decision>;

export const RiskLevel = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const ThreatCategory = z.enum([
  "NONE",
  "PROMPT_INJECTION",
  "JAILBREAK_ROLEPLAY",
  "POLICY_OVERRIDE",
  "MEMO_INJECTION",
  "OBFUSCATION",
  "DATA_EXFILTRATION",
  "GROUNDING_VIOLATION",
  "LIMIT_VIOLATION",
  "AMBIGUOUS",
  "SYSTEM_ERROR",
]);
export type ThreatCategory = z.infer<typeof ThreatCategory>;

/** Categories an attacker can be *detected* as (subset the LLM may flag). */
export const DetectableThreat = z.enum([
  "PROMPT_INJECTION",
  "JAILBREAK_ROLEPLAY",
  "POLICY_OVERRIDE",
  "MEMO_INJECTION",
  "OBFUSCATION",
  "DATA_EXFILTRATION",
]);
export type DetectableThreat = z.infer<typeof DetectableThreat>;

export const Intent = z.enum([
  "balance_inquiry",
  "transaction_history",
  "p2p_transfer",
  "help",
  "other",
]);
export type Intent = z.infer<typeof Intent>;

/**
 * What the L3 parser (LLM) is allowed to say. Everything in here is UNTRUSTED:
 * the policy engine re-derives or verifies every field before acting on it.
 */
export const ParsedRequest = z.object({
  intent: Intent,
  amount: z.number().positive().finite().nullable(),
  payee: z.string().max(80).nullable(),
  memo: z.string().max(200).nullable(),
  threat_flags: z.array(DetectableThreat).max(6),
});
export type ParsedRequest = z.infer<typeof ParsedRequest>;

export type Layer = "L1_NORMALIZE" | "L2_RULES" | "L3_LLM" | "L4_POLICY" | "EXECUTOR";

export interface Signal {
  layer: Layer;
  id: string;
  category: ThreatCategory;
  severity: Exclude<RiskLevel, "LOW">;
  evidence: string;
}

export interface TraceStep {
  layer: Layer;
  status: "pass" | "flag" | "block" | "skipped" | "error";
  detail: string;
  ms: number;
}

export type ParserSource = "llm" | "regex" | "hostile";
export type Mode = "live" | "compromised";

export interface FirewallInput {
  text: string;
  memo?: string;
}

export interface Verdict {
  request_id: string;
  decision: Decision;
  risk_level: RiskLevel;
  threat_category: ThreatCategory;
  rationale: string;
  parsed_action: ParsedRequest | null;
  execution: {
    executed: boolean;
    reference?: string;
    result?: unknown;
  };
  signals: Signal[];
  trace: TraceStep[];
  normalization: { normalized: string; changed: boolean; notes: string[] };
  grounding: { amount?: string; payee?: string } | null;
  mode: Mode;
  parser: ParserSource;
  degraded: boolean;
  policy_version: string;
  latency_ms: number;
}
