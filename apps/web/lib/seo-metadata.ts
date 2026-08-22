import type {
  PublishedContentIndexPage,
  PublishedContentPage,
  PublishedLanding
} from "@callassist/contracts";
import type { Metadata } from "next";
import type { UiLocale } from "./i18n/messages";
import { homeSeo } from "./site-config";

export function homeMetadata(
  locale: UiLocale,
  landing?: PublishedLanding | null
): Metadata {
  const seo = landing?.seo ?? homeSeo[locale];
  const canonical = `/${locale}`;
  return {
    title: seo.title,
    description: seo.description,
    alternates: {
      canonical,
      languages: { en: "/en", de: "/de", "x-default": "/en" }
    },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: "CallAssist",
      locale: locale === "de" ? "de_CH" : "en_CH",
      alternateLocale: [locale === "de" ? "en_CH" : "de_CH"],
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
    .map(({ locale }) => locale === "de" ? "de_CH" : "en_CH");
  return {
    title: page.seoTitle,
    description: page.seoDescription,
    alternates: { canonical, languages },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: "CallAssist",
      locale: page.locale === "de" ? "de_CH" : "en_CH",
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
      images: [`/${page.locale}/opengraph-image`]
    }
  };
}

function socialImage(locale: UiLocale, title: string) {
  return {
    url: `/${locale}/opengraph-image`,
    width: 1200,
    height: 630,
    alt: `${title} — CallAssist`
  };
}
