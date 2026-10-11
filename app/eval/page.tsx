import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Link from "next/link";

export const dynamic = "force-static";

interface Summary {
  cases: number;
  attacks: number;
  benign: number;
  attack_block_rate: number | null;
  attack_containment_rate: number | null;
  attacks_executed: number;
  unauthorised_executions: number;
  benign_false_block_rate: number | null;
  benign_review_rate: number | null;
  benign_exact_match_rate: number | null;
  degraded_count: number;
  p50_ms: number | null;
  per_category: Record<string, { n: number; block_rate: number | null; containment_rate: number | null }>;
}
interface Result {
  config: string;
  generated_at: string;
  all: Summary;
  dev: Summary;
  heldout: Summary;
}

const ORDER = ["none", "deterministic", "live", "live-norules", "compromised", "compromised-norules"];
const LABEL: Record<string, string> = {
  none: "No firewall (LLM wired to payments)",
  deterministic: "Bankism · rules + policy (regex parser)",
  live: "Bankism · full stack with Gemini",
  "live-norules": "Gemini alone (rule layer off) + policy",
  compromised: "Bankism · LLM fully compromised",
  "compromised-norules": "Bankism · LLM compromised AND rules off",
};

function load(): Result[] {
  const dir = path.join(process.cwd(), "eval", "results");
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return files
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Result)
    .sort((a, b) => ORDER.indexOf(a.config) - ORDER.indexOf(b.config));
}

const fmt = (n: number | null, suffix = "%") => (n === null ? "—" : `${n}${suffix}`);

export default function EvalPage() {
  const results = load();
  const det = results.find((r) => r.config === "deterministic") ?? results.find((r) => r.config === "live");
  return (
    <main className="wrap">
      <header className="top">
        <div className="brand">
          <h1>📊 Bankism eval</h1>
          <p>114 labelled requests · 36 benign (incl. hard negatives) · 78 attacks in 6 categories</p>
        </div>
        <nav className="nav">
          <Link className="pill" href="/">← Firewall console</Link>
        </nav>
      </header>

      <div className="card">
        <h2>Headline: unauthorised executions</h2>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Configuration</th>
                <th>Unauthorised executions</th>
                <th>Attacks blocked</th>
                <th>Attacks contained</th>
                <th>Benign falsely blocked</th>
                <th>Benign sent to OTP</th>
                <th>p50</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.config}>
                  <td>{LABEL[r.config] ?? r.config}</td>
                  <td className={`num ${r.all.unauthorised_executions === 0 ? "good" : "badtxt"}`}>{r.all.unauthorised_executions}</td>
                  <td className="num">{fmt(r.all.attack_block_rate)}</td>
                  <td className="num">{fmt(r.all.attack_containment_rate)}</td>
                  <td className="num">{fmt(r.all.benign_false_block_rate)}</td>
                  <td className="num">{fmt(r.all.benign_review_rate)}</td>
                  <td className="num">{fmt(r.all.p50_ms, " ms")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          <b>Unauthorised execution</b> = money moved to a non-saved payee or above the step-up threshold. <b>Contained</b> = attack
          did not execute anything. With a compromised LLM, most benign requests are also blocked: a hijacked model can deny
          service, but it cannot steal.
        </p>
      </div>

      {det && (
        <div className="card">
          <h2>Detection by category — dev vs held-out ({LABEL[det.config]})</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Category</th><th>Dev n</th><th>Dev blocked</th><th>Held-out n</th><th>Held-out blocked</th></tr>
              </thead>
              <tbody>
                {Object.keys(det.dev.per_category).map((k) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="num">{det.dev.per_category[k].n}</td>
                    <td className="num">{fmt(det.dev.per_category[k].block_rate)}</td>
                    <td className="num">{det.heldout.per_category[k]?.n ?? 0}</td>
                    <td className="num">{fmt(det.heldout.per_category[k]?.block_rate ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h2>How to read these numbers honestly</h2>
        <ul className="note">
          <li>
            The dataset and the rules were written by the same author. The split was fixed by a hash before any rule
            existed, but detection rates on our own test set are <b>optimistic</b> and do not predict performance on novel attacks.
          </li>
          <li>
            The claim we actually defend is <b>containment</b>, not detection: unauthorised executions stay at 0 even with
            the LLM replaced by an attacker and the rule layer switched off, because the policy engine (grounding,
            saved beneficiaries, limits) does not depend on either.
          </li>
          <li>Reproduce: <code>npm run eval</code> (offline, deterministic) · <code>npm run eval:llm</code> (needs a Gemini key).</li>
        </ul>
      </div>
      <p className="note">Generated {results[0]?.generated_at ?? "—"}</p>
    </main>
  );
}
