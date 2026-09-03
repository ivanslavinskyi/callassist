import type {
  ContentLocale,
  ContentPageKey,
  NavigationDestination
} from "@callassist/contracts";

export const contentSlugs: Record<
  ContentLocale,
  Record<ContentPageKey, string>
> = {
  en: {
    privacy: "privacy",
    terms: "terms",
    acceptable_use: "acceptable-use",
    support: "support",
    faq: "faq",
    imprint: "imprint"
  },
  de: {
    privacy: "datenschutz",
    terms: "nutzungsbedingungen",
    acceptable_use: "nutzungsregeln",
    support: "hilfe",
    faq: "faq",
    imprint: "impressum"
  }
};

export function contentPath(locale: ContentLocale, key: ContentPageKey) {
  return `/${locale}/${contentSlugs[locale][key]}`;
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
  if (currentLocale !== "en" && currentLocale !== "de") return null;
  const key = (Object.keys(contentSlugs[currentLocale]) as ContentPageKey[])
    .find((candidate) => contentSlugs[currentLocale][candidate] === currentSlug);
  return key ? contentPath(nextLocale, key) : null;
}
