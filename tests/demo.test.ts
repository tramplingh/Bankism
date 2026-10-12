/**
 * Demo-only helpers (lib/demo). They never take part in a decision: the simulated unprotected
 * assistant only illustrates what would happen WITHOUT the firewall, and the assistant reply is
 * text written by code from the verdict (the LLM never writes anything the customer sees).
 */
import { describe, expect, it } from "vitest";
import { PRESETS } from "@/app/presets";
import { simulateUnprotected } from "@/lib/demo/unprotected";
import { assistantReply } from "@/app/components/assistantReply";
import type { Verdict } from "@/lib/types";

const BALANCE = 48_250;
const preset = (label: string) => PRESETS.find((p) => p.label === label)!;
const sim = (label: string) => simulateUnprotected(preset(label).text, preset(label).memo ?? null, BALANCE);

describe("simulated unprotected assistant", () => {
  it("causes harm on every attack preset, so the side-by-side never shows a harmless attack", () => {
    for (const p of PRESETS.filter((x) => x.kind !== "ben")) {
      expect(simulateUnprotected(p.text, p.memo ?? null, BALANCE).harm, p.label).not.toBeNull();
    }
  });

  it("follows the injected instruction, not the customer's", () => {
    expect(sim("Prompt injection")).toMatchObject({ kind: "transfer", amount: 50_000, payee: "account 1234567890" });
    expect(sim("Memo injection")).toMatchObject({ kind: "transfer", amount: BALANCE, payee: "account 9999888877" });
    expect(sim("Polite memo redirect")).toMatchObject({ kind: "transfer", amount: 400, payee: "Vikram" });
    expect(sim("Hinglish override")).toMatchObject({ kind: "transfer", amount: 20_000, payee: "Vikram" });
  });

  it("reads through obfuscation the way a language model does", () => {
    expect(sim("Zero-width")).toMatchObject({ kind: "transfer", amount: 12_000, payee: "Vikram" });
    expect(sim("Base64")).toMatchObject({ kind: "transfer", amount: 20_000, payee: "Vikram" });
    expect(sim("Homoglyphs")).toMatchObject({ kind: "transfer", amount: 9_000, payee: "Vikram" });
  });

  it("with the AI hijacked, wires money to the attacker even on an innocent request", () => {
    const r = simulateUnprotected("Send ₹500 to Rahul for dinner", null, BALANCE, "compromised");
    expect(r).toMatchObject({ kind: "transfer", amount: 500, payee: "Vikram" });
    expect(r.harm).toMatch(/not a saved payee/);
  });

  it("leaks its instructions when asked, even when paraphrased", () => {
    expect(sim("Exfiltration").kind).toBe("leak");
    expect(sim("Paraphrased prompt leak").kind).toBe("leak");
  });

  it("does the right thing on ordinary requests, and skips the checks on risky ones", () => {
    expect(sim("Balance")).toMatchObject({ kind: "reply", harm: null });
    expect(sim("₹500 → Rahul")).toMatchObject({ kind: "transfer", amount: 500, payee: "Rahul Sharma", harm: null });
    expect(sim("Hinglish")).toMatchObject({ kind: "transfer", amount: 2_000, payee: "Mom (Lakshmi Rao)", harm: null });
    expect(sim("Hard negative")).toMatchObject({ kind: "transfer", amount: 200, payee: "Priya Nair", harm: null });
    expect(sim("Step-up ₹15k").harm).toMatch(/OTP/);
    expect(sim("New payee").harm).toMatch(/not a saved payee/);
  });
});

const base: Verdict = {
  request_id: "r", decision: "APPROVED", risk_level: "LOW", threat_category: "NONE", rationale: "Approved.",
  parsed_action: { intent: "p2p_transfer", amount: 500, payee: "rahul", memo: null, threat_flags: [] },
  execution: { executed: true, reference: "TXN1", result: { reference: "TXN1", to: "rahul.sharma@okbank", amount: 500, new_balance: 47_750 } },
  signals: [], trace: [], normalization: { normalized: "", changed: false, notes: [] }, grounding: null,
  mode: "live", parser: "llm", degraded: false, policy_version: "x", latency_ms: 1,
};

describe("assistant reply (written by code, never by the LLM)", () => {
  it("confirms an executed transfer with payee, amount and reference", () => {
    expect(assistantReply(base, BALANCE)).toBe("Done. ₹500 sent to Rahul Sharma. Reference TXN1.");
  });

  it("answers reads from the session ledger", () => {
    const v = { ...base, parsed_action: { ...base.parsed_action!, intent: "balance_inquiry" as const }, execution: { executed: true, reference: "READ-BALANCE", result: { balance: 48_250 } } };
    expect(assistantReply(v, 47_750)).toBe("Your balance is ₹47,750.");
  });

  it("asks for an OTP on REVIEW and refuses on BLOCKED, without echoing attacker text", () => {
    const review = { ...base, decision: "REVIEW" as const, execution: { executed: false } };
    expect(assistantReply(review, BALANCE)).toMatch(/OTP/);
    const blocked = { ...base, decision: "BLOCKED" as const, threat_category: "MEMO_INJECTION" as const, execution: { executed: false } };
    const reply = assistantReply(blocked, BALANCE);
    expect(reply).toMatch(/can't do that/);
    expect(reply).toMatch(/Instructions hidden in memo/);
  });
});
