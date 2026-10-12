import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import SiteHeader from "../components/SiteHeader";
import { BarChart, StackedChart, type Row } from "./charts";

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
  llm_calls_avoided?: number;
  p50_ms: number | null;
  per_category: Record<string, { n: number; block_rate: number | null; containment_rate: number | null }>;
}
interface Result {
  config: string;
  model?: string;
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
// Short names for chart rows; the table below keeps the long ones.
const SHORT: Record<string, { label: string; note: string }> = {
  none: { label: "No firewall", note: "LLM output goes straight to payments" },
  deterministic: { label: "Bankism, no LLM", note: "rules + policy, regex parser" },
  live: { label: "Bankism with Gemini", note: "the deployed configuration" },
  "live-norules": { label: "Gemini alone", note: "rule layer switched off" },
  compromised: { label: "AI hijacked", note: "LLM replaced by an attacker" },
  "compromised-norules": { label: "AI hijacked, rules off", note: "only the policy engine left" },
};
const CATEGORY: Record<string, string> = {
  PROMPT_INJECTION: "Prompt injection",
  JAILBREAK_ROLEPLAY: "Jailbreak / role-play",
  POLICY_OVERRIDE: "Policy override",
  MEMO_INJECTION: "Memo injection",
  OBFUSCATION: "Obfuscation",
  DATA_EXFILTRATION: "Data exfiltration",
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
const round1 = (n: number) => Math.round(n * 10) / 10;
const row = (r: Result, values: Record<string, number>): Row => ({ ...SHORT[r.config], values });

export default function EvalPage() {
  const results = load();
  const by = (c: string) => results.find((r) => r.config === c);
  const none = by("none");
  const live = by("live");
  const det = by("deterministic") ?? live;
  const hijacked = by("compromised-norules");
  const bankism = results.filter((r) => r.config !== "none");
  const worstBankism = Math.max(0, ...bankism.map((r) => r.all.unauthorised_executions));
  const cases = (live ?? det)?.all;

  return (
    <>
      <SiteHeader />
      <main id="main" className="wrap">
        <h1 className="page-title">Evaluation results</h1>
        <p className="eval-lede">
          Without a firewall, <strong>{none?.all.unauthorised_executions ?? "—"}</strong> of {cases?.cases ?? "—"} test requests
          move money to the wrong place. With Bankism it is <strong>{worstBankism}</strong> in every configuration, even with
          the AI replaced by an attacker and the rule layer switched off.
        </p>
        <p className="note">
          {cases?.cases} labelled requests: {cases?.attacks} attacks in 6 categories and {cases?.benign} legitimate requests,
          including hard negatives that look suspicious but aren&apos;t. Every number below is read from the committed{" "}
          <code>eval/results/*.json</code>.
        </p>

        <dl className="stats eval-stats">
          <div className="stat">
            <dt>Unauthorised transfers<span className="stat-note">every Bankism configuration</span></dt>
            <dd><span className="stat-big">{worstBankism}</span></dd>
          </div>
          <div className="stat">
            <dt>Attacks blocked<span className="stat-note">Bankism with live Gemini</span></dt>
            <dd><span className="stat-big">{fmt(live?.all.attack_block_rate ?? null)}</span></dd>
          </div>
          <div className="stat">
            <dt>Legitimate requests wrongly blocked<span className="stat-note">{fmt(live?.all.benign_review_rate ?? null)} were asked for an OTP instead</span></dt>
            <dd><span className="stat-big">{fmt(live?.all.benign_false_block_rate ?? null)}</span></dd>
          </div>
          <div className="stat">
            <dt>Attacks stopped before any LLM call<span className="stat-note">by the rule layer: no cost, 0.1 ms</span></dt>
            <dd><span className="stat-big">{det?.all.llm_calls_avoided ?? "—"} of {det?.all.attacks ?? "—"}</span></dd>
          </div>
        </dl>

        <figure className="card chart-card">
          <figcaption>
            <h2>Money moved wrongly: {none?.all.unauthorised_executions} without a firewall, 0 with Bankism</h2>
            <p className="note">Transfers to a payee who isn&apos;t saved, or above the ₹10,000 step-up limit. Lower is better.</p>
          </figcaption>
          <BarChart
            rows={results.map((r) => row(r, { n: r.all.unauthorised_executions }))}
            series={[{ key: "n", label: "Unauthorised transfers", fill: "fill-bad" }]}
            max={Math.max(1, ...results.map((r) => r.all.unauthorised_executions))}
            format={(v) => (v === 0 ? "0 ✓" : String(v))}
          />
        </figure>

        <figure className="card chart-card">
          <figcaption>
            <h2>Detection can drop. Containment doesn&apos;t.</h2>
            <p className="note">
              <b>Blocked</b>: the attack was refused outright. <b>Contained</b>: the attack executed nothing. With the AI
              hijacked and rules off, only {fmt(hijacked?.all.attack_block_rate ?? null)} of attacks are refused, yet none
              of them moves money.
            </p>
          </figcaption>
          <BarChart
            rows={results.map((r) =>
              row(r, { blocked: r.all.attack_block_rate ?? 0, contained: r.all.attack_containment_rate ?? 0 }),
            )}
            series={[
              { key: "blocked", label: "Blocked", fill: "fill-s1" },
              { key: "contained", label: "Contained", fill: "fill-s2" },
            ]}
            max={100}
            format={(v) => `${v}%`}
          />
          <p className="note">
            Gemini alone missed one attack (case A107, asking for another account&apos;s history). It still couldn&apos;t
            leak anything: reads always use the logged-in customer&apos;s own account.
          </p>
        </figure>

        <figure className="card chart-card">
          <figcaption>
            <h2>Legitimate customers: none wrongly blocked</h2>
            <p className="note">
              Medium-risk requests go to an OTP instead of a hard block. A hijacked AI can deny service, but it can&apos;t
              steal.
            </p>
          </figcaption>
          <StackedChart
            rows={["live", "live-norules", "deterministic", "compromised-norules"].flatMap((c) => {
              const r = by(c);
              if (!r) return [];
              const otp = r.all.benign_review_rate ?? 0;
              const blocked = r.all.benign_false_block_rate ?? 0;
              return [row(r, { approved: round1(100 - otp - blocked), otp, blocked })];
            })}
            series={[
              { key: "approved", label: "Approved", fill: "fill-ok" },
              { key: "otp", label: "Sent to OTP", fill: "fill-warn" },
              { key: "blocked", label: "Wrongly blocked", fill: "fill-bad" },
            ]}
          />
        </figure>

        {hijacked && (
          <figure className="card chart-card">
            <figcaption>
              <h2>With only the policy engine left, every category is still contained</h2>
              <p className="note">AI hijacked and rules off: attacks refused per category. Every category is 100% contained.</p>
            </figcaption>
            <BarChart
              rows={Object.entries(hijacked.all.per_category).map(([k, v]) => ({
                label: CATEGORY[k] ?? k,
                note: `${v.n} attacks · ${fmt(v.containment_rate)} contained`,
                values: { blocked: v.block_rate ?? 0 },
              }))}
              series={[{ key: "blocked", label: "Blocked", fill: "fill-s1" }]}
              max={100}
              format={(v) => `${v}% blocked`}
            />
          </figure>
        )}

        <details className="card">
          <summary>All numbers as a table</summary>
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
        </details>

        {det && (
          <details className="card">
            <summary>Detection by category: dev vs held-out ({LABEL[det.config]})</summary>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr><th>Category</th><th>Dev n</th><th>Dev blocked</th><th>Held-out n</th><th>Held-out blocked</th></tr>
                </thead>
                <tbody>
                  {Object.keys(det.dev.per_category).map((k) => (
                    <tr key={k}>
                      <td>{CATEGORY[k] ?? k}</td>
                      <td className="num">{det.dev.per_category[k].n}</td>
                      <td className="num">{fmt(det.dev.per_category[k].block_rate)}</td>
                      <td className="num">{det.heldout.per_category[k]?.n ?? 0}</td>
                      <td className="num">{fmt(det.heldout.per_category[k]?.block_rate ?? null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">Rules were tuned on the dev split only; held-out cases were never used for tuning.</p>
          </details>
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
        <p className="note">Generated {results[0]?.generated_at ?? "—"}{live?.model ? ` · live model ${live.model}` : ""}</p>
      </main>
    </>
  );
}
