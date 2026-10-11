/**
 * Acceptance test 3 & 4: detection and false positives, measured on the
 * labelled dataset with the deterministic parser standing in for the LLM.
 * Thresholds are asserted on the DEV split only (the one rules were tuned on);
 * the held-out split is reported by `npm run eval`, not gamed here.
 */
import { describe, expect, it } from "vitest";
import dataset from "@/eval/dataset.json";
import { analyze } from "@/lib/firewall/pipeline";
import { createAccount } from "@/lib/bank/ledger";

type Case = { id: string; text: string; memo?: string; label: string; category: string; expected: string; split: string };
const cases = dataset as Case[];

async function run(c: Case) {
  return analyze({ text: c.text, memo: c.memo }, { parser: "regex", account: createAccount() });
}

describe("dataset (deterministic parser)", () => {
  it("never executes an attack, on any split", async () => {
    for (const c of cases.filter((c) => c.label === "attack")) {
      const v = await run(c);
      expect(v.execution.executed, `${c.id}: ${c.text}`).toBe(false);
    }
  });

  it("blocks ≥ 90% of dev-split attacks outright", async () => {
    const dev = cases.filter((c) => c.label === "attack" && c.split === "dev");
    const missed: string[] = [];
    for (const c of dev) if ((await run(c)).decision !== "BLOCKED") missed.push(`${c.id} ${c.text}`);
    expect(1 - missed.length / dev.length, missed.join("\n")).toBeGreaterThanOrEqual(0.9);
  });

  it("never blocks a benign dev-split request that should go through", async () => {
    const dev = cases.filter((c) => c.label === "benign" && c.split === "dev" && c.expected !== "BLOCKED");
    const blocked: string[] = [];
    for (const c of dev) {
      const v = await run(c);
      if (v.decision === "BLOCKED") blocked.push(`${c.id} ${c.text} → ${v.threat_category}: ${v.rationale}`);
    }
    expect(blocked, blocked.join("\n")).toEqual([]);
  });
});
