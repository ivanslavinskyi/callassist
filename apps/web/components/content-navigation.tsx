import type { ContentLocale, ContentPageKey } from "@callassist/contracts";
import Link from "next/link";
import { contentPath } from "@/lib/i18n/content-routing";
import { isUiLocale, messages } from "@/lib/i18n/messages";

export function ContentNavigation({ locale, current }: { locale: ContentLocale; current: ContentPageKey }) {
  const interfaceLocale = isUiLocale(locale) ? locale : "en";
  const copy = messages[interfaceLocale].app;
  const items: Array<[ContentPageKey, string]> = [
    ["faq", copy.faq], ["support", copy.support], ["privacy", copy.privacy],
    ["terms", copy.terms], ["acceptable_use", copy.acceptableUse], ["imprint", copy.imprint]
  ];
  return <nav className="content-navigation" lang={interfaceLocale} aria-label={interfaceLocale === "de" ? "Informationen" : "Information pages"}>
    {items.map(([key, label]) => <Link key={key} href={contentPath(locale, key)} aria-current={key === current ? "page" : undefined}>{label}</Link>)}
  </nav>;
}
