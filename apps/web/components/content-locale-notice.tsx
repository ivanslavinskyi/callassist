"use client";
import { systemMessages } from "@/lib/i18n/system-messages";
import { useUiLocale } from "./ui-locale-provider";
export function ContentLocaleNotice({ contentLocale }: { contentLocale: string }) {
  const { locale } = useUiLocale();
  return contentLocale === locale ? null : <p className="inline-notice" lang={locale} role="status">{systemMessages[locale].fallback}</p>;
}
