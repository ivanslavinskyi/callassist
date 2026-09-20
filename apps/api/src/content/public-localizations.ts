import { DEFAULT_UI_LOCALE, uiLocaleRegistry, contentUiLocales, type ContentPageKey, type ContentSection, type UiLocale } from "@callassist/contracts";
import fr from "./locales/fr.json";
import it from "./locales/it.json";
import rm from "./locales/rm.json";
import ru from "./locales/ru.json";
import uk from "./locales/uk.json";

export const publicLocaleResources: Partial<Record<UiLocale, Record<string, string>>> = { fr, it, rm, ru, uk };
/** Seed content must be complete. Missing copy fails validation instead of mixing languages. */
export function publicText(source: string, locale: UiLocale): string {
  if (locale === DEFAULT_UI_LOCALE || source.includes("@shprohli.ch") && !source.includes(" ")) return source;
  const translated = publicLocaleResources[locale]?.[source];
  if (!translated) throw new Error(`PUBLIC_TRANSLATION_MISSING: ${locale}: ${source}`);
  return translated;
}

export function localizedPublicText(en: string, de: string): Record<UiLocale, string> {
  return Object.fromEntries(contentUiLocales
    .map(locale => [locale, locale === "de" ? de : publicText(en, locale)])) as Record<UiLocale, string>;
}

type PageCopy = { slug: string; title: string; summary: string; seoTitle: string; seoDescription: string; sections: ContentSection[] };
export function localizePublicPage(source: PageCopy, key: ContentPageKey, locale: UiLocale): PageCopy {
  const t = (value: string) => publicText(value, locale);
  return { slug: uiLocaleRegistry[locale].slugs[key], title: t(source.title), summary: t(source.summary),
    seoTitle: t(source.seoTitle), seoDescription: t(source.seoDescription),
    sections: source.sections.map(section => ({ ...section, heading: t(section.heading),
      paragraphs: section.paragraphs.map(t), bullets: section.bullets.map(t),
      ...(section.links ? { links: section.links.map(link => ({ ...link, label: t(link.label) })) } : {}) })) };
}
