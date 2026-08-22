import type { ContentLocale, ContentPageKey } from "@callassist/contracts";

export const contentSlugs: Record<
  ContentLocale,
  Record<ContentPageKey, string>
> = {
  en: {
    privacy: "privacy",
    terms: "terms",
    acceptable_use: "acceptable-use",
    support: "support",
    faq: "faq"
  },
  de: {
    privacy: "datenschutz",
    terms: "nutzungsbedingungen",
    acceptable_use: "nutzungsregeln",
    support: "hilfe",
    faq: "faq"
  }
};

export function contentPath(locale: ContentLocale, key: ContentPageKey) {
  return `/${locale}/${contentSlugs[locale][key]}`;
}

export function switchContentLocale(
  pathname: string,
  nextLocale: ContentLocale
) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length !== 2) return null;
  const [currentLocale, currentSlug] = segments;
  if (currentLocale !== "en" && currentLocale !== "de") return null;
  const key = (Object.keys(contentSlugs[currentLocale]) as ContentPageKey[])
    .find((candidate) => contentSlugs[currentLocale][candidate] === currentSlug);
  return key ? contentPath(nextLocale, key) : null;
}
