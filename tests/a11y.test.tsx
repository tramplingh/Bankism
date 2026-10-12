// @vitest-environment jsdom
/**
 * Accessibility checks on the real UI components: axe-core (WCAG 2.1 A/AA) on the rendered
 * markup, plus the behaviours axe cannot see: the verdict is announced in a live region,
 * focus moves to the result, and the AI mode is a labelled radio group.
 * (Colour contrast is checked in a real browser; jsdom cannot compute it.)
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import axe from "axe-core";
import Console from "@/app/components/Console";
import ContainmentHero from "@/app/components/ContainmentHero";
import { headlineStats } from "@/lib/evalStats";
import EvalPage from "@/app/eval/page";
import ThemeToggle, { THEME_KEY } from "@/app/components/ThemeToggle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function mount(ui: React.ReactNode, tag = "main") {
  const host = document.createElement(tag);
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(ui));
  return host;
}

async function axeViolations() {
  const r = await axe.run(document.body, {
    runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
    rules: { "color-contrast": { enabled: false } },
  });
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

const verdict = {
  request_id: "r1", decision: "BLOCKED", risk_level: "CRITICAL", threat_category: "MEMO_INJECTION",
  rationale: "Blocked: memo talks to the AI.", parsed_action: null, execution: { executed: false },
  signals: [{ layer: "L2_RULES", id: "MEMO-ADDRESSES-MODEL", category: "MEMO_INJECTION", severity: "HIGH", evidence: "memo talks to the AI" }],
  trace: [{ layer: "L2_RULES", status: "block", detail: "1 rule(s) hit", ms: 0.1 }],
  normalization: { normalized: "Send 500 to Rahul", changed: false, notes: [] }, grounding: null,
  mode: "live", parser: "llm", degraded: false, policy_version: "x", latency_ms: 3,
};

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) =>
    new Response(JSON.stringify(init?.method === "POST" ? verdict : { llm: "configured", model: "gemini-test" }), { status: 200 }),
  ));
}

describe("accessibility", () => {
  it("containment hero has no axe violations", async () => {
    await mount(<ContainmentHero stats={headlineStats()} />);
    expect(await axeViolations()).toEqual([]);
  });

  it("hero links to the evaluation with a clear, named button", async () => {
    const host = await mount(<ContainmentHero stats={headlineStats()} />);
    const cta = host.querySelector<HTMLAnchorElement>(".eval-cta a");
    expect(cta?.getAttribute("href")).toBe("/eval");
    expect(cta?.textContent).toContain("See the evaluation");
    expect(host.querySelector(".eval-cta")?.textContent).toContain("no unauthorised transfer");
  });

  it("eval page charts have no axe violations and print every value as text", async () => {
    const host = await mount(<EvalPage />, "div");
    expect(await axeViolations()).toEqual([]);
    expect(host.querySelector(".eval-lede")?.textContent).toMatch(/56 of 114 .* 0 in every configuration/);
    // Every bar has a printed value, so no reading depends on colour or hover.
    const bars = host.querySelectorAll(".bar-track");
    expect(bars.length).toBeGreaterThan(0);
    bars.forEach((b) => expect(b.querySelector(".bar-value")?.textContent).toBeTruthy());
    // Headings must not contradict the bars: Gemini alone is 98.7% contained, so don't claim containment never drops.
    const headings = [...host.querySelectorAll(".chart-card h2")].map((h) => h.textContent ?? "");
    expect(headings.join(" | ")).not.toMatch(/Containment doesn.t/i);
    expect(headings.join(" | ")).toMatch(/No money moves wrongly/);
    // The legitimate-customer chart states its real base: 35 that should go through, 1 correctly blocked.
    expect(host.querySelector("#legit-base")?.textContent).toMatch(/35 legitimate requests.*36th.*correctly blocked/);
  });

  it("console has no axe violations before and after a verdict", async () => {
    stubFetch();
    const host = await mount(<Console />);
    expect(await axeViolations()).toEqual([]);
    const preset = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Memo injection"))!;
    await act(async () => preset.click());
    await act(async () => new Promise<void>((r) => requestAnimationFrame(() => r())));
    expect(host.querySelector(".badge")?.textContent).toContain("BLOCKED");
    expect(await axeViolations()).toEqual([]);
  });

  it("announces the verdict in a polite live region and moves focus to it", async () => {
    stubFetch();
    const host = await mount(<Console />);
    const preset = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Memo injection"))!;
    await act(async () => preset.click());
    await act(async () => new Promise<void>((r) => requestAnimationFrame(() => r())));
    const live = host.querySelector('[role="status"][aria-live="polite"]');
    expect(live?.textContent).toMatch(/Verdict BLOCKED.*Instructions hidden in memo.*Nothing executed/);
    expect(document.activeElement?.id).toBe("result-title");
  });

  it("one scenario fills the chat, the side-by-side, the five-step path and the audit log", async () => {
    stubFetch();
    const host = await mount(<Console />);
    const preset = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Memo injection"))!;
    await act(async () => preset.click());
    const bubbles = host.querySelectorAll(".chat .bubble");
    expect(bubbles[bubbles.length - 1].textContent).toMatch(/can't do that.*Instructions hidden in memo/);
    expect(host.querySelector(".compare .pane-bad")?.textContent).toMatch(/account 9999888877.*not a saved payee/);
    expect(host.querySelector(".compare .verdict")?.textContent).toMatch(/BLOCKED.*Nothing executed.*attack was stopped/);
    expect(host.querySelectorAll(".stepper .node")).toHaveLength(5);
    expect(host.querySelectorAll(".audit tbody tr")).toHaveLength(1);
    expect(host.querySelector(".audit-totals .ok")?.textContent).toMatch(/0\s*Unauthorised transfers|Unauthorised transfers\s*0/);
  });

  it("makes the compromised-AI mode and degraded parsing impossible to miss in the chat", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === "POST" ? { ...verdict, degraded: true } : { llm: "configured", model: "gemini-test" }), { status: 200 }),
    ));
    const host = await mount(<Console />);
    const evil = host.querySelector<HTMLInputElement>('input[value="compromised"]')!;
    await act(async () => evil.click());
    expect(host.querySelector(".app-bar")?.textContent).toMatch(/Compromised AI/);
    const preset = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("₹500 → Rahul"))!;
    await act(async () => preset.click());
    expect(host.querySelector(".bubble-customer")?.textContent).toMatch(/AI: Compromised/);
    const replies = host.querySelectorAll(".bubble-assistant");
    expect(replies[replies.length - 1].textContent).toMatch(/Gemini unavailable/);
  });

  it("groups scenarios in keyboard-operable tabs, one group visible at a time", async () => {
    stubFetch();
    const host = await mount(<Console />);
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(host.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
    await act(async () => tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe("tab-atk");
    expect(host.querySelector<HTMLElement>("#panel-atk")?.hidden).toBe(false);
    expect(await axeViolations()).toEqual([]);
  });

  it("theme toggle switches light/dark, says what it will do, and remembers the choice", async () => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
    const host = await mount(<ThemeToggle />, "div");
    const btn = host.querySelector("button")!;
    expect(btn.getAttribute("aria-label")).toBe("Switch to dark theme");
    await act(async () => btn.click());
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(btn.getAttribute("aria-label")).toBe("Switch to light theme");
    await act(async () => btn.click());
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(await axeViolations()).toEqual([]);
    document.documentElement.removeAttribute("data-theme");
  });

  it("exposes the AI mode as a labelled radio group and statuses as words, not colour", async () => {
    stubFetch();
    const host = await mount(<Console />);
    const radios = host.querySelectorAll('fieldset input[type="radio"]');
    expect(radios).toHaveLength(2);
    expect(host.querySelector("fieldset legend")?.textContent).toMatch(/Who parses/);
    const preset = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Memo injection"))!;
    await act(async () => preset.click());
    expect(host.querySelector(".step-status")?.textContent).toMatch(/Blocked/);
  });
});
