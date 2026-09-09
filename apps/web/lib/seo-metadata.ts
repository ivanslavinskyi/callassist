import type {
  PublishedContentIndexPage,
  PublishedContentPage,
  PublishedLanding,
  PublishedLandingIndex
} from "@callassist/contracts";
import type { Metadata } from "next";
import { isUiLocale, type UiLocale } from "./i18n/messages";
import { homeSeo } from "./site-config";

export function homeMetadata(
  locale: UiLocale,
  landing?: PublishedLanding | null,
  publishedIndex?: PublishedLandingIndex | null
): Metadata {
  const seo = landing?.seo ?? homeSeo[locale];
  const actualLocale = landing?.locale ?? locale;
  const canonical = `/${actualLocale}`;
  const available = publishedIndex?.localizations.map(({ locale }) => locale) ?? (landing ? [actualLocale] : []);
  const defaultLocale = publishedIndex?.sourceLocale && available.includes(publishedIndex.sourceLocale)
    ? publishedIndex.sourceLocale : available[0];
  const languages = Object.fromEntries(available.map((locale) => [locale, `/${locale}`]));
  if (defaultLocale) languages["x-default"] = `/${defaultLocale}`;
  return {
    title: seo.title,
    description: seo.description,
    alternates: {
      canonical,
      languages
    },
    robots: { index: Boolean(landing) && actualLocale === locale, follow: true },
    openGraph: {
      type: "website",
      siteName: "SHPROHLI",
      locale: openGraphLocale(actualLocale),
      alternateLocale: available.filter((locale) => locale !== actualLocale).map(openGraphLocale),
      url: canonical,
      title: seo.title,
      description: seo.description,
      images: [socialImage(locale, seo.title)]
    },
    twitter: {
      card: "summary_large_image",
      title: seo.title,
      description: seo.description,
      images: [`/${locale}/opengraph-image`]
    }
  };
}

export function contentPageMetadata(
  page: PublishedContentPage,
  indexPage: PublishedContentIndexPage | undefined
): Metadata {
  const canonical = `/${page.locale}/${page.slug}`;
  const languages = Object.fromEntries(
    (indexPage?.localizations ?? [{ locale: page.locale, slug: page.slug }])
      .map((localization) => [
        localization.locale,
        `/${localization.locale}/${localization.slug}`
      ])
  );
  const defaultLocalization = indexPage?.localizations.find(
    ({ locale }) => locale === indexPage.sourceLocale
  ) ?? indexPage?.localizations[0];
  if (defaultLocalization) {
    languages["x-default"] =
      `/${defaultLocalization.locale}/${defaultLocalization.slug}`;
  }
  const alternateLocales = (indexPage?.localizations ?? [])
    .filter(({ locale }) => locale !== page.locale)
    .map(({ locale }) => openGraphLocale(locale));
  return {
    title: page.seoTitle,
    description: page.seoDescription,
    alternates: { canonical, languages },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: "SHPROHLI",
      locale: openGraphLocale(page.locale),
      alternateLocale: alternateLocales,
      url: canonical,
      title: page.seoTitle,
      description: page.seoDescription,
      images: [socialImage(page.locale, page.title)]
    },
    twitter: {
      card: "summary_large_image",
      title: page.seoTitle,
      description: page.seoDescription,
      images: [socialImage(page.locale, page.title).url]
    }
  };
}

function socialImage(locale: string, title: string) {
  const imageLocale = isUiLocale(locale) ? locale : "en";
  return {
    url: `/${imageLocale}/opengraph-image`,
    width: 1200,
    height: 630,
    alt: `${title} — SHPROHLI`
  };
}

function openGraphLocale(locale: string) {
  if (locale === "en" || locale === "de") return `${locale}_CH`;
  const tag = new Intl.Locale(locale).maximize();
  return `${tag.language}_${tag.region}`;
}
