"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";
export const THEME_KEY = "bankism-theme";

/** Runs in <head> before first paint so a saved choice never flashes the other theme. */
export const themeInitScript = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

const current = (): Theme => {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

/** Light/dark switch. Follows the OS until the visitor picks; the choice is remembered on this device. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => setTheme(current()), []);

  function toggle() {
    const next: Theme = (theme ?? current()) === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private mode or blocked storage: the switch still works for this page view.
    }
    setTheme(next);
  }

  const toDark = theme !== "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={toDark ? "Switch to dark theme" : "Switch to light theme"}
      title={toDark ? "Dark theme" : "Light theme"}
    >
      <span aria-hidden="true">{theme === null ? "◐" : toDark ? "☾" : "☀"}</span>
      <span className="theme-toggle-text">{toDark ? "Dark" : "Light"}</span>
    </button>
  );
}
