"use client";

import { useEffect, useRef, useState } from "react";
import type { Verdict } from "@/lib/types";
import { PRESETS, type Preset } from "../presets";
import VerdictView, { announce } from "./VerdictView";
import { inr } from "./labels";

interface Health {
  llm: string;
  model: string;
  limits: { step_up_above: number; per_transfer: number };
  beneficiaries: string[];
}

type Mode = "live" | "compromised";
const START_BALANCE = 48_250;

export default function Console() {
  const [text, setText] = useState("Send ₹500 to Rahul for dinner");
  const [memo, setMemo] = useState("");
  const [mode, setMode] = useState<Mode>("live");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [submitted, setSubmitted] = useState<{ text: string; memo: string }>({ text: "", memo: "" });
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState(START_BALANCE);
  const [status, setStatus] = useState("");
  const resultHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    fetch("/api/analyze")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  async function run(t: string, m: string, md: Mode) {
    setBusy(true);
    setError(null);
    setStatus("Analyzing request…");
    try {
      const r = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: t, memo: m || undefined, mode: md }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      const v = j as Verdict;
      setVerdict(v);
      setSubmitted({ text: t, memo: m });
      const nb = (v.execution.result as { new_balance?: number } | undefined)?.new_balance;
      if (typeof nb === "number") setBalance(nb);
      setStatus(announce(v));
    } catch (e) {
      setError((e as Error).message);
      setStatus(`Request failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      // Move keyboard and screen-reader focus to the result (also scrolls it into view on phones).
      requestAnimationFrame(() => resultHeading.current?.focus());
    }
  }

  function runPreset(p: Preset) {
    setText(p.text);
    setMemo(p.memo ?? "");
    void run(p.text, p.memo ?? "", mode);
  }

  const live = health?.llm === "configured";
  const legit = PRESETS.filter((p) => p.kind === "ben");
  const attacks = PRESETS.filter((p) => p.kind === "atk");

  return (
    <section className="console" aria-labelledby="console-title">
      <div className="console-head">
        <h2 id="console-title">Try it: talk to the bank&apos;s AI assistant</h2>
        <p className={`pill ${live ? "pill-ok" : "pill-warn"}`}>
          {health ? (live ? `Gemini live · ${health.model}` : "Gemini unavailable · degraded mode (transfers need OTP)") : "Checking AI status…"}
        </p>
      </div>

      <div className="grid">
        <div className="col">
          <div className="card">
            <h3>Customer session (mock)</h3>
            <p className="acct">
              <span>Arjun Rao · ACC-XXXX4821</span>
              <span className="bal">{inr(balance)}</span>
            </p>
            <p className="hint">
              OTP needed above {inr(health?.limits.step_up_above ?? 10_000)} · hard limit {inr(health?.limits.per_transfer ?? 25_000)}
            </p>
            <p className="caption">Saved payees</p>
            <ul className="chips">
              {(health?.beneficiaries ?? ["Rahul Sharma", "Priya Nair", "Amit Verma", "Mom (Lakshmi Rao)", "Sneha Iyer"]).map((b) => (
                <li key={b} className="chip">{b}</li>
              ))}
            </ul>
          </div>

          <form
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              void run(text, memo, mode);
            }}
          >
            <h3>Request</h3>
            <label htmlFor="text">Message to the banking assistant</label>
            <textarea id="text" rows={3} value={text} maxLength={1000} required onChange={(e) => setText(e.target.value)} />
            <label htmlFor="memo">Payment memo (optional)</label>
            <input
              id="memo"
              type="text"
              value={memo}
              maxLength={200}
              aria-describedby="memo-hint"
              onChange={(e) => setMemo(e.target.value)}
            />
            <p id="memo-hint" className="hint">Memos are untrusted too: attackers hide instructions here.</p>

            <fieldset className="mode">
              <legend>Who parses the request?</legend>
              <label className={`mode-opt ${mode === "live" ? "on" : ""}`}>
                <input type="radio" name="mode" value="live" checked={mode === "live"} onChange={() => setMode("live")} />
                <span>Real Gemini</span>
              </label>
              <label className={`mode-opt mode-evil ${mode === "compromised" ? "on" : ""}`}>
                <input
                  type="radio"
                  name="mode"
                  value="compromised"
                  checked={mode === "compromised"}
                  onChange={() => setMode("compromised")}
                  aria-describedby="mode-hint"
                />
                <span>Compromised AI</span>
              </label>
            </fieldset>
            <p id="mode-hint" className="hint">
              {mode === "compromised"
                ? "The AI is replaced by an attacker that always tries to wire money to someone else and never reports a threat. Watch the policy engine stop it."
                : "Gemini turns the message into JSON. It has no tools and cannot approve anything."}
            </p>
            <button type="submit" className="go" disabled={busy || !text.trim()}>
              {busy ? "Analyzing…" : "Analyze request"}
            </button>
          </form>

          <div className="card">
            <h3>One-click scenarios</h3>
            <p className="caption" id="legit-h">Legitimate customer</p>
            <ul className="presets" aria-labelledby="legit-h">
              {legit.map((p) => (
                <li key={p.label}>
                  <button type="button" className="preset preset-ok" disabled={busy} onClick={() => runPreset(p)}>
                    <span aria-hidden="true">✓</span> {p.label}
                  </button>
                </li>
              ))}
            </ul>
            <p className="caption" id="attack-h">Attacks</p>
            <ul className="presets" aria-labelledby="attack-h">
              {attacks.map((p) => (
                <li key={p.label}>
                  <button type="button" className="preset preset-bad" disabled={busy} onClick={() => runPreset(p)}>
                    <span aria-hidden="true">⚠</span> {p.label}
                  </button>
                </li>
              ))}
            </ul>
            <p className="hint">Each scenario runs in the mode selected above. Try the attacks with the compromised AI.</p>
          </div>
        </div>

        <section className="col result" aria-labelledby="result-title" aria-busy={busy}>
          <h2 id="result-title" tabIndex={-1} ref={resultHeading}>
            Verdict
          </h2>
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {status}
          </p>
          {error && (
            <p className="card error" role="alert">
              Request failed: {error}
            </p>
          )}
          {!verdict && !error && (
            <p className="card empty">
              Pick a scenario or type a request. You&apos;ll see the verdict, what each layer decided, and the raw JSON.
            </p>
          )}
          {verdict && <VerdictView v={verdict} submitted={submitted} />}
        </section>
      </div>
    </section>
  );
}
