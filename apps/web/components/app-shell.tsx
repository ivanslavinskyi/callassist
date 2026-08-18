"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useUiLocale } from "./ui-locale-provider";

export function Brand() {
  const { localizeHref, messages } = useUiLocale();
  return (
    <Link className="brand" href={localizeHref("/")} aria-label={messages.app.homeLabel}>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none">
          <path d="M7.5 10.2a8.6 8.6 0 0 1 14.4-2.5" />
          <path d="M24.5 21.8a8.6 8.6 0 0 1-14.4 2.5" />
          <path d="m20.2 5.2 2.2 2.6-2.8 1.7" />
          <path d="m11.8 26.8-2.2-2.6 2.8-1.7" />
          <path d="M12.3 12.4c.8 3.7 3.6 6.5 7.3 7.3l1.8-2.1c.3-.4.8-.5 1.2-.3l3 1.2c.5.2.8.7.7 1.2l-.4 3.1c-.1.7-.7 1.2-1.4 1.2C15.4 24 8 16.6 8 7.5c0-.7.5-1.3 1.2-1.4l3.1-.4c.5-.1 1 .2 1.2.7l1.2 3c.2.4.1.9-.3 1.2l-2.1 1.8Z" />
        </svg>
      </span>
      <span>CallAssist</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { locale, messages } = useUiLocale();
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("callassist_theme", nextTheme);
    setTheme(nextTheme);
  }

  function changeLocale(nextLocale: "en" | "de") {
    document.cookie = `callassist_ui_locale=${nextLocale};path=/;max-age=31536000;samesite=lax`;
    router.push(pathname.replace(`/${locale}`, `/${nextLocale}`));
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {messages.app.skipToContent}
      </a>
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          <div className="topbar-meta">
            <span className="secure-dot" aria-hidden="true" />
            {messages.app.consoleLabel}
          </div>
          <button
            aria-label={theme === "dark" ? messages.app.switchToLightTheme : messages.app.switchToDarkTheme}
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === "dark" ? messages.app.switchToLightTheme : messages.app.switchToDarkTheme}
            type="button"
          >
            <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
          </button>
          <label className="locale-picker">
            <span className="sr-only">{messages.app.interfaceLanguage}</span>
            <select
              aria-label={messages.app.interfaceLanguage}
              onChange={(event) => changeLocale(event.target.value as "en" | "de")}
              value={locale}
            >
              <option value="en">EN</option>
              <option value="de">DE</option>
            </select>
          </label>
        </div>
      </header>
      {children}
    </div>
  );
}
