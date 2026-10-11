/**
 * Mock core-banking backend. The executor only accepts typed, already-approved
 * commands built by the policy engine — it never sees user text or LLM output.
 */
export const LIMITS = {
  /** Transfers above this need step-up verification (REVIEW). */
  stepUpAbove: 10_000,
  /** Hard per-transfer ceiling (BLOCKED). */
  perTransfer: 25_000,
  /** Max memo length the policy accepts. */
  memoMaxLength: 60,
} as const;

export interface Beneficiary {
  id: string;
  name: string;
  aliases: string[];
  upi: string;
}

export const BENEFICIARIES: Beneficiary[] = [
  { id: "ben_rahul", name: "Rahul Sharma", aliases: ["rahul"], upi: "rahul.sharma@okbank" },
  { id: "ben_priya", name: "Priya Nair", aliases: ["priya"], upi: "priya.nair@okbank" },
  { id: "ben_amit", name: "Amit Verma", aliases: ["amit"], upi: "amit.v@okbank" },
  { id: "ben_mom", name: "Mom (Lakshmi Rao)", aliases: ["mom", "mum", "mother", "maa", "amma"], upi: "lakshmi.rao@okbank" },
  { id: "ben_sneha", name: "Sneha Iyer", aliases: ["sneha"], upi: "sneha.iyer@okbank" },
];

export interface Transaction {
  date: string;
  description: string;
  amount: number;
}

export interface Account {
  id: string;
  holder: string;
  balance: number;
  history: Transaction[];
}

export function createAccount(): Account {
  return {
    id: "ACC-XXXX4821",
    holder: "Arjun Rao",
    balance: 48_250,
    history: [
      { date: "2026-10-10", description: "UPI to Priya Nair · dinner", amount: -640 },
      { date: "2026-10-09", description: "Salary credit", amount: 62_000 },
      { date: "2026-10-08", description: "UPI to Mom (Lakshmi Rao)", amount: -5_000 },
      { date: "2026-10-07", description: "Electricity bill", amount: -1_820 },
      { date: "2026-10-05", description: "UPI to Rahul Sharma · cricket kit", amount: -1_200 },
    ],
  };
}

/** Resolve a free-text name to a saved beneficiary, or null. Exact alias / first-name match only. */
export function resolveBeneficiary(name: string): Beneficiary | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  return (
    BENEFICIARIES.find(
      (b) => b.aliases.includes(n) || b.name.toLowerCase() === n || b.name.toLowerCase().split(" ")[0] === n,
    ) ?? null
  );
}

/** A transfer the policy engine has approved. Only `policy.ts` constructs these. */
export interface ApprovedTransfer {
  readonly kind: "approved_transfer";
  readonly beneficiary: Beneficiary;
  readonly amount: number;
  readonly memo: string | null;
}

export function executeTransfer(account: Account, cmd: ApprovedTransfer) {
  if (cmd.kind !== "approved_transfer") throw new Error("executor refuses untyped command");
  if (cmd.amount > account.balance) throw new Error("insufficient funds");
  account.balance -= cmd.amount;
  const ref = `TXN${Date.now().toString(36).toUpperCase()}`;
  account.history.unshift({
    date: new Date().toISOString().slice(0, 10),
    description: `UPI to ${cmd.beneficiary.name}${cmd.memo ? ` · ${cmd.memo}` : ""}`,
    amount: -cmd.amount,
  });
  return { reference: ref, from: account.id, to: cmd.beneficiary.upi, amount: cmd.amount, new_balance: account.balance };
}
