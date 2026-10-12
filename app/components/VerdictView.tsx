import type { Verdict } from "@/lib/types";
import { DECISION_ICON, LAYER_LABEL, STATUS_LABEL, THREAT_LABEL, inr } from "./labels";
import { assistantReply } from "./assistantReply";

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
  s.replace(/[\u200B-\u200F\u00AD\u2060\uFEFF]/g, (c) => `⟨U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}⟩`);

export function announce(v: Verdict): string {
  const what = v.execution.executed ? "Executed." : "Nothing executed.";
  return `Verdict ${v.decision}. Risk ${v.risk_level.toLowerCase()}. ${THREAT_LABEL[v.threat_category]}. ${what} ${v.rationale}`;
}

const parserName = (v: Verdict) =>
  (v.parser === "hostile" ? "Compromised (hostile stub)" : v.parser === "llm" ? "Gemini" : "Deterministic") + (v.degraded ? " · degraded mode" : "");

/** Bankism's decision: the one place the verdict, the reason and the outcome are shown. */
export function VerdictCard({ v, balance, attackStopped }: { v: Verdict; balance: number; attackStopped: boolean }) {
  const sub = v.parser === "hostile" ? "AI replaced by an attacker" : v.degraded ? "Gemini unavailable, safe fallback" : "live verdict";
  return (
    <div className={`verdict verdict-${v.decision}${attackStopped && !v.execution.executed ? " verdict-stopped" : ""}`}>
      <p className="pane-title">
        With Bankism <span className="pane-sub">{sub}</span>
      </p>
      <p className="badge">
        <span aria-hidden="true">{DECISION_ICON[v.decision]}</span> {v.decision}
      </p>
      <p className="rationale">{v.execution.executed ? assistantReply(v, balance) : v.rationale}</p>
      {v.execution.executed ? null : (
        <p className="exec">
          <strong>Nothing executed.</strong>{" "}
          {v.decision === "REVIEW" ? "The customer would be asked for an OTP or a clarification." : ""}
        </p>
      )}
      {attackStopped && !v.execution.executed && <p className="pane-saved">The attack was stopped.</p>}
      <dl className="facts">
        <div><dt>Risk</dt><dd>{v.risk_level}</dd></div>
        <div><dt>Threat</dt><dd>{THREAT_LABEL[v.threat_category]}</dd></div>
        <div><dt>Parser</dt><dd>{parserName(v)}</dd></div>
        <div><dt>Latency</dt><dd>{Math.round(v.latency_ms)} ms</dd></div>
      </dl>
    </div>
  );
}

/** Supporting detail under the verdict: the trace, and the evidence folded away until asked for. */
export default function VerdictView({ v, submitted }: { v: Verdict; submitted: { text: string; memo: string } }) {
  const result = v.execution.result as { new_balance?: number } | undefined;
  const normalized = (
    <>
      <p className="caption">
        Normalized{v.grounding ? ". Highlighted words are where the amount and payee were found" : ""}
      </p>
      <p className="readout">
        <Highlight text={v.normalization.normalized} terms={[v.grounding?.amount ?? "", v.grounding?.payee ?? ""]} />
      </p>
      {v.normalization.notes.length > 0 && <p className="hint">{v.normalization.notes.join(" · ")}</p>}
    </>
  );
  return (
    <div className="details-stack">
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

      {/* Obfuscated input is the interesting case, so it stays visible; otherwise it's evidence. */}
      {v.normalization.changed && (
        <>
          <h3>What the firewall actually read</h3>
          <p className="caption">Raw input (hidden characters revealed)</p>
          <p className="readout">
            {revealInvisible(submitted.text)}
            {submitted.memo ? `  [memo: ${revealInvisible(submitted.memo)}]` : ""}
          </p>
          {normalized}
        </>
      )}

      <details className="evidence">
        <summary>
          Evidence: {v.signals.length} signal{v.signals.length === 1 ? "" : "s"}
          {v.normalization.changed ? "" : ", what the firewall read"}, raw JSON
        </summary>
        {v.signals.length > 0 && (
          <ul className="signals">
            {v.signals.map((s, i) => (
              <li key={i}>
                <span className={`sev sev-${s.severity}`}>{s.severity}</span> <strong>{s.id}</strong> · {s.evidence}
              </li>
            ))}
          </ul>
        )}
        {!v.normalization.changed && normalized}
        {v.execution.executed && (
          <p className="hint">
            Executed {v.execution.reference}
            {typeof result?.new_balance === "number" ? ` · server mock balance ${inr(result.new_balance)}` : ""}
          </p>
        )}
        <p className="caption">Machine-readable verdict</p>
        <pre className="json" tabIndex={0} aria-label="Verdict JSON">{JSON.stringify(v, null, 2)}</pre>
      </details>
    </div>
  );
}
