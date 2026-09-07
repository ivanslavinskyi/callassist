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
import { ThemeToggle } from "./theme-toggle";
import { NavigationMenu } from "./navigation-menu";
import { SiteFooter } from "./site-footer";
import { designMessages } from "@/lib/i18n/design-messages";
import { useUiLocale } from "./ui-locale-provider";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { locale, localizeHref, messages } = useUiLocale();
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
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

  function changeLocale(nextLocale: "en" | "de") {
    document.cookie = `callassist_ui_locale=${nextLocale};path=/;max-age=31536000;samesite=lax`;
    router.push(switchContentLocale(pathname, nextLocale) ?? pathname.replace(`/${locale}`, `/${nextLocale}`));
  }
  const copy = designMessages[locale];
  const customer = isAuthenticated === true && role !== "content_editor";
  const publicLinks = publicNavigation?.items.filter(({location}) => location === "header") ?? [
    {id: "how-it-works", href: `/${locale}#how-it-works`, label: messages.app.howItWorks},
    {id: "faq", href: contentPath(locale, "faq"), label: messages.app.faq},
    {id: "support", href: contentPath(locale, "support"), label: messages.app.support}
  ];
  const language = <label className="locale-picker"><span className="sr-only">{messages.app.interfaceLanguage}</span>
    <select aria-label={messages.app.interfaceLanguage} value={locale} onChange={event => changeLocale(event.target.value as "en" | "de")}>
      <option value="en">EN</option><option value="de">DE</option>
    </select></label>;
  const primary = customer ? <>
    <Link className="topbar-link" aria-current={pathname.endsWith("/app") ? "page" : undefined} href={localizeHref("/app#new-call")}>{messages.app.newCall}</Link>
    <Link className="topbar-link" aria-current={pathname.includes("/app/calls/") ? "page" : undefined} href={localizeHref("/app#history")}>{messages.app.history}</Link>
    <Link className="topbar-link" aria-current={pathname.endsWith("/account") ? "page" : undefined} href={localizeHref("/app/account")}>{messages.app.account}</Link>
  </> : publicLinks.map(item => <Link className="topbar-link" href={item.href} key={item.id}>{item.label}</Link>);
  const more = <>
    {customer ? <Link href={localizeHref("/redeem")}>{messages.app.redeem}</Link> : null}
    <Link href={localizeHref("/opt-out")}>{messages.app.optOut}</Link>
    {customer ? <><Link href={contentPath(locale, "faq")}>{messages.app.faq}</Link><Link href={contentPath(locale, "support")}>{messages.app.support}</Link></> : null}
    {role && ["content_editor", "admin", "superadmin"].includes(role) ? <Link href="/admin">{messages.app.adminPortal}</Link> : null}
  </>;
  const authLinks = isAuthenticated !== true ? <>
    <Link className="topbar-link" href={localizeHref("/login")}>{messages.app.signIn}</Link>
    <Link className="primary-button compact-button" href={localizeHref("/register")}>{messages.app.createAccount}</Link>
  </> : null;
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">{messages.app.skipToContent}</a>
    <header className="topbar">
      <Brand href={localizeHref("/")} label={messages.app.homeLabel} />
      <nav className="topbar-navigation" aria-label={copy.navigation}>{primary}
        {isAuthenticated === true ? <NavigationMenu id="app-more-navigation" label={copy.more} openLabel={copy.openMenu} closeLabel={copy.closeMenu}>{more}</NavigationMenu> : null}
      </nav>
      <div className="topbar-actions">
        <div className="desktop-tools">{authLinks}
          {creditBalance !== null ? <Link className="credit-balance" href={localizeHref("/app/account#usage")}>{messages.app.creditsRemaining(creditBalance)}</Link> : null}
        </div>
        <ThemeToggle lightLabel={messages.app.switchToLightTheme} darkLabel={messages.app.switchToDarkTheme} />
        <div className="desktop-tools">{language}</div>
        <NavigationMenu id="app-mobile-navigation" mobile label={copy.navigation} openLabel={copy.openMenu} closeLabel={copy.closeMenu}>
          {primary}{more}{authLinks}<div className="menu-language">{language}</div>
        </NavigationMenu>
      </div>
    </header>
    {children}
    <SiteFooter locale={locale} navigation={publicNavigation} />
  </div>;
}
