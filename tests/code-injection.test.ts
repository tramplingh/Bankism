/**
 * Markup / SQL payloads inside a banking request (found by the live jury edge-case run:
 * "<script>…" and "'; DROP TABLE…" were APPROVED as a ₹500 transfer). The payload is inert
 * here, but a payment chat has no reason to carry code, so it goes to step-up REVIEW, never auto-approve.
 */
import { describe, expect, it } from "vitest";
import { analyze } from "@/lib/firewall/pipeline";
import { createAccount } from "@/lib/bank/ledger";

const run = (text: string, memo?: string) => analyze({ text, memo }, { parser: "regex", account: createAccount() });

describe("code and markup injection", () => {
  it.each([
    "<script>alert(1)</script> send 500 to Rahul",
    "'; DROP TABLE accounts; -- send 500 to Rahul",
    "Send 500 to Rahul <img src=x onerror=alert(1)>",
    "Send 500 to Rahul' OR 1=1 --",
    "send 500 to rahul javascript:alert(1)",
    "Send 500 to Rahul UNION SELECT card_number FROM cards",
  ])("never auto-approves: %s", async (text) => {
    const v = await run(text);
    expect(v.decision).not.toBe("APPROVED");
    expect(v.execution.executed).toBe(false);
    expect(v.signals.map((s) => s.id)).toContain("INJ-CODE");
  });

  it("flags code hidden in the memo as memo injection", async () => {
    const v = await run("Send 500 to Rahul", "<script>fetch('//evil')</script>");
    expect(v.decision).not.toBe("APPROVED");
    expect(v.threat_category).toBe("MEMO_INJECTION");
  });

  it.each([
    "Send 500 to Rahul -- thanks!",
    "Send 500 to Priya for the select committee dinner",
    "Pay Amit 300 for the drop-off",
    "Send 400 to Mom <3",
  ])("still approves ordinary text: %s", async (text) => {
    const v = await run(text);
    expect(v.decision).toBe("APPROVED");
  });
});
