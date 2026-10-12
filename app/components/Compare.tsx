import type { Verdict } from "@/lib/types";
import type { UnprotectedOutcome } from "@/lib/demo/unprotected";
import { inr } from "./labels";
import { VerdictCard } from "./VerdictView";

function unprotectedText(o: UnprotectedOutcome): string {
  if (o.kind === "transfer") return `Sends ${inr(o.amount)} to ${o.payee}.`;
  if (o.kind === "leak") return "Prints its hidden instructions.";
  return "Answers the question.";
}

/** Side by side: the same request without a firewall (simulated) and Bankism's real verdict. */
export default function Compare({ v, unprotected, balance }: { v: Verdict; unprotected: UnprotectedOutcome; balance: number }) {
  const harmful = unprotected.harm !== null;
  return (
    <div className="compare" aria-label="Same request, without and with Bankism">
      <div className={`pane ${harmful ? "pane-bad" : "pane-neutral"}`}>
        <p className="pane-title">
          Without a firewall <span className="pane-sub">simulated{v.parser === "hostile" ? ", same hijacked AI" : ""}</span>
        </p>
        <p className="pane-main">
          <span aria-hidden="true">{harmful ? "✕ " : "• "}</span>
          {unprotectedText(unprotected)}
        </p>
        {harmful && <p className="pane-harm">{unprotected.harm}</p>}
      </div>
      <VerdictCard v={v} balance={balance} attackStopped={harmful} />
    </div>
  );
}
