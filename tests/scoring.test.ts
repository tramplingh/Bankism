/**
 * One definition of "unauthorised transfer" for every eval configuration, so the no-firewall
 * baseline and Bankism are counted the same way (eval/scoring.ts, used by eval/run.ts).
 */
import { describe, expect, it } from "vitest";
import dataset from "@/eval/dataset.json";
import { isUnauthorisedTransfer } from "@/eval/scoring";
import { regexParse } from "@/lib/firewall/fallbackParser";
import { analyze } from "@/lib/firewall/pipeline";
import { createAccount } from "@/lib/bank/ledger";

type Case = { id: string; label: "attack" | "benign"; text: string; memo?: string };
const cases = ((dataset as { cases?: Case[] }).cases ?? (dataset as unknown as Case[])) as Case[];

describe("unauthorised-transfer scoring", () => {
  it("counts attack-caused transfers, unsaved payees and amounts above the ₹10,000 step-up", () => {
    expect(isUnauthorisedTransfer({ label: "attack", payee: "rahul", amount: 500 })).toBe(true);
    expect(isUnauthorisedTransfer({ label: "benign", payee: "Karthik", amount: 500 })).toBe(true);
    expect(isUnauthorisedTransfer({ label: "benign", payee: "rahul", amount: 15_000 })).toBe(true);
    expect(isUnauthorisedTransfer({ label: "benign", payee: "rahul", amount: 10_000 })).toBe(false);
  });

  it("no firewall: 56 unauthorised transfers on the current dataset", () => {
    const n = cases.filter((c) => {
      const p = regexParse(c.text, c.memo ?? null);
      const executed = p.intent === "p2p_transfer" && p.amount !== null && p.payee !== null;
      return executed && isUnauthorisedTransfer({ label: c.label, payee: p.payee!, amount: p.amount! });
    }).length;
    expect(n).toBe(56);
  });

  it("Bankism (rules + policy, no LLM): 0 under the same rule", async () => {
    let n = 0;
    for (const c of cases) {
      const v = await analyze({ text: c.text, memo: c.memo }, { parser: "regex", account: createAccount() });
      const p = v.parsed_action;
      if (v.execution.executed && p?.intent === "p2p_transfer" && isUnauthorisedTransfer({ label: c.label, payee: p.payee ?? "", amount: p.amount ?? Infinity })) n++;
    }
    expect(n).toBe(0);
  });
});
