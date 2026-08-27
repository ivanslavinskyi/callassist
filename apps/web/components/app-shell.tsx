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
import { Brand } from "./brand";
import { useUiLocale } from "./ui-locale-provider";

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
        <Brand href={localizeHref("/")} label={messages.app.homeLabel} />
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
            <Link className="topbar-link" href="/admin">{messages.app.adminPortal}</Link>
          ) : null}
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
