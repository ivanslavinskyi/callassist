"use client";

import { resolveUiLocale } from "@callassist/contracts";
import { systemMessages } from "@/lib/i18n/system-messages";
import { AppShell } from "@/components/app-shell";
import { UiLocaleProvider } from "@/components/ui-locale-provider";
import { usePathname } from "next/navigation";

export default function PageError({ reset }: { reset: () => void }) {
  const locale = resolveUiLocale(usePathname()?.split("/")[1]);
  const copy = systemMessages[locale];
  return <UiLocaleProvider locale={locale}><AppShell><main className="system-page" id="main-content" tabIndex={-1}>
    <h1>{copy.loadError}</h1>
    <p>{copy.retryHelp}</p>
    <button className="primary-button compact-button" type="button" onClick={reset}>{copy.retry}</button>
  </main></AppShell></UiLocaleProvider>;
}
