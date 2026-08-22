"use client";

import type { PublishedNavigation, UserRole } from "@callassist/contracts";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  getCreditUsage,
  getCurrentUser,
  getPublishedNavigation
} from "@/lib/api";
import {
  contentPath,
  switchContentLocale
} from "@/lib/i18n/content-routing";
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
  const { locale, localizeHref, messages } = useUiLocale();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [publicNavigation, setPublicNavigation] = useState<
    PublishedNavigation | null
  >(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  useEffect(() => {
    let active = true;
    void getPublishedNavigation(locale)
      .then(({ navigation }) => {
        if (active) setPublicNavigation(navigation);
      })
      .catch(() => {
        if (active) setPublicNavigation(null);
      });
    return () => { active = false; };
  }, [locale]);

  useEffect(() => {
    let active = true;
    void getCurrentUser()
      .then(({ user }) => {
        if (active) {
          setIsAuthenticated(true);
          setRole(user.role);
        }
      })
      .catch(() => {
        if (active) {
          setIsAuthenticated(false);
          setRole(null);
        }
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (isAuthenticated !== true || role === "content_editor") {
      setCreditBalance(null);
      return;
    }
    let active = true;
    const refresh = async () => {
      try {
        const usage = await getCreditUsage();
        if (active) setCreditBalance(usage.balance);
      } catch {
        if (active) setCreditBalance(null);
      }
    };
    const onUsageChanged = () => void refresh();
    void refresh();
    window.addEventListener("callassist:usage-changed", onUsageChanged);
    window.addEventListener("focus", onUsageChanged);
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("callassist:usage-changed", onUsageChanged);
      window.removeEventListener("focus", onUsageChanged);
    };
  }, [isAuthenticated, role]);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("callassist_theme", nextTheme);
    setTheme(nextTheme);
  }

  function changeLocale(nextLocale: "en" | "de") {
    document.cookie = `callassist_ui_locale=${nextLocale};path=/;max-age=31536000;samesite=lax`;
    router.push(
      switchContentLocale(pathname, nextLocale) ??
      pathname.replace(`/${locale}`, `/${nextLocale}`)
    );
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {messages.app.skipToContent}
      </a>
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          {isAuthenticated === false ? publicNavigation?.items
            .filter(({ location }) => location === "header")
            .map((item) => (
              <Link className="topbar-link" href={item.href} key={item.id}>
                {item.label}
              </Link>
            )) : null}
          {isAuthenticated === true && role !== "content_editor" ? <>
            <Link className="topbar-link" href={localizeHref("/app#new-call")}>{messages.app.newCall}</Link>
            <Link className="topbar-link" href={localizeHref("/app#history")}>{messages.app.history}</Link>
            <Link className="topbar-link" href={localizeHref("/app/account")}>{messages.app.account}</Link>
          </> : null}
          {isAuthenticated === false ? <>
            <Link className="topbar-link" href={localizeHref("/login")}>{messages.app.signIn}</Link>
            <Link className="topbar-link" href={localizeHref("/register")}>{messages.app.createAccount}</Link>
          </> : null}
          <Link className="topbar-link" href={localizeHref("/opt-out")}>
            {messages.app.optOut}
          </Link>
          {isAuthenticated && role !== "content_editor" ? <Link className="topbar-link" href={localizeHref("/redeem")}>{messages.app.redeem}</Link> : null}
          {role && ["content_editor", "admin", "superadmin"].includes(role) ? (
            <>
              <Link className="topbar-link" href={localizeHref("/admin/content")}>{messages.app.contentAdmin}</Link>
              <Link className="topbar-link" href={localizeHref("/admin/seo")}>{messages.app.seoAdmin}</Link>
            </>
          ) : null}
          {role && ["admin", "superadmin"].includes(role) ? <>
            <Link className="topbar-link" href={localizeHref("/admin/calls")}>{messages.app.callsAdmin}</Link>
            <Link className="topbar-link" href={localizeHref("/admin/users")}>{messages.app.usersAdmin}</Link>
            <Link className="topbar-link" href={localizeHref("/admin/safety")}>{messages.app.safety}</Link>
            <Link className="topbar-link" href={localizeHref("/admin/credits")}>{messages.app.creditAdmin}</Link>
          </> : null}
          {creditBalance !== null ? (
            <Link
              aria-label={messages.app.creditsRemaining(creditBalance)}
              className="credit-balance"
              data-balance={creditBalance}
              href={localizeHref("/app/account#usage")}
            >
              <span aria-hidden="true">●</span>
              {messages.app.creditsRemaining(creditBalance)}
            </Link>
          ) : null}
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
      <footer className="site-footer">
        <nav aria-label={messages.app.support}>
          {publicNavigation ? publicNavigation.items
            .filter(({ location }) => location === "footer")
            .map((item) => (
              <Link href={item.href} key={item.id}>{item.label}</Link>
            )) : <>
              <Link href={contentPath(locale, "privacy")}>{messages.app.privacy}</Link>
              <Link href={contentPath(locale, "terms")}>{messages.app.terms}</Link>
              <Link href={contentPath(locale, "acceptable_use")}>{messages.app.acceptableUse}</Link>
              <Link href={contentPath(locale, "faq")}>{messages.app.faq}</Link>
              <Link href={contentPath(locale, "support")}>{messages.app.support}</Link>
              <Link href={localizeHref("/opt-out")}>{messages.app.optOut}</Link>
            </>}
        </nav>
        <small>CallAssist · Public beta</small>
      </footer>
    </div>
  );
}
