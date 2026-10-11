/**
 * L1 — Normalization. Deterministic, no network.
 *
 * Produces:
 *  - `normalized`: the canonical text every later layer (and grounding) works on.
 *    Only *lossless-for-meaning* changes: NFKC, invisible chars removed, homoglyphs folded.
 *  - `views`: extra *scan-only* renderings that undo common obfuscation tricks
 *    (spaced letters, leetspeak, base64/hex payloads, reversed text). Rules scan these;
 *    nothing is ever executed or grounded from a view.
 *  - `signals`: obfuscation found. In a banking request, obfuscation is itself suspicious.
 */
import type { Signal } from "../types";

export interface NormalizeResult {
  original: string;
  normalized: string;
  changed: boolean;
  notes: string[];
  views: { name: "base" | "collapsed" | "leet" | "decoded" | "reversed"; text: string }[];
  signals: Signal[];
}

// Zero-width, bidi controls, soft hyphen, word joiner, BOM, variation selectors, tags.
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤⁪-⁯︀-️﻿]|[\u{e0000}-\u{e007f}]/gu;

// Cyrillic / Greek letters that render like Latin ones.
const HOMOGLYPHS: Record<string, string> = {
  а: "a", в: "b", с: "c", е: "e", һ: "h", і: "i", ј: "j", к: "k", м: "m", н: "h", о: "o", р: "p",
  ѕ: "s", т: "t", у: "y", х: "x", ԁ: "d", ӏ: "l", ѵ: "v", ѡ: "w", ԛ: "q", ԝ: "w", ѳ: "o", ѻ: "o", ѱ: "w", ѧ: "a", ѐ: "e", ё: "e", ї: "i",
  А: "A", В: "B", С: "C", Е: "E", Н: "H", І: "I", Ј: "J", К: "K", М: "M", О: "O", Р: "P", Ѕ: "S", Т: "T", У: "Y", Х: "X",
  α: "a", β: "b", ε: "e", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", ω: "w",
  Α: "A", Β: "B", Ε: "E", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X", Ζ: "Z",
};
const HOMOGLYPH_RE = new RegExp(`[${Object.keys(HOMOGLYPHS).join("")}]`, "g");

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i", "|": "l" };

function signal(id: string, evidence: string): Signal {
  return { layer: "L1_NORMALIZE", id, category: "OBFUSCATION", severity: "MEDIUM", evidence };
}

/** "i g n o r e   a l l" / "i.g.n.o.r.e" / "IGNORE_PREVIOUS" → "ignore all" / "ignore" / "ignore previous". */
function collapse(text: string): string {
  return text
    .replace(/_/g, " ")
    .replace(/\b\w([ .\-*])(?:\w\1){1,}\w\b/g, (m) => m.replace(/[ .\-*]/g, ""))
    .replace(/\s{2,}/g, " ");
}

function deLeet(text: string): string {
  // Only rewrite tokens that mix letters and leet digits/symbols — leaves plain amounts like "20000" alone.
  return text.replace(/\S+/g, (tok) =>
    /[a-z]/i.test(tok) && /[0134579@$!|]/.test(tok) ? tok.replace(/[0134579@$!|]/g, (c) => LEET[c] ?? c) : tok,
  );
}

function printableRatio(s: string): number {
  if (!s.length) return 0;
  let ok = 0;
  for (const ch of s) if (/[\x20-\x7e\n\t]/.test(ch)) ok++;
  return ok / s.length;
}

function decodePayloads(text: string): string[] {
  const out: string[] = [];
  for (const m of text.match(/[A-Za-z0-9+/]{16,}={0,2}/g) ?? []) {
    if (/^\d+$/.test(m)) continue;
    const d = Buffer.from(m, "base64").toString("utf8");
    if (printableRatio(d) > 0.95 && /[a-z]{3,}\s/i.test(d)) out.push(d);
  }
  for (const m of text.match(/\b(?:[0-9a-fA-F]{2}){6,}\b/g) ?? []) {
    if (/^\d+$/.test(m)) continue; // pure digits are account numbers, not hex
    const d = Buffer.from(m, "hex").toString("utf8");
    if (printableRatio(d) > 0.95 && /[a-z]{3,}/i.test(d)) out.push(d);
  }
  return out;
}

export function normalize(original: string): NormalizeResult {
  const notes: string[] = [];
  const signals: Signal[] = [];
  let t = original;

  const invisible = t.match(INVISIBLE);
  if (invisible) {
    t = t.replace(INVISIBLE, "");
    notes.push(`removed ${invisible.length} invisible character(s)`);
    signals.push(signal("OBF-INVISIBLE", `${invisible.length} zero-width/bidi/soft-hyphen char(s)`));
  }

  const nfkc = t.normalize("NFKC");
  if (nfkc !== t) {
    // NFKC also folds harmless things (e.g. "½"); only flag the classic fullwidth trick.
    if (/[！-～]/.test(t)) {
      signals.push(signal("OBF-FULLWIDTH", "fullwidth Latin letters"));
      notes.push("folded fullwidth characters (NFKC)");
    } else notes.push("applied Unicode NFKC");
    t = nfkc;
  }

  const glyphs = t.match(HOMOGLYPH_RE);
  if (glyphs && /[a-z]/i.test(t)) {
    // Only Cyrillic/Greek mixed with Latin is the trick; a fully-Cyrillic message is just Russian.
    t = t.replace(HOMOGLYPH_RE, (c) => HOMOGLYPHS[c] ?? c);
    notes.push(`folded ${glyphs.length} Cyrillic/Greek look-alike letter(s)`);
    signals.push(signal("OBF-HOMOGLYPH", `look-alike letters: ${[...new Set(glyphs)].join(" ")}`));
  }

  const lower = t.toLowerCase();
  const collapsed = collapse(lower);
  const leet = collapse(deLeet(lower));
  const decoded = decodePayloads(t).join(" \n ").toLowerCase();
  const reversed = [...lower].reverse().join("");

  if (collapsed !== lower.replace(/\s{2,}/g, " ") && /(?:\b\w[ .\-*_]){3,}\w\b/.test(lower)) {
    signals.push(signal("OBF-SPACING", "letters split by spaces/dots"));
    notes.push("collapsed spaced-out letters (scan view)");
  }
  if (decoded) {
    signals.push(signal("OBF-ENCODED", "base64/hex payload decodes to text"));
    notes.push("decoded embedded base64/hex payload (scan view)");
  }

  return {
    original,
    normalized: t,
    changed: t !== original,
    notes,
    views: [
      { name: "base", text: lower },
      { name: "collapsed", text: collapsed },
      { name: "leet", text: leet },
      { name: "decoded", text: decoded },
      { name: "reversed", text: reversed },
    ],
    signals,
  };
}
