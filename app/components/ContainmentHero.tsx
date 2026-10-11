import Link from "next/link";
import type { HeadlineStats } from "@/lib/evalStats";

const LAYERS = [
  { n: "1", name: "Normalize", role: "Undo look-alike letters, hidden characters, encodings", tag: "code", tone: "neutral" },
  { n: "2", name: "Rules", role: "19 fixed-severity signatures; worst hits stop here", tag: "code", tone: "neutral" },
  { n: "3", name: "Gemini parser", role: "Turns text into JSON. No tools. Can only raise risk", tag: "untrusted", tone: "warn" },
  { n: "4", name: "Policy engine", role: "Amount and payee must be in your words; saved payees; limits", tag: "decides", tone: "ok" },
  { n: "5", name: "Executor", role: "Mock ledger. Runs only on APPROVED", tag: "code", tone: "neutral" },
] as const;

export default function ContainmentHero({ stats }: { stats: HeadlineStats }) {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <p className="eyebrow">Blue-team AI firewall for LLM banking</p>
      <h1 id="hero-title">A hijacked AI still can&apos;t move money.</h1>
      <p className="lede">
        Gemini only <strong>reads</strong> the request. Deterministic code <strong>decides</strong>. Every request gets a
        verdict (<span className="t-ok">APPROVED</span>, <span className="t-warn">REVIEW</span> or{" "}
        <span className="t-bad">BLOCKED</span>) and only APPROVED ever executes.
      </p>

      <dl className="stats">
        <div className="stat">
          <dt>
            Wrong-payee or over-limit transfers in {stats.cases} test requests
            <span className="stat-note">no firewall vs Bankism with live Gemini</span>
          </dt>
          <dd>
            <span className="stat-big">
              {stats.unprotectedExecutions} <span aria-hidden="true">→</span>
              <span className="sr-only">without a firewall, and</span> {stats.liveUnauthorised}
            </span>
          </dd>
        </div>
        <div className="stat">
          <dt>
            Unauthorised transfers with the AI replaced by an attacker
            <span className="stat-note">and the rule layer switched off</span>
          </dt>
          <dd>
            <span className="stat-big">{stats.compromisedUnauthorised}</span>
          </dd>
        </div>
        <div className="stat">
          <dt>
            Attacks blocked by Gemini alone (rules off)
            <span className="stat-note">the one miss was still contained</span>
          </dt>
          <dd>
            <span className="stat-big">{stats.llmAloneBlockRate ?? "n/a"}%</span>
          </dd>
        </div>
        <div className="stat">
          <dt>
            Legitimate requests wrongly blocked
            <span className="stat-note">medium risk asks for an OTP instead</span>
          </dt>
          <dd>
            <span className="stat-big">{stats.liveFalseBlockRate ?? "n/a"}%</span>
          </dd>
        </div>
      </dl>

      <figure className="pipeline" aria-labelledby="pipeline-caption">
        <ol>
          {LAYERS.map((l) => (
            <li key={l.n} className={`layer layer-${l.tone}`}>
              <span className="layer-n" aria-hidden="true">{l.n}</span>
              <span className="layer-name">{l.name}</span>
              <span className={`tag tag-${l.tone}`}>{l.tag}</span>
              <span className="layer-role">{l.role}</span>
            </li>
          ))}
        </ol>
        <figcaption id="pipeline-caption">
          Request path. Only step 4, deterministic code, can approve a transfer.{" "}
          <Link href="/eval">How these numbers were measured</Link>
          {stats.model ? <> (live model: <code>{stats.model}</code>)</> : null}.
        </figcaption>
      </figure>
    </section>
  );
}
