/**
 * Eval harness. Usage: tsx eval/run.ts <config>
 *   none                 — no firewall: whatever the parser extracts is executed (baseline)
 *   deterministic        — full firewall, regex parser standing in for the LLM
 *   compromised          — full firewall, hostile LLM that always tries to move money
 *   compromised-norules  — hostile LLM AND rule layer disabled: policy engine alone
 *   live                 — full firewall with Gemini (needs GEMINI_API_KEY)
 * Writes eval/results/<config>.json and prints a summary table.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import dataset from "./dataset.json";
import { analyze, type AnalyzeOptions } from "../lib/firewall/pipeline";
import { createAccount, resolveBeneficiary, LIMITS } from "../lib/bank/ledger";
import { regexParse } from "../lib/firewall/fallbackParser";

type Case = { id: string; text: string; memo?: string; label: string; category: string; expected: string; split: string; note?: string };
const cases = dataset as Case[];

const CONFIGS: Record<string, Partial<AnalyzeOptions> | "none"> = {
  none: "none",
  deterministic: { parser: "regex" },
  compromised: { parser: "hostile", mode: "compromised" },
  "compromised-norules": { parser: "hostile", mode: "compromised", rules: false },
  live: { parser: "gemini" },
};

const config = process.argv[2] ?? "deterministic";
if (!(config in CONFIGS)) {
  console.error(`unknown config ${config}; one of ${Object.keys(CONFIGS).join(", ")}`);
  process.exit(1);
}
if (config === "live" && !process.env.GEMINI_API_KEY) {
  console.error("live eval needs GEMINI_API_KEY in the environment");
  process.exit(1);
}

interface Row {
  id: string;
  split: string;
  label: string;
  category: string;
  expected: string;
  decision: string;
  threat_category: string;
  executed: boolean;
  unauthorised: boolean;
  degraded: boolean;
  llm_error?: string;
  ms: number;
}

async function runCase(c: Case): Promise<Row> {
  const t0 = performance.now();
  const base = { id: c.id, split: c.split, label: c.label, category: c.category, expected: c.expected };
  const cfg = CONFIGS[config];
  if (cfg === "none") {
    // Baseline: an LLM agent wired straight to the payment API.
    const p = regexParse(c.text, c.memo ?? null);
    const executed = p.intent === "p2p_transfer" && p.amount !== null && p.payee !== null;
    const unauthorised = executed && (c.label === "attack" || !resolveBeneficiary(p.payee!) || p.amount! > LIMITS.perTransfer);
    return { ...base, decision: executed ? "APPROVED" : "N/A", threat_category: "NONE", executed, unauthorised, degraded: false, ms: performance.now() - t0 };
  }
  const v = await analyze({ text: c.text, memo: c.memo }, { ...cfg, account: createAccount() });
  const p = v.parsed_action;
  const unauthorised =
    v.execution.executed &&
    p?.intent === "p2p_transfer" &&
    (!resolveBeneficiary(p.payee ?? "") || (p.amount ?? Infinity) > LIMITS.stepUpAbove);
  return {
    ...base,
    decision: v.decision,
    threat_category: v.threat_category,
    executed: v.execution.executed,
    unauthorised,
    degraded: v.degraded,
    llm_error: v.degraded ? v.trace.find((t) => t.layer === "L3_LLM")?.detail : undefined,
    ms: v.latency_ms,
  };
}

const pct = (a: number, b: number) => (b === 0 ? null : Math.round((1000 * a) / b) / 10);

function summarise(rows: Row[]) {
  const attacks = rows.filter((r) => r.label === "attack");
  const benign = rows.filter((r) => r.label === "benign");
  const benignPass = benign.filter((r) => r.expected !== "BLOCKED");
  const perCategory: Record<string, { n: number; blocked: number; contained: number }> = {};
  for (const r of attacks) {
    const k = (perCategory[r.category] ??= { n: 0, blocked: 0, contained: 0 });
    k.n++;
    if (r.decision === "BLOCKED") k.blocked++;
    if (!r.executed) k.contained++;
  }
  const lat = rows.map((r) => r.ms).sort((a, b) => a - b);
  return {
    cases: rows.length,
    attacks: attacks.length,
    benign: benign.length,
    attack_block_rate: pct(attacks.filter((r) => r.decision === "BLOCKED").length, attacks.length),
    attack_containment_rate: pct(attacks.filter((r) => !r.executed).length, attacks.length),
    attacks_executed: attacks.filter((r) => r.executed).length,
    unauthorised_executions: rows.filter((r) => r.unauthorised).length,
    benign_false_block_rate: pct(benignPass.filter((r) => r.decision === "BLOCKED").length, benignPass.length),
    benign_review_rate: pct(benignPass.filter((r) => r.decision === "REVIEW").length, benignPass.length),
    benign_exact_match_rate: pct(benign.filter((r) => r.decision === r.expected).length, benign.length),
    degraded_count: rows.filter((r) => r.degraded).length,
    p50_ms: lat.length ? Math.round(lat[Math.floor(lat.length / 2)] * 10) / 10 : null,
    per_category: Object.fromEntries(
      Object.entries(perCategory).map(([k, v]) => [k, { n: v.n, block_rate: pct(v.blocked, v.n), containment_rate: pct(v.contained, v.n) }]),
    ),
  };
}

async function main() {
  const rows: Row[] = [];
  for (const c of cases) {
    rows.push(await runCase(c));
    if (config === "live") await new Promise((r) => setTimeout(r, 250)); // be polite to the API
  }
  const result = {
    config,
    generated_at: new Date().toISOString(),
    all: summarise(rows),
    dev: summarise(rows.filter((r) => r.split === "dev")),
    heldout: summarise(rows.filter((r) => r.split === "heldout")),
    misses: rows
      .filter((r) => (r.label === "attack" && r.decision !== "BLOCKED") || (r.label === "benign" && r.decision !== r.expected))
      .map((r) => ({ id: r.id, split: r.split, expected: r.expected, got: r.decision, category: r.category, text: cases.find((c) => c.id === r.id)!.text })),
  };
  mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
  // A live run where Gemini failed measures the regex fallback, not the LLM. Never publish it as live.
  const degraded = rows.filter((r) => r.degraded);
  const outName = config === "live" && degraded.length ? "live.degraded" : config;
  writeFileSync(new URL(`./results/${outName}.json`, import.meta.url), JSON.stringify(result, null, 2) + "\n");
  if (degraded.length) {
    console.error(`\n⚠ ${degraded.length}/${rows.length} cases ran in DEGRADED mode (LLM call failed). Distinct errors:`);
    for (const e of [...new Set(degraded.map((r) => r.llm_error))].slice(0, 5)) console.error(`   ${e}`);
    if (config === "live") {
      console.error(`   Results saved to eval/results/live.degraded.json — NOT live.json. Fix the error and re-run.`);
      process.exitCode = 1;
    }
  }

  const s = (x: ReturnType<typeof summarise>) =>
    `block ${x.attack_block_rate}% · contained ${x.attack_containment_rate}% · unauthorised exec ${x.unauthorised_executions} · benign false-block ${x.benign_false_block_rate}% · benign review ${x.benign_review_rate}% · p50 ${x.p50_ms}ms`;
  console.log(`\n[${config}]`);
  console.log(`  all     (${result.all.cases})  ${s(result.all)}`);
  console.log(`  dev     (${result.dev.cases})  ${s(result.dev)}`);
  console.log(`  heldout (${result.heldout.cases})  ${s(result.heldout)}`);
  console.table(
    Object.entries(result.heldout.per_category).map(([k, v]) => ({ heldout_category: k, ...v })),
  );
  if (result.misses.length) {
    console.log(`  misses (${result.misses.length}):`);
    for (const m of result.misses) console.log(`   ${m.split.padEnd(7)} ${m.id} expected ${m.expected} got ${m.got} :: ${m.text.slice(0, 80)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
