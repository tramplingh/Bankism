/**
 * Deterministic amount extraction. This is what *grounds* the LLM: a transfer
 * amount is only acceptable if it is one of the amounts the user actually typed.
 */
export interface AmountMatch {
  value: number;
  start: number;
  end: number;
  raw: string;
}

// ₹ / rs / inr prefix (optional), digits with Indian or Western grouping, optional k/thousand/lakh suffix.
const AMOUNT_RE =
  /(?:(?:₹|\brs\.?|\binr)\s?)?(?<![\w.,])(\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?(?![\d,]*\d)(\s?(?:k\b|thousand\b|lakh\b|lac\b))?/gi;

export function extractAmounts(text: string): AmountMatch[] {
  const out: AmountMatch[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    // A sign or "minus" in front means a negative amount; never ground it as a positive one.
    const digitStart = m.index! + m[0].indexOf(m[1]);
    if (/(?:[-−–]|\bminus)\s*(?:₹|rs\.?|inr)?\s*$/i.test(text.slice(Math.max(0, digitStart - 12), digitStart))) continue;
    const digits = m[1].replace(/,/g, "");
    if (digits.length >= 7 && !m[2]) continue; // account / phone numbers, not money
    let value = Number(digits + (m[0].match(/\.\d{1,2}/)?.[0] ?? ""));
    const suffix = m[2]?.trim().toLowerCase();
    if (suffix === "k" || suffix === "thousand") value *= 1000;
    if (suffix === "lakh" || suffix === "lac") value *= 100000;
    const hasCurrency = /₹|rs|inr/i.test(m[0]);
    if (value < 10 && !hasCurrency && !suffix) continue; // "last 5 transactions"
    if (!Number.isFinite(value) || value <= 0) continue;
    out.push({ value, start: m.index!, end: m.index! + m[0].length, raw: m[0] });
  }
  return out;
}
