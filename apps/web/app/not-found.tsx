import { resolveUiLocale } from "@callassist/contracts";
import { systemMessages } from "@/lib/i18n/system-messages";
import Link from "next/link";
import { headers } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { UiLocaleProvider } from "@/components/ui-locale-provider";

export default async function NotFound() {
  const locale = resolveUiLocale((await headers()).get("x-callassist-ui-locale"));
  const copy = systemMessages[locale];
  return <UiLocaleProvider locale={locale}><AppShell><main className="system-page" id="main-content" tabIndex={-1}>
    <span className="eyebrow">404</span><h1>{copy.notFound}</h1>
    <p>{copy.unavailable}</p>
    <Link className="primary-button compact-button" href={`/${locale}`}>{copy.home}</Link>
  </main></AppShell></UiLocaleProvider>;
}
