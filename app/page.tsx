"use client";

import { useEffect, useState } from "react";
import type { Verdict } from "@/lib/types";
import { PRESETS } from "./presets";

interface Health {
  llm: string;
  model: string;
  limits: { step_up_above: number; per_transfer: number };
  beneficiaries: string[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const t = terms.filter(Boolean).map((x) => x.split(" ")[0]);
  if (!t.length) return <>{text}</>;
  const alt = t.map(esc).join("|");
  const split = new RegExp(`(${alt})`, "gi");
  const whole = new RegExp(`^(?:${alt})$`, "i");
  return <>{text.split(split).map((part, i) => (whole.test(part) ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>))}</>;
}

const show = (s: string) =>
  s.replace(/[​-‏­⁠﻿]/g, (c) => `⟨U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}⟩`);

export default function Home() {
  const [text, setText] = useState("Send ₹500 to Rahul for dinner");
  const [memo, setMemo] = useState("");
  const [mode, setMode] = useState<"live" | "compromised">("live");
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState<Verdict | null>(null);
  const [submitted, setSubmitted] = useState<{ text: string; memo: string } | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/analyze").then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
  }, []);

  async function run(t = text, m = memo, md = mode) {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: t, memo: m || undefined, mode: md }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setV(j);
      setSubmitted({ text: t, memo: m });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const live = health?.llm === "configured";

  return (
    <main className="wrap">
      <header className="top">
        <div className="brand">
          <h1>🛡️ Bankism</h1>
          <p>
            Blue-team AI firewall for LLM banking. <b>The LLM parses. Code decides.</b>
          </p>
        </div>
        <nav className="nav">
          <span className={`pill ${live ? "ok" : "bad"}`}>
            {health ? (live ? `LLM live · ${health.model}` : "LLM key missing · degraded mode") : "checking…"}
          </span>
          <a className="pill" href="/eval">Eval results</a>
          <a className="pill" href="https://github.com/tramplingh/bankism" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </header>

      <div className="grid">
        <section>
          <div className="card">
            <h2>Customer session (mock)</h2>
            <div className="acct">
              <div>
                <div style={{ color: "var(--muted)", fontSize: 13 }}>Arjun Rao · ACC-XXXX4821</div>
                <div className="bal">₹48,250</div>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "right" }}>
                OTP above ₹{(health?.limits.step_up_above ?? 10000).toLocaleString("en-IN")}
                <br />
                Hard limit ₹{(health?.limits.per_transfer ?? 25000).toLocaleString("en-IN")}
              </div>
            </div>
            <div className="chips">
              {(health?.beneficiaries ?? ["Rahul Sharma", "Priya Nair", "Amit Verma", "Mom (Lakshmi Rao)", "Sneha Iyer"]).map((b) => (
                <span key={b} className="chip">✓ {b}</span>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>Request</h2>
            <label htmlFor="text">Message to the banking assistant</label>
            <textarea id="text" rows={3} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
            <label htmlFor="memo">Payment memo (optional, untrusted)</label>
            <input id="memo" type="text" value={memo} maxLength={200} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. dinner" />
            <div className="mode" role="group" aria-label="LLM mode">
              <button className={mode === "live" ? "on" : ""} onClick={() => setMode("live")}>Live LLM</button>
              <button className={mode === "compromised" ? "on evil" : ""} onClick={() => setMode("compromised")}>☠ Compromised LLM</button>
            </div>
            <div className="hint">
              {mode === "compromised"
                ? "The LLM is replaced by a hostile stub that always tries to wire money to the attacker and never flags anything. Watch the policy engine stop it."
                : "Gemini parses the request into JSON. It has no tools and cannot approve anything."}
            </div>
            <button className="go" disabled={busy || !text.trim()} onClick={() => run()}>
              {busy ? "Analyzing…" : "Analyze request"}
            </button>
          </div>

          <div className="card">
            <h2>One-click scenarios</h2>
            <div className="presets">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  className={p.kind}
                  onClick={() => {
                    setText(p.text);
                    setMemo(p.memo ?? "");
                    run(p.text, p.memo ?? "");
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="hint">Green = legitimate customer · Red = attack. Try each in both LLM modes.</div>
          </div>
        </section>

        <section>
          {err && <div className="card BLOCKED">Request failed: {err}</div>}
          {!v && !err && (
            <div className="card empty">Pick a scenario or type a request. The verdict, every layer&apos;s decision and the raw JSON appear here.</div>
          )}
          {v && (
            <>
              <div className="card">
                <h2>Verdict</h2>
                <div className="verdict">
                  <span className={`badge ${v.decision}`}>{v.decision}</span>
                  <div className="meta">
                    <span className="kv"><span>risk </span>{v.risk_level}</span>
                    <span className="kv"><span>threat </span>{v.threat_category}</span>
                    <span className="kv"><span>parser </span>{v.parser}{v.degraded ? " (degraded)" : ""}</span>
                    <span className="kv"><span>latency </span>{Math.round(v.latency_ms)} ms</span>
                  </div>
                </div>
                <p className="rationale">{v.rationale}</p>
                <div className="exec">
                  {v.execution.executed ? (
                    <>✅ <b>Executed</b> · {v.execution.reference}{" "}
                      {v.execution.result && "new_balance" in (v.execution.result as object)
                        ? `· mock balance now ₹${(v.execution.result as { new_balance: number }).new_balance.toLocaleString("en-IN")}`
                        : ""}</>
                  ) : (
                    <>⛔ <b>Nothing executed.</b> {v.decision === "REVIEW" ? "Customer would be asked for OTP / clarification." : ""}</>
                  )}
                </div>
              </div>

              <div className="card">
                <h2>Defense-in-depth trace</h2>
                <ul className="trace">
                  {v.trace.map((s, i) => (
                    <li key={i}>
                      <span className={`dot ${s.status}`} title={s.status} />
                      <span className="layer">{s.layer}</span>
                      <span className="detail">{s.detail}</span>
                      <span className="ms">{s.ms}ms</span>
                    </li>
                  ))}
                </ul>
              </div>

              {v.signals.length > 0 && (
                <div className="card">
                  <h2>Signals ({v.signals.length})</h2>
                  {v.signals.map((s, i) => (
                    <div className="sig" key={i}>
                      <span className={`sev ${s.severity}`}>{s.severity}</span>
                      <b>{s.id}</b> · {s.category} — {s.evidence}
                    </div>
                  ))}
                </div>
              )}

              <div className="card">
                <h2>What the firewall actually read</h2>
                {submitted && v.normalization.changed && (
                  <>
                    <label>Raw input (invisible characters shown)</label>
                    <div className="diff">{show(submitted.text)}{submitted.memo ? `  [memo: ${show(submitted.memo)}]` : ""}</div>
                  </>
                )}
                <label>Normalized{v.grounding ? " — highlighted spans ground the amount and payee" : ""}</label>
                <div className="diff">
                  <Highlight text={v.normalization.normalized} terms={[v.grounding?.amount ?? "", v.grounding?.payee ?? ""]} />
                </div>
                {v.normalization.notes.length > 0 && <div className="hint">{v.normalization.notes.join(" · ")}</div>}
              </div>

              <div className="card">
                <details>
                  <summary>Machine-readable verdict JSON</summary>
                  <pre className="json">{JSON.stringify(v, null, 2)}</pre>
                </details>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
