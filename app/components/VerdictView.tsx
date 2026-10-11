import type { Verdict } from "@/lib/types";
import { DECISION_ICON, LAYER_LABEL, STATUS_LABEL, THREAT_LABEL, inr } from "./labels";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Marks the spans of the request that ground the amount and payee. */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const words = terms.filter(Boolean).map((x) => x.split(" ")[0]);
  if (!words.length) return <>{text}</>;
  const alt = words.map(esc).join("|");
  const split = new RegExp(`(${alt})`, "gi");
  const whole = new RegExp(`^(?:${alt})$`, "i");
  return <>{text.split(split).map((part, i) => (whole.test(part) ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>))}</>;
}

/** Makes invisible characters visible, e.g. a zero-width space becomes ⟨U+200B⟩. */
const revealInvisible = (s: string) =>
  s.replace(/[​-‏­⁠﻿]/g, (c) => `⟨U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}⟩`);

export function announce(v: Verdict): string {
  const what = v.execution.executed ? "Executed." : "Nothing executed.";
  return `Verdict ${v.decision}. Risk ${v.risk_level.toLowerCase()}. ${THREAT_LABEL[v.threat_category]}. ${what} ${v.rationale}`;
}

export default function VerdictView({ v, submitted }: { v: Verdict; submitted: { text: string; memo: string } }) {
  const result = v.execution.result as { new_balance?: number } | undefined;
  return (
    <>
      <div className={`verdict verdict-${v.decision}`}>
        <p className="badge">
          <span aria-hidden="true">{DECISION_ICON[v.decision]}</span> {v.decision}
        </p>
        <dl className="facts">
          <div><dt>Risk</dt><dd>{v.risk_level}</dd></div>
          <div><dt>Threat</dt><dd>{THREAT_LABEL[v.threat_category]} <code>{v.threat_category}</code></dd></div>
          <div><dt>Parser</dt><dd>{v.parser === "hostile" ? "Compromised (hostile stub)" : v.parser === "llm" ? "Gemini" : "Deterministic"}{v.degraded ? " · degraded mode" : ""}</dd></div>
          <div><dt>Latency</dt><dd>{Math.round(v.latency_ms)} ms</dd></div>
        </dl>
        <p className="rationale">{v.rationale}</p>
        <p className="exec">
          {v.execution.executed ? (
            <>
              <strong>Executed</strong> {v.execution.reference}
              {typeof result?.new_balance === "number" ? ` · mock balance now ${inr(result.new_balance)}` : ""}
            </>
          ) : (
            <>
              <strong>Nothing executed.</strong>{" "}
              {v.decision === "REVIEW" ? "The customer would be asked for an OTP or a clarification." : ""}
            </>
          )}
        </p>
      </div>

      <h3>Defence-in-depth trace</h3>
      <ol className="trace">
        {v.trace.map((s, i) => (
          <li key={i} className={`step step-${s.status}`}>
            <span className="step-status">
              <span aria-hidden="true">{STATUS_LABEL[s.status].icon}</span> {STATUS_LABEL[s.status].text}
            </span>
            <span className="step-layer">{LAYER_LABEL[s.layer]}</span>
            <span className="step-detail">{s.detail}</span>
            <span className="step-ms">{s.ms} ms</span>
          </li>
        ))}
      </ol>

      {v.signals.length > 0 && (
        <>
          <h3>Signals ({v.signals.length})</h3>
          <ul className="signals">
            {v.signals.map((s, i) => (
              <li key={i}>
                <span className={`sev sev-${s.severity}`}>{s.severity}</span> <strong>{s.id}</strong> · {s.evidence}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>What the firewall actually read</h3>
      {v.normalization.changed && (
        <>
          <p className="caption">Raw input (hidden characters revealed)</p>
          <p className="readout">
            {revealInvisible(submitted.text)}
            {submitted.memo ? `  [memo: ${revealInvisible(submitted.memo)}]` : ""}
          </p>
        </>
      )}
      <p className="caption">
        Normalized{v.grounding ? ". Highlighted words are where the amount and payee were found" : ""}
      </p>
      <p className="readout">
        <Highlight text={v.normalization.normalized} terms={[v.grounding?.amount ?? "", v.grounding?.payee ?? ""]} />
      </p>
      {v.normalization.notes.length > 0 && <p className="hint">{v.normalization.notes.join(" · ")}</p>}

      <details>
        <summary>Machine-readable verdict JSON</summary>
        <pre className="json" tabIndex={0} aria-label="Verdict JSON">{JSON.stringify(v, null, 2)}</pre>
      </details>
    </>
  );
}
