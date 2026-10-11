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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function mount(ui: React.ReactNode) {
  const host = document.createElement("main");
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
