"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { logout } from "@/lib/api";
import {
  adminNavigationForRole,
  isAdminNavigationItemActive
} from "@/lib/admin-navigation";
import { useAdminSession } from "./admin-session-provider";
import { Brand } from "./brand";

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAdminSession();
  const groups = adminNavigationForRole(user.role);
  const activeHref = groups
    .flatMap(({ items }) => items)
    .filter((item) => isAdminNavigationItemActive(pathname, item.href))
    .sort((left, right) => right.href.length - left.href.length)[0]?.href;
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("callassist_theme", nextTheme);
    setTheme(nextTheme);
  }

  async function signOut() {
    setLoggingOut(true);
    try {
      await logout();
      router.replace(`/${user.uiLocale}/login`);
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="admin-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="admin-utility-header">
        <div className="admin-utility-brand">
          <button
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close admin navigation" : "Open admin navigation"}
            className="admin-menu-toggle"
            onClick={() => setMenuOpen((current) => !current)}
            type="button"
          >
            <span aria-hidden="true">{menuOpen ? "×" : "☰"}</span>
          </button>
          <Brand href="/admin" label="SHPROHLI admin home" />
          <span className="admin-product-label">Admin</span>
        </div>
        <div className="admin-utility-actions">
          <div className="admin-identity">
            <strong>{user.firstName} {user.lastName}</strong>
            <span>{roleLabel(user.role)}</span>
          </div>
          {user.role !== "content_editor" ? (
            <Link className="secondary-button" href={`/${user.uiLocale}/app`}>Customer app</Link>
          ) : (
            <Link className="secondary-button" href={`/${user.uiLocale}`}>Public site</Link>
          )}
          <button
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            type="button"
          >
            <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
          </button>
          <button
            className="secondary-button"
            disabled={loggingOut}
            onClick={() => void signOut()}
            type="button"
          >
            {loggingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </header>

      <div className="admin-shell-body">
        <aside
          aria-label="Admin navigation"
          className="admin-sidebar"
          data-open={menuOpen}
        >
          <nav>
            {groups.map((group) => (
              <section className="admin-navigation-group" key={group.label}>
                <h2>{group.label}</h2>
                <ul>
                  {group.items.map((item) => {
                    const active = item.href === activeHref;
                    return (
                      <li key={item.href}>
                        <Link aria-current={active ? "page" : undefined} href={item.href}>
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </nav>
        </aside>
        {menuOpen ? (
          <button
            aria-label="Close admin navigation"
            className="admin-sidebar-backdrop"
            onClick={() => setMenuOpen(false)}
            type="button"
          />
        ) : null}
        <div className="admin-workspace">{children}</div>
      </div>
    </div>
  );
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
