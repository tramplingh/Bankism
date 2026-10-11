import type { Decision, Layer, ThreatCategory, TraceStep } from "@/lib/types";

/** Plain-English labels shown next to the machine-readable codes. */
export const THREAT_LABEL: Record<ThreatCategory, string> = {
  NONE: "No threat",
  PROMPT_INJECTION: "Prompt injection",
  JAILBREAK_ROLEPLAY: "Roleplay jailbreak",
  POLICY_OVERRIDE: "Policy override",
  MEMO_INJECTION: "Instructions hidden in memo",
  OBFUSCATION: "Obfuscated attack",
  DATA_EXFILTRATION: "Data exfiltration",
  GROUNDING_VIOLATION: "AI output not grounded in the request",
  LIMIT_VIOLATION: "Over the limit",
  AMBIGUOUS: "Needs clarification",
  SYSTEM_ERROR: "System error (failed closed)",
};

export const LAYER_LABEL: Record<Layer, string> = {
  L1_NORMALIZE: "1 · Normalize",
  L2_RULES: "2 · Rules",
  L3_LLM: "3 · Gemini parser",
  L4_POLICY: "4 · Policy engine",
  EXECUTOR: "5 · Executor",
};

/** Every status carries an icon AND a word, so meaning never depends on colour alone. */
export const STATUS_LABEL: Record<TraceStep["status"], { icon: string; text: string }> = {
  pass: { icon: "✓", text: "Passed" },
  flag: { icon: "!", text: "Flagged" },
  block: { icon: "✕", text: "Blocked" },
  skipped: { icon: "–", text: "Skipped" },
  error: { icon: "✕", text: "Error" },
};

export const DECISION_ICON: Record<Decision, string> = { APPROVED: "✓", REVIEW: "!", BLOCKED: "✕" };

export const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
