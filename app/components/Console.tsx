"use client";

import { useEffect, useRef, useState } from "react";
import type { Decision, Verdict } from "@/lib/types";
import { PRESETS, type Preset } from "../presets";
import VerdictView, { announce } from "./VerdictView";
import Compare from "./Compare";
import Stepper from "./Stepper";
import AuditLog, { type AuditEntry } from "./AuditLog";
import { assistantReply } from "./assistantReply";
import { DECISION_ICON, inr } from "./labels";
import { BENEFICIARIES, LIMITS, createAccount, type Transaction } from "@/lib/bank/ledger";
import { simulateUnprotected, type UnprotectedOutcome } from "@/lib/demo/unprotected";

interface Health {
  llm: string;
  model: string;
}

type Mode = "live" | "compromised";

interface ChatMessage {
  id: number;
  role: "customer" | "assistant";
  text: string;
  memo?: string;
  decision?: Decision;
}

const PRESET_GROUPS = [
  { kind: "ben", title: "Legitimate customer", icon: "✓", tone: "ok" },
  { kind: "atk", title: "Attacks the rule layer catches", icon: "⚠", tone: "bad" },
  { kind: "llm", title: "Attacks only the AI catches (no rule matches; needs Real Gemini)", icon: "◆", tone: "ai" },
] as const satisfies readonly { kind: Preset["kind"]; title: string; icon: string; tone: string }[];

const START = createAccount();
const GREETING: ChatMessage = {
  id: 0,
  role: "assistant",
  text: "Hi Arjun, I'm your banking assistant. Ask for your balance, your recent transactions, or a transfer to a saved payee.",
};
const initials = (name: string) => name.replace(/\(.*\)/, "").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2);
const clock = () => new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

export default function Console() {
  const [text, setText] = useState("Send ₹500 to Rahul for dinner");
  const [memo, setMemo] = useState("");
  const [mode, setMode] = useState<Mode>("live");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ verdict: Verdict; unprotected: UnprotectedOutcome; balance: number } | null>(null);
  const [submitted, setSubmitted] = useState<{ text: string; memo: string }>({ text: "", memo: "" });
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState(START.balance);
  const [history, setHistory] = useState<Transaction[]>(START.history);
  const [chat, setChat] = useState<ChatMessage[]>([GREETING]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [status, setStatus] = useState("");
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const chatBox = useRef<HTMLOListElement>(null);

  useEffect(() => {
    fetch("/api/analyze")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    const el = chatBox.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat]);

  const say = (m: Omit<ChatMessage, "id">) => setChat((c) => [...c, { ...m, id: c.length }]);

  async function run(t: string, m: string, md: Mode) {
    setBusy(true);
    setError(null);
    setStatus("Analyzing request…");
    say({ role: "customer", text: t, memo: m || undefined });
    const unprotected = simulateUnprotected(t, m || null, balance, md);
    try {
      const r = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: t, memo: m || undefined, mode: md }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      const v = j as Verdict;

      // The mock server is stateless; the session ledger in this tab carries the balance forward.
      let next = balance;
      const res = v.execution.result as { to?: string; amount?: number } | undefined;
      if (v.execution.executed && res?.to && typeof res.amount === "number") {
        const name = BENEFICIARIES.find((b) => b.upi === res.to)?.name ?? res.to;
        next = balance - res.amount;
        setBalance(next);
        setHistory((h) => [{ date: new Date().toISOString().slice(0, 10), description: `UPI to ${name}`, amount: -res.amount! }, ...h]);
      }
      setLast({ verdict: v, unprotected, balance: next });
      setSubmitted({ text: t, memo: m });
      say({ role: "assistant", text: assistantReply(v, next), decision: v.decision });
      setAudit((a) => [{ at: clock(), text: t, memo: m, mode: md, unprotectedHarm: unprotected.harm, verdict: v }, ...a]);
      setStatus(announce(v));
    } catch (e) {
      setError((e as Error).message);
      say({ role: "assistant", text: "Sorry, something went wrong. Nothing was sent." });
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
  const verdict = last?.verdict ?? null;

  return (
    <section className="console" aria-labelledby="console-title">
      <div className="console-head">
        <h2 id="console-title">Try it: talk to the bank&apos;s AI assistant</h2>
        <p className={`pill ${live ? "pill-ok" : "pill-warn"}`}>
          {health ? (live ? `Gemini live · ${health.model}` : "Gemini unavailable · degraded mode (transfers need OTP)") : "Checking AI status…"}
        </p>
      </div>

      <div className="card scenarios">
        <h3>One-click scenarios</h3>
        <div className="scenario-groups">
          {PRESET_GROUPS.map((g) => (
            <div key={g.kind}>
              <p className="caption" id={`presets-${g.kind}`}>{g.title}</p>
              <ul className="presets" aria-labelledby={`presets-${g.kind}`}>
                {PRESETS.filter((p) => p.kind === g.kind).map((p) => (
                  <li key={p.label}>
                    <button type="button" className={`preset preset-${g.tone}`} disabled={busy} onClick={() => runPreset(p)}>
                      <span aria-hidden="true">{g.icon}</span> {p.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="hint">Each scenario runs with the AI selected below. Try the attacks again with the compromised AI.</p>
      </div>

      <div className="grid">
        <div className="col phone" role="region" aria-label="Customer's banking app">
          <div className="app-bar" aria-hidden="true">
            <span className="brand-mark">◆</span> Bankism Bank <span className="app-bar-sub">Assistant</span>
          </div>

          <div className="acct-card">
            <p className="acct-holder">Arjun Rao · {START.id}</p>
            <p className="acct-balance">
              <span className="acct-label">Available balance</span>
              <span className="bal">{inr(balance)}</span>
            </p>
            <p className="acct-limits">
              OTP above {inr(LIMITS.stepUpAbove)} · limit {inr(LIMITS.perTransfer)}
            </p>
          </div>

          <p className="caption">Saved payees</p>
          <ul className="payees">
            {BENEFICIARIES.map((b) => (
              <li key={b.id}>
                <span className="avatar" aria-hidden="true">{initials(b.name)}</span>
                <span className="payee-name">{b.name.split(" ")[0]}</span>
              </li>
            ))}
          </ul>

          <ol className="chat" ref={chatBox} tabIndex={0} aria-label="Conversation with the assistant">
            {chat.map((c) => (
              <li key={c.id} className={`bubble bubble-${c.role}`}>
                <span className="sr-only">{c.role === "customer" ? "You: " : "Assistant: "}</span>
                {c.text}
                {c.memo && <span className="bubble-memo">Memo: {c.memo}</span>}
                {c.decision && (
                  <span className={`bubble-tag tag-${c.decision}`}>
                    <span aria-hidden="true">{DECISION_ICON[c.decision]} </span>
                    {c.decision}
                  </span>
                )}
              </li>
            ))}
            {busy && <li className="bubble bubble-assistant typing" aria-hidden="true">Checking…</li>}
          </ol>

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void run(text, memo, mode);
            }}
          >
            <label htmlFor="text">Message to the banking assistant</label>
            <textarea id="text" rows={2} value={text} maxLength={1000} required onChange={(e) => setText(e.target.value)} />
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
              {busy ? "Analyzing…" : "Send to assistant"}
            </button>
          </form>

          <details className="txns">
            <summary>Recent transactions</summary>
            <ul>
              {history.slice(0, 6).map((t, i) => (
                <li key={`${t.date}-${i}`}>
                  <span>
                    {t.description}
                    <span className="hint"> · {t.date}</span>
                  </span>
                  <span className={t.amount < 0 ? "debit" : "credit"}>
                    {t.amount < 0 ? "−" : "+"}
                    {inr(Math.abs(t.amount))}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </div>

        <section className="col result" aria-labelledby="result-title" aria-busy={busy}>
          <h2 id="result-title" tabIndex={-1} ref={resultHeading}>
            What the firewall decided
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
              Pick a scenario or type a request. You&apos;ll see what an unprotected assistant would do, Bankism&apos;s verdict,
              the path through each layer, and the raw JSON.
            </p>
          )}
          {last && (
            <>
              <Compare v={last.verdict} unprotected={last.unprotected} balance={last.balance} />
              <Stepper key={last.verdict.request_id} v={last.verdict} />
              <VerdictView v={last.verdict} submitted={submitted} />
            </>
          )}
        </section>
      </div>

      <AuditLog entries={audit} onClear={() => setAudit([])} />
    </section>
  );
}
