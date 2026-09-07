"use client";

import { useEffect, useState } from "react";
import { UiIcon } from "./ui-icon";

const storageKey = "callassist_theme";
function storedTheme() {
  try { return localStorage.getItem(storageKey); } catch { return null; }
}

export function ThemeToggle({ lightLabel, darkLabel }: { lightLabel: string; darkLabel: string }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    const system = () => {
      const saved = storedTheme();
      document.documentElement.dataset.theme = saved === "light" || saved === "dark"
        ? saved : media.matches ? "dark" : "light";
      sync();
    };
    system();
    media.addEventListener("change", system);
    window.addEventListener("storage", system);
    window.addEventListener("callassist:theme-changed", sync);
    return () => {
      media.removeEventListener("change", system);
      window.removeEventListener("storage", system);
      window.removeEventListener("callassist:theme-changed", sync);
    };
  }, []);
  function toggle() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(storageKey, next); } catch { /* The current tab still changes theme. */ }
    setTheme(next);
    window.dispatchEvent(new Event("callassist:theme-changed"));
  }
  const label = theme === "dark" ? lightLabel : darkLabel;
  return <button className="theme-toggle icon-button" type="button" onClick={toggle} aria-label={label} title={label}>
    <UiIcon name="moon" className="theme-moon" /><UiIcon name="sun" className="theme-sun" />
  </button>;
}
