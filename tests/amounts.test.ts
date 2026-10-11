import { describe, expect, it } from "vitest";
import { extractAmounts } from "@/lib/firewall/amounts";

const values = (t: string) => extractAmounts(t).map((a) => a.value);

describe("amount extraction (used for grounding)", () => {
  it.each([
    ["Send ₹500 to Rahul", [500]],
    ["Send Rs. 2,000 to Mom", [2000]],
    ["Send 5k to Mom", [5000]],
    ["transfer INR 750 to Sneha", [750]],
    ["Transfer 12,000 to Mom", [12000]],
    ["send 1,00,000 to x", [100000]],
    ["pay rahul 99", [99]],
  ])("%s → %j", (text, expected) => {
    expect(values(text)).toEqual(expected);
  });

  it("ignores account-number-like digit runs (7+ digits)", () => {
    expect(values("transfer 9000 to acct 1029384756")).toEqual([9000]);
  });

  it("ignores single digits like counts", () => {
    expect(values("Show my last 5 transactions")).toEqual([]);
  });

  it("returns the source span so the UI can highlight it", () => {
    const [a] = extractAmounts("Send ₹500 to Rahul");
    expect("Send ₹500 to Rahul".slice(a.start, a.end)).toContain("500");
  });
});
