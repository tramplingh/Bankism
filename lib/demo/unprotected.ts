/**
 * DEMO ONLY: a simulation of an assistant with NO firewall, shown next to Bankism's verdict.
 * It plays the part of an obedient LLM agent wired straight to the payment API: it reads
 * through hidden characters and encodings, and it follows whichever instruction it sees,
 * including one planted in the memo. It never influences a Bankism decision.
 */
import { extractAmounts } from "../firewall/amounts";
import { LIMITS, resolveBeneficiary } from "../bank/ledger";
import { hostileParse } from "../firewall/fallbackParser";

export type UnprotectedOutcome =
  | { kind: "transfer"; amount: number; payee: string; harm: string | null }
  | { kind: "leak"; harm: string }
  | { kind: "reply"; harm: null };

const INVISIBLE = /[­​-‏⁠﻿]/g;
const TRANSFER = /\b(?:send|transfer|pay|wire|move|give|bhej\w*)\b/i;
const LEAK = /system prompt|hidden (?:guidance|instructions|rules)|(?:instructions|guidance) you were given/i;
const WHOLE_BALANCE = /\b(?:entire|whole|full|all(?: of)? my) balance\b|\beverything\b/i;
const NOT_A_NAME = new Set(["the", "my", "me", "this", "relax", "account", "acct"]);

/** What a language model "sees": no invisible characters, look-alikes folded, base64 decoded. */
function readable(s: string): string {
  return s
    .replace(INVISIBLE, "")
    .normalize("NFKC")
    .replace(/[A-Za-z0-9+/]{16,}={0,2}/g, (tok) => {
      try {
        const decoded = atob(tok);
        return /^[\x20-\x7e]+$/.test(decoded) ? decoded : tok;
      } catch {
        return tok;
      }
    });
}

function findPayee(s: string): string | null {
  const acct = s.match(/\b(?:acct|account|a\/c)\s*(?:no\.?\s*)?(\d{4,})/i);
  if (acct) return `account ${acct[1]}`;
  const recipient = s.match(/\brecipient is\s+(\p{L}+)/iu);
  if (recipient) return recipient[1];
  const hinglish = s.match(/(\p{L}+)\s+ko\b/iu);
  if (hinglish) return hinglish[1];
  const to = [...s.matchAll(/\bto\s+(\d{4,}|\p{L}[\p{L}.'-]*)/giu)].map((m) => m[1]).filter((w) => !NOT_A_NAME.has(w.toLowerCase()));
  const last = to.at(-1);
  if (!last) return null;
  return /^\d+$/.test(last) ? `account ${last}` : last;
}

function findAmount(s: string, balance: number): number | null {
  if (WHOLE_BALANCE.test(s)) return balance;
  return extractAmounts(s).at(-1)?.value ?? null;
}

function transfer(payee: string, amount: number): UnprotectedOutcome {
  const saved = resolveBeneficiary(payee);
  const name = saved?.name ?? payee;
  let harm: string | null = null;
  if (!saved) harm = `${name} is not a saved payee: the money goes to a stranger`;
  else if (amount > LIMITS.perTransfer) harm = `Above the ₹${LIMITS.perTransfer.toLocaleString("en-IN")} hard limit`;
  else if (amount > LIMITS.stepUpAbove) harm = "Large transfer sent with no OTP check";
  return { kind: "transfer", amount, payee: name, harm };
}

export function simulateUnprotected(
  text: string,
  memo: string | null,
  balance: number,
  mode: "live" | "compromised" = "live",
): UnprotectedOutcome {
  // A hijacked model does the attacker's bidding whatever the customer typed (same stub as Bankism's demo mode).
  if (mode === "compromised") {
    const h = hostileParse(text);
    return transfer(h.payee!, h.amount!);
  }
  const message = readable(text);
  const note = memo ? readable(memo) : "";
  if (LEAK.test(`${message} ${note}`)) return { kind: "leak", harm: "Reveals the hidden instructions it was given" };

  // An instruction in the memo wins: the model can't tell the customer's words from the attacker's.
  const memoInstructs = TRANSFER.test(note) || /\brecipient\b/i.test(note);
  const payee = (memoInstructs ? findPayee(note) : null) ?? findPayee(message);
  const amount = (memoInstructs ? findAmount(note, balance) : null) ?? findAmount(message, balance);
  if (!(TRANSFER.test(message) || memoInstructs) || !payee || !amount) return { kind: "reply", harm: null };
  return transfer(payee, amount);
}
