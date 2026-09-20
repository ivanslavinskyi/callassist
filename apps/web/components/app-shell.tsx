"use client";

import type { PublishedNavigation } from "@callassist/contracts";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  getCreditUsage,
  getPublishedNavigation,
  updateLanguagePreferences
} from "@/lib/api";
import {
  contentPath,
  switchContentLocale
} from "@/lib/i18n/content-routing";
import { emailVerificationMessages } from "@/lib/i18n/email-verification-messages";
import { LanguageSwitcher } from "./language-switcher";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";
import { NavigationMenu } from "./navigation-menu";
import { SiteFooter } from "./site-footer";
import { designMessages } from "@/lib/i18n/design-messages";
import { useUiLocale } from "./ui-locale-provider";
import { type UiLocale } from "@/lib/i18n/messages";
import { languageMessages } from "@/lib/i18n/language-messages";
import { rememberUiLocale } from "@/lib/ui-language-preference";
import type { SessionSnapshot } from "@/lib/session-state";
import { SessionProvider, useSession } from "./session-provider";

export function AppShell({ children, initialSession }: { children: ReactNode; initialSession?: SessionSnapshot }) {
  return <SessionProvider initialSession={initialSession}><AppShellContent>{children}</AppShellContent></SessionProvider>;
}

function AppShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { locale, localizeHref, messages } = useUiLocale();
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const { session } = useSession();
  const isAuthenticated = session.status === "authenticated" ? true : session.status === "anonymous" ? false : null;
  const role = session.status === "authenticated" ? session.user.role : null;
  const emailVerified = session.status === "authenticated" ? session.user.emailVerified : null;
  const userId = session.status === "authenticated" ? session.user.id : null;
  const [changingLocale, setChangingLocale] = useState(false);
  const [localeError, setLocaleError] = useState(false);
  const [publicNavigation, setPublicNavigation] = useState<
    PublishedNavigation | null
  >(null);


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
    if (isAuthenticated !== true || role === "content_editor") {
      setCreditBalance(null);
      return;
    }
    setCreditBalance(null);
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
  }, [isAuthenticated, role, userId]);

  async function changeLocale(nextLocale: UiLocale) {
    setChangingLocale(true);
    setLocaleError(false);
    try {
      if (isAuthenticated) await updateLanguagePreferences({ uiLocale: nextLocale });
      rememberUiLocale(nextLocale, isAuthenticated === false);
      const nextPath = switchContentLocale(pathname, nextLocale) ?? pathname.replace(`/${locale}`, `/${nextLocale}`);
      router.push(`${nextPath}${window.location.search}${window.location.hash}`);
    } catch {
      setLocaleError(true);
    } finally {
      setChangingLocale(false);
    }
  }
  const copy = designMessages[locale];
  const customer = isAuthenticated === true && role !== "content_editor";
  const publicLinks = publicNavigation?.items.filter(({location}) => location === "header") ?? [
    {id: "how-it-works", href: `/${locale}#how-it-works`, label: messages.app.howItWorks},
    {id: "faq", href: contentPath(locale, "faq"), label: messages.app.faq},
    {id: "support", href: contentPath(locale, "support"), label: messages.app.support}
  ];
  const language = <LanguageSwitcher locale={locale} label={messages.app.interfaceLanguage} disabled={changingLocale || isAuthenticated === null} onChange={next => void changeLocale(next)} />;
  const primary = customer ? <>
    <Link className="topbar-link" aria-current={pathname.endsWith("/app") ? "page" : undefined} href={localizeHref("/app")}>{messages.app.newCall}</Link>
    <Link className="topbar-link" aria-current={(pathname.includes("/app/calls/") || pathname.endsWith("/app/history")) ? "page" : undefined} href={localizeHref("/app/history")}>{messages.app.history}</Link>
    <Link className="topbar-link" aria-current={pathname.endsWith("/account") ? "page" : undefined} href={localizeHref("/app/account")}>{messages.app.account}</Link>
  </> : publicLinks.map(item => <Link className="topbar-link" href={item.href} key={item.id}>{item.label}</Link>);
  const more = <>
    {customer ? <Link href={localizeHref("/redeem")}>{messages.app.redeem}</Link> : null}
    <Link href={localizeHref("/opt-out")}>{messages.app.optOut}</Link>
    {customer ? <><Link href={contentPath(locale, "faq")}>{messages.app.faq}</Link><Link href={contentPath(locale, "support")}>{messages.app.support}</Link></> : null}
    {role && ["content_editor", "admin", "superadmin"].includes(role) ? <Link href="/admin">{messages.app.adminPortal}</Link> : null}
  </>;
  const authLinks = isAuthenticated === false ? <>
    <Link className="topbar-link" href={localizeHref("/login")} prefetch={false}>{messages.app.signIn}</Link>
    <Link className="primary-button compact-button" href={localizeHref("/register")} prefetch={false}>{messages.app.createAccount}</Link>
  </> : null;
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">{messages.app.skipToContent}</a>
    <header className="topbar">
      <Brand locale={locale} href={localizeHref("/")} label={messages.app.homeLabel} />
      <nav className="topbar-navigation" aria-label={copy.navigation}>{primary}
        {isAuthenticated === true ? <NavigationMenu id="app-more-navigation" label={copy.more} openLabel={copy.openMenu} closeLabel={copy.closeMenu}>{more}</NavigationMenu> : null}
      </nav>
      <div className="topbar-actions">
        <div className="desktop-tools">{authLinks}
          {creditBalance !== null ? <Link className="credit-balance" href={localizeHref("/app/account#usage")}>{messages.app.creditsRemaining(creditBalance)}</Link> : null}
        </div>
        {language}
        <ThemeToggle lightLabel={messages.app.switchToLightTheme} darkLabel={messages.app.switchToDarkTheme} />
        <NavigationMenu id="app-mobile-navigation" mobile label={copy.navigation} openLabel={copy.openMenu} closeLabel={copy.closeMenu}>
          {primary}{more}{authLinks}
        </NavigationMenu>
      </div>
    </header>
    {localeError ? <p className="form-error" role="alert">{languageMessages[locale].saveError}</p> : null}
    {emailVerified === false && pathname.includes("/app") && !pathname.includes("/app/account") ? <aside className="email-verification-banner">
      <span>{emailVerificationMessages[locale].banner}</span>{" "}
      <Link href={localizeHref("/verify-email")}>{emailVerificationMessages[locale].title}</Link>
    </aside> : null}
    {children}
    <SiteFooter locale={locale} navigation={publicNavigation} />
  </div>;
}
