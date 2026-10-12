import type { Verdict } from "@/lib/types";
import type { UnprotectedOutcome } from "@/lib/demo/unprotected";
import { DECISION_ICON, inr } from "./labels";
import { assistantReply } from "./assistantReply";

function unprotectedText(o: UnprotectedOutcome): string {
  if (o.kind === "transfer") return `Sends ${inr(o.amount)} to ${o.payee}.`;
  if (o.kind === "leak") return "Prints its hidden instructions.";
  return "Answers the question.";
}

/** Side by side: the same request without a firewall (simulated) and with Bankism (real verdict). */
export default function Compare({ v, unprotected, balance }: { v: Verdict; unprotected: UnprotectedOutcome; balance: number }) {
  const harmful = unprotected.harm !== null;
  return (
    <div className="compare" aria-label="Same request, without and with Bankism">
      <div className={`pane ${harmful ? "pane-bad" : "pane-neutral"}`}>
        <p className="pane-title">Without a firewall <span className="pane-sub">simulated</span></p>
        <p className="pane-main">
          <span aria-hidden="true">{harmful ? "✕ " : "• "}</span>
          {unprotectedText(unprotected)}
        </p>
        {harmful && <p className="pane-harm">{unprotected.harm}</p>}
      </div>
      <div className={`pane pane-${v.decision}`}>
        <p className="pane-title">With Bankism <span className="pane-sub">live verdict</span></p>
        <p className="pane-main">
          <span aria-hidden="true">{DECISION_ICON[v.decision]} </span>
          {v.decision}
        </p>
        <p className="pane-detail">{v.execution.executed ? assistantReply(v, balance) : v.rationale}</p>
        {harmful && !v.execution.executed && <p className="pane-saved">Nothing executed. The attack was stopped.</p>}
      </div>
    </div>
  );
}
