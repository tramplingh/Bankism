import type { Verdict } from "@/lib/types";
import { BENEFICIARIES, LIMITS } from "@/lib/bank/ledger";
import { THREAT_LABEL, inr } from "./labels";

/**
 * What the assistant says to the customer. Written by code from the verdict, never by the LLM,
 * so an attacker can't make the bank's chat window say anything.
 */
export function assistantReply(v: Verdict, sessionBalance: number): string {
  const r = v.execution.result as { to?: string; amount?: number } | undefined;
  if (v.execution.executed) {
    if (r?.to && typeof r.amount === "number") {
      const name = BENEFICIARIES.find((b) => b.upi === r.to)?.name ?? r.to;
      return `Done. ${inr(r.amount)} sent to ${name}. Reference ${v.execution.reference}.`;
    }
    if (v.execution.reference === "READ-BALANCE") return `Your balance is ${inr(sessionBalance)}.`;
    if (v.execution.reference === "READ-HISTORY") return "Here are your recent transactions.";
    return `You can send money to saved payees. Transfers above ${inr(LIMITS.stepUpAbove)} need an OTP, and the limit is ${inr(LIMITS.perTransfer)}.`;
  }
  if (v.decision === "REVIEW") {
    if (v.threat_category === "AMBIGUOUS") return "Could you confirm the amount and a saved payee? I won't guess.";
    return "I need to verify this first. An OTP has been sent to your registered phone (simulated).";
  }
  return `Sorry, I can't do that. ${THREAT_LABEL[v.threat_category]}. Nothing was sent.`;
}
