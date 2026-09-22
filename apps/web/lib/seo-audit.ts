import type {
  ContentLocale,
  ContentPageKey,
  PublishedContentIndex
} from "@callassist/contracts";
import { absoluteSiteUrl, homeSeo } from "./site-config";
import { fallbackOgImagePath, isUiLocale, ogImagePath, type PublishedOgImage } from "@callassist/contracts";

export type SeoAuditIssue =
  | "translation_stale"
  | "title_short"
  | "title_long"
  | "description_short"
  | "description_long";

export type SeoAuditRoute = {
  key: "home" | ContentPageKey;
  locale: ContentLocale;
  url: string;
  canonical: string;
  title: string;
  description: string;
  revisionNumber: number | null;
  publishedAt: string | null;
  translationStale: boolean;
  alternates: Record<string, string>;
  ogImage: string;
  issues: SeoAuditIssue[];
};

export function buildSeoAudit(index: PublishedContentIndex, images: PublishedOgImage[] = []): SeoAuditRoute[] {
  const available = index.landing?.localizations.filter(item => isUiLocale(item.locale)) ?? [];
  const sourceLocale = index.landing?.sourceLocale;
  const defaultLocale = available.find(item => item.locale === sourceLocale)?.locale ?? available[0]?.locale;
  const routes: SeoAuditRoute[] = available.map(({ locale }) => {
    const localization = index.landing?.localizations.find(
      (candidate) => candidate.locale === locale
    );
    const seo = localization ? {
      title: localization.seoTitle,
      description: localization.seoDescription
    } : homeSeo[isUiLocale(locale) ? locale : "en"];
    return routeAudit({
      key: "home",
      locale,
      pathname: `/${locale}`,
      title: seo.title,
      description: seo.description,
      revisionNumber: index.landing?.revision.number ?? null,
      publishedAt: index.landing?.revision.publishedAt ?? null,
      translationStale: localization?.translationStale ?? false,
      alternates: Object.fromEntries([
        ...available.map(item => [item.locale, absoluteSiteUrl(`/${item.locale}`)]),
        ...(defaultLocale ? [["x-default", absoluteSiteUrl(`/${defaultLocale}`)]] : [])
      ]),
      image: images.find(image => image.locale === locale)
    });
  });
  for (const page of index.pages) {
    const source = page.localizations.find(
      ({ locale }) => locale === page.sourceLocale
    ) ?? page.localizations[0]!;
    const alternates = Object.fromEntries([
      ...page.localizations.map((localization) => [
        localization.locale,
        absoluteSiteUrl(`/${localization.locale}/${localization.slug}`)
      ]),
      ["x-default", absoluteSiteUrl(`/${source.locale}/${source.slug}`)]
    ]);
    for (const localization of page.localizations) {
      routes.push(routeAudit({
        key: page.key,
        locale: localization.locale,
        pathname: `/${localization.locale}/${localization.slug}`,
        title: localization.seoTitle,
        description: localization.seoDescription,
        revisionNumber: page.revision.number,
        publishedAt: page.revision.publishedAt,
        translationStale: localization.translationStale,
        alternates
      }));
    }
  }
  return routes.sort((left, right) => left.url.localeCompare(right.url));
}

function routeAudit(input: {
  key: SeoAuditRoute["key"];
  locale: ContentLocale;
  pathname: string;
  title: string;
  description: string;
  revisionNumber: number | null;
  publishedAt: string | null;
  translationStale: boolean;
  alternates: Record<string, string>;
  image?: PublishedOgImage;
}): SeoAuditRoute {
  const issues: SeoAuditIssue[] = [];
  if (input.translationStale) issues.push("translation_stale");
  if (input.title.length < 20) issues.push("title_short");
  if (input.title.length > 60) issues.push("title_long");
  if (input.description.length < 50) issues.push("description_short");
  if (input.description.length > 160) issues.push("description_long");
  const url = absoluteSiteUrl(input.pathname);
  return {
    key: input.key,
    locale: input.locale,
    url,
    canonical: url,
    title: input.title,
    description: input.description,
    revisionNumber: input.revisionNumber,
    publishedAt: input.publishedAt,
    translationStale: input.translationStale,
    alternates: input.alternates,
    ogImage: absoluteSiteUrl(input.image ? ogImagePath(input.image) : fallbackOgImagePath(isUiLocale(input.locale) ? input.locale : "en")),
    issues
  };
}
