"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { logout } from "@/lib/api";
import { adminNavigationForRole, isAdminNavigationItemActive } from "@/lib/admin-navigation";
import { useAdminSession } from "./admin-session-provider";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";
import { NavigationMenu } from "./navigation-menu";
import { SiteFooter } from "./site-footer";

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAdminSession();
  const groups = adminNavigationForRole(user.role);
  const activeHref = groups.flatMap(({ items }) => items)
    .filter(item => isAdminNavigationItemActive(pathname, item.href))
    .sort((left, right) => right.href.length - left.href.length)[0]?.href;
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  async function signOut() {
    setLoggingOut(true); setLogoutError(false);
    try {
      await logout();
      router.replace(`/${user.uiLocale}/login`); router.refresh();
    } catch { setLogoutError(true); }
    finally { setLoggingOut(false); }
  }
  const destination = <Link className="secondary-button" href={`/${user.uiLocale}${user.role === "content_editor" ? "" : "/app"}`}>
    {user.role === "content_editor" ? "Public site" : "Customer app"}
  </Link>;
  const signOutButton = <button className="secondary-button" disabled={loggingOut} onClick={() => void signOut()} type="button">
    {loggingOut ? "Signing out…" : "Sign out"}
  </button>;
  return <div className="admin-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="admin-utility-header">
      <div className="admin-utility-brand"><Brand href="/admin" label="SHPROHLI admin home" /><span className="admin-product-label">Admin</span></div>
      <div className="admin-utility-actions">
        <div className="desktop-tools">
          <div className="admin-identity"><strong>{user.firstName} {user.lastName}</strong><span>{roleLabel(user.role)}</span></div>
          {destination}{signOutButton}
        </div>
        <ThemeToggle lightLabel="Switch to light theme" darkLabel="Switch to dark theme" />
        <NavigationMenu id="admin-mobile-navigation" mobile label="Admin navigation" openLabel="Open admin navigation" closeLabel="Close admin navigation">
          {groups.map(group => <div key={group.label}><strong className="admin-mobile-group">{group.label}</strong>
            {group.items.map(item => <Link key={item.href} href={item.href} aria-current={item.href === activeHref ? "page" : undefined}>{item.label}</Link>)}
          </div>)}{destination}{signOutButton}
        </NavigationMenu>
      </div>
    </header>
    {logoutError ? <p className="inline-notice" role="alert">Could not sign out. Please try again.</p> : null}
    <div className="admin-shell-body">
      <aside aria-label="Admin navigation" className="admin-sidebar"><nav>
        {groups.map(group => <section className="admin-navigation-group" key={group.label}><h2>{group.label}</h2><ul>
          {group.items.map(item => <li key={item.href}><Link aria-current={item.href === activeHref ? "page" : undefined} href={item.href}>{item.label}</Link></li>)}
        </ul></section>)}
      </nav></aside>
      <div className="admin-workspace">{children}</div>
    </div>
    <SiteFooter locale="en" />
  </div>;
}

function roleLabel(role: "user" | "admin" | "superadmin" | "content_editor" | "support") {
  switch (role) {
    case "superadmin": return "Superadmin";
    case "content_editor": return "Content editor";
    case "admin": return "Administrator";
    case "support": return "Support";
    default: return "User";
  }
}
