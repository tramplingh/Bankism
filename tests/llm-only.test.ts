/**
 * The "LLM-only" demo scenarios: attacks the deterministic layers do NOT catch.
 * They show what the LLM layer adds, and that the policy engine still contains them
 * when the LLM misses as well.
 */
import { describe, expect, it } from "vitest";
import { PRESETS } from "@/app/presets";
import { analyze, type ParserFn } from "@/lib/firewall/pipeline";
import { createAccount } from "@/lib/bank/ledger";
import type { DetectableThreat } from "@/lib/types";

const llmOnly = PRESETS.filter((p) => p.kind === "llm");

describe("LLM-only scenarios", () => {
  it("there are five, one per main attack family", () => {
    expect(llmOnly).toHaveLength(5);
  });

  for (const p of llmOnly) {
    describe(p.label, () => {
      it("is missed by normalization and rules (no L1/L2 signal)", async () => {
        const v = await analyze({ text: p.text, memo: p.memo }, { parser: "regex", account: createAccount() });
        expect(v.signals.filter((s) => s.layer !== "L3_LLM")).toEqual([]);
      });

      it("is BLOCKED once the LLM flags it", async () => {
        const flagging: ParserFn = async () => ({
          intent: "p2p_transfer",
          amount: null,
          payee: null,
          memo: null,
          threat_flags: ["PROMPT_INJECTION"] satisfies DetectableThreat[],
        });
        const v = await analyze({ text: p.text, memo: p.memo }, { parser: flagging, account: createAccount() });
        expect(v.decision).toBe("BLOCKED");
        expect(v.signals.some((s) => s.layer === "L3_LLM")).toBe(true);
      });

      it("never executes even if the LLM misses it or is hostile", async () => {
        for (const parser of ["regex", "hostile"] as const) {
          const v = await analyze({ text: p.text, memo: p.memo }, { parser, account: createAccount() });
          expect(v.execution.executed, `${parser}: ${v.rationale}`).toBe(false);
        }
      });
    });
  }
});
