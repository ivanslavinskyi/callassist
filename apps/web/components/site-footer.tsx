"use client";

import type { PublishedNavigation } from "@callassist/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getPublishedNavigation } from "@/lib/api";
import { contentPath } from "@/lib/i18n/content-routing";
import { messages as catalogues, type UiLocale } from "@/lib/i18n/messages";

export function SiteFooter({ locale, navigation }: { locale: UiLocale; navigation?: PublishedNavigation | null }) {
  const [published, setPublished] = useState<PublishedNavigation | null>(null);
  useEffect(() => {
    if (navigation !== undefined) return;
    let active = true;
    void getPublishedNavigation(locale).then(result => { if (active) setPublished(result.navigation); }).catch(() => {});
    return () => { active = false; };
  }, [locale, navigation]);
  const currentNavigation = navigation === undefined ? published : navigation;
  const copy = catalogues[locale].app;
  const product = currentNavigation?.items.filter(({ location, destination }) => location === "footer" && !["privacy", "terms", "acceptable_use", "imprint"].includes(destination)) ?? [
    { id: "faq", href: contentPath(locale, "faq"), label: copy.faq },
    { id: "support", href: contentPath(locale, "support"), label: copy.support },
    { id: "opt-out", href: `/${locale}/opt-out`, label: copy.optOut }
  ];
  const legal = currentNavigation?.items.filter(({ location, destination }) => location === "footer" && ["privacy", "terms", "acceptable_use", "imprint"].includes(destination)) ?? [
    { id: "privacy", href: contentPath(locale, "privacy"), label: copy.privacy },
    { id: "terms", href: contentPath(locale, "terms"), label: copy.terms },
    { id: "acceptable-use", href: contentPath(locale, "acceptable_use"), label: copy.acceptableUse },
    { id: "imprint", href: contentPath(locale, "imprint"), label: copy.imprint }
  ];
  return <footer className="site-footer">
    <div className="footer-brand"><strong>SHPROHLI</strong><p>{copy.publicBeta}</p></div>
    <nav aria-label={copy.footerProduct}>{product.map(item => <Link key={item.id} href={item.href}>{item.label}</Link>)}</nav>
    <nav aria-label={copy.footerLegal}>{legal.map(item => <Link key={item.id} href={item.href}>{item.label}</Link>)}</nav>
  </footer>;
}
