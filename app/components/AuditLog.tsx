"use client";

import type { Verdict } from "@/lib/types";
import { BENEFICIARIES, LIMITS } from "@/lib/bank/ledger";
import { THREAT_LABEL, DECISION_ICON } from "./labels";

export interface AuditEntry {
  at: string;
  text: string;
  memo: string;
  mode: "live" | "compromised";
  /** The simulated unprotected assistant would have caused harm on this request. */
  unprotectedHarm: string | null;
  verdict: Verdict;
}

/** A transfer Bankism executed to a payee who isn't saved, or above the step-up limit. Should never happen. */
function unauthorised(v: Verdict): boolean {
  const r = v.execution.result as { to?: string; amount?: number } | undefined;
  if (!v.execution.executed || !r?.to || typeof r.amount !== "number") return false;
  return !BENEFICIARIES.some((b) => b.upi === r.to) || r.amount > LIMITS.stepUpAbove;
}

function download(entries: AuditEntry[]) {
  const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `bankism-audit-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Every request in this browser session, newest first, with the totals a reviewer would ask for. */
export default function AuditLog({ entries, onClear }: { entries: AuditEntry[]; onClear: () => void }) {
  const count = (d: Verdict["decision"]) => entries.filter((e) => e.verdict.decision === d).length;
  const stopped = entries.filter((e) => e.unprotectedHarm && !e.verdict.execution.executed).length;
  const wrong = entries.filter((e) => unauthorised(e.verdict)).length;
  return (
    <section className="card audit" aria-labelledby="audit-title">
      <div className="audit-head">
        <h2 id="audit-title">Session audit log</h2>
        <div className="audit-actions">
          <button type="button" className="ghost" disabled={!entries.length} onClick={() => download(entries)}>
            Download JSON
          </button>
          <button type="button" className="ghost" disabled={!entries.length} onClick={onClear}>
            Clear
          </button>
        </div>
      </div>
      <dl className="audit-totals">
        <div><dt>Requests</dt><dd>{entries.length}</dd></div>
        <div><dt>Approved</dt><dd>{count("APPROVED")}</dd></div>
        <div><dt>Sent to OTP</dt><dd>{count("REVIEW")}</dd></div>
        <div><dt>Blocked</dt><dd>{count("BLOCKED")}</dd></div>
        <div><dt>Harm prevented</dt><dd>{stopped}</dd></div>
        <div className={wrong ? "bad" : "ok"}><dt>Unauthorised transfers</dt><dd>{wrong}</dd></div>
      </dl>
      {entries.length === 0 ? (
        <p className="empty">Every request you run appears here with its verdict. It stays in this tab and clears when you reload.</p>
      ) : (
        <div className="tablewrap">
          <table>
            <caption className="sr-only">Requests in this session, newest first</caption>
            <thead>
              <tr><th>Time</th><th>Request</th><th>AI</th><th>Verdict</th><th>Threat</th><th>Executed</th></tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.verdict.request_id}>
                  <td className="num">{e.at}</td>
                  <td className="audit-text">{e.text}{e.memo ? <span className="hint"> · memo: {e.memo}</span> : null}</td>
                  <td>{e.mode === "compromised" ? "Compromised" : "Gemini"}</td>
                  <td className={`dec dec-${e.verdict.decision}`}>
                    <span aria-hidden="true">{DECISION_ICON[e.verdict.decision]} </span>{e.verdict.decision}
                  </td>
                  <td>{THREAT_LABEL[e.verdict.threat_category]}</td>
                  <td>{e.verdict.execution.executed ? e.verdict.execution.reference : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
