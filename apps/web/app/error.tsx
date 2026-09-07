"use client";

import { AppShell } from "@/components/app-shell";
import { UiLocaleProvider } from "@/components/ui-locale-provider";
import { usePathname } from "next/navigation";

export default function PageError({ reset }: { reset: () => void }) {
  const locale = usePathname()?.split("/")[1] === "de" ? "de" : "en";
  return <UiLocaleProvider locale={locale}><AppShell><main className="system-page" id="main-content" tabIndex={-1}>
    <h1>{locale === "de" ? "Diese Seite konnte nicht geladen werden" : "We could not load this page"}</h1>
    <p>{locale === "de" ? "Bitte versuchen Sie es erneut." : "Please try again."}</p>
    <button className="primary-button compact-button" type="button" onClick={reset}>{locale === "de" ? "Erneut versuchen" : "Try again"}</button>
  </main></AppShell></UiLocaleProvider>;
}
