import type { PublishedContentIndex } from "@callassist/contracts";
import type { MetadataRoute } from "next";
import { absoluteSiteUrl } from "./site-config";

export function buildSitemap(index: PublishedContentIndex): MetadataRoute.Sitemap {
  const homeLocales = index.landing?.localizations.map(({ locale }) => locale) ?? [];
  const defaultLocale = homeLocales.find((locale) => locale === index.landing?.sourceLocale) ?? homeLocales[0];
  const homeAlternates = Object.fromEntries(homeLocales.map((locale) => [locale, absoluteSiteUrl(`/${locale}`)]));
  if (defaultLocale) homeAlternates["x-default"] = absoluteSiteUrl(`/${defaultLocale}`);
  const routes: MetadataRoute.Sitemap = homeLocales.map((locale) => ({
    url: absoluteSiteUrl(`/${locale}`),
    lastModified: index.landing?.revision.publishedAt,
    changeFrequency: "weekly",
    priority: 1,
    alternates: { languages: homeAlternates }
  }));
  for (const page of index.pages) {
    const defaultLocalization = page.localizations.find(
      ({ locale }) => locale === page.sourceLocale
    ) ?? page.localizations[0]!;
    const languages = Object.fromEntries([
      ...page.localizations.map((localization) => [
        localization.locale,
        absoluteSiteUrl(`/${localization.locale}/${localization.slug}`)
      ]),
      [
        "x-default",
        absoluteSiteUrl(`/${defaultLocalization.locale}/${defaultLocalization.slug}`)
      ]
    ]);
    for (const localization of page.localizations) {
      routes.push({
        url: absoluteSiteUrl(`/${localization.locale}/${localization.slug}`),
        lastModified: page.revision.publishedAt,
        changeFrequency: "monthly",
        priority: page.key === "faq" ? 0.7 : 0.6,
        alternates: { languages }
      });
    }
  }
  return routes;
}
