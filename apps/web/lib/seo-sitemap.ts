import type { PublishedContentIndex } from "@callassist/contracts";
import type { MetadataRoute } from "next";
import { absoluteSiteUrl } from "./site-config";

export function buildSitemap(index: PublishedContentIndex): MetadataRoute.Sitemap {
  const homeAlternates = {
    en: absoluteSiteUrl("/en"),
    de: absoluteSiteUrl("/de"),
    "x-default": absoluteSiteUrl("/en")
  };
  const routes: MetadataRoute.Sitemap = ["en", "de"].map((locale) => ({
    url: absoluteSiteUrl(`/${locale}`),
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
