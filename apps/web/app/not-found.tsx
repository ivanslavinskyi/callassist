import Link from "next/link";
import { headers } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { UiLocaleProvider } from "@/components/ui-locale-provider";

export default async function NotFound() {
  const locale = (await headers()).get("x-callassist-ui-locale") === "de" ? "de" : "en";
  return <UiLocaleProvider locale={locale}><AppShell><main className="system-page" id="main-content" tabIndex={-1}>
    <span className="eyebrow">404</span><h1>{locale === "de" ? "Seite nicht gefunden" : "Page not found"}</h1>
    <p>{locale === "de" ? "Diese Seite ist nicht verfügbar. Kehren Sie zur Startseite zurück." : "This page is unavailable. Return to the home page to continue."}</p>
    <Link className="primary-button compact-button" href={`/${locale}`}>{locale === "de" ? "Zur Startseite" : "Go to home page"}</Link>
  </main></AppShell></UiLocaleProvider>;
}
