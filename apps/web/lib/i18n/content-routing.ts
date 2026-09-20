import { uiLocales, uiLocaleRegistry, DEFAULT_UI_LOCALE } from "@callassist/contracts";
import type {
  ContentLocale,
  ContentPageKey,
  NavigationDestination
} from "@callassist/contracts";

export const contentSlugs: Record<ContentLocale, Record<ContentPageKey, string>> = Object.fromEntries(uiLocales.map(locale => [locale, uiLocaleRegistry[locale].slugs]));

export function contentPath(locale: ContentLocale, key: ContentPageKey) {
  const actualLocale = Object.hasOwn(contentSlugs, locale) ? locale : DEFAULT_UI_LOCALE;
  return `/${actualLocale}/${contentSlugs[actualLocale][key]}`;
}

export function navigationPath(
  locale: ContentLocale,
  destination: NavigationDestination
) {
  if (destination === "home") return `/${locale}`;
  if (destination === "how_it_works") return `/${locale}#how-it-works`;
  if (destination === "opt_out") return `/${locale}/opt-out`;
  return contentPath(locale, destination);
}

export function switchContentLocale(
  pathname: string,
  nextLocale: ContentLocale
) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length !== 2) return null;
  const [currentLocale, currentSlug] = segments;
  if (!currentLocale || !Object.hasOwn(contentSlugs, currentLocale)) return null;
  const key = (Object.keys(contentSlugs[currentLocale]) as ContentPageKey[])
    .find((candidate) => contentSlugs[currentLocale][candidate] === currentSlug);
  return key ? contentPath(nextLocale, key) : null;
}
