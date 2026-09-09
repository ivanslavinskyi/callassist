import {
  normalizeLanguageTag,
  requiredContentLocales,
  resolvePublishedContentLocale,
  type AdminEditorialRevision
} from "@callassist/contracts";
import { ContentRepositoryError } from "./content-repository";

/** Collect all localizable fields, including nested landing steps and lists. */
function translationMaps(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(translationMaps);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const entries = Object.entries(record);
  if (entries.length && entries.every(([key, text]) => normalizeLanguageTag(key) === key &&
    (typeof text === "string" || Array.isArray(text) && text.every((item) => typeof item === "string")))) {
    return [record];
  }
  return Object.values(record).flatMap(translationMaps);
}

export function editorialAvailableLocales(revision: AdminEditorialRevision): string[] {
  const enabled = revision.items.filter((item) => item.enabled ||
    ("blockType" in item && item.blockType === "hero"));
  const maps = translationMaps(enabled);
  // An empty FAQ/navigation collection has no text to translate.
  if (!maps.length) return requiredContentLocales(revision);
  return Object.keys(maps[0]!).filter((locale) => maps.every((map) => Object.hasOwn(map, locale))).sort();
}

export function editorialLocale(revision: AdminEditorialRevision, requested: string): string | null {
  return resolvePublishedContentLocale(requested, editorialAvailableLocales(revision));
}

export function assertEditorialLocalesReady(revision: AdminEditorialRevision) {
  const available = editorialAvailableLocales(revision);
  if (requiredContentLocales(revision).some((locale) => !available.includes(locale))) {
    throw new ContentRepositoryError("CONTENT_REQUIRED_LOCALE_MISSING");
  }
}

export function commonLegalLocale(
  requested: string,
  termsLocales: string[],
  acceptableUseLocales: string[]
): string {
  const common = termsLocales.filter((locale) => acceptableUseLocales.includes(locale)).sort();
  const locale = resolvePublishedContentLocale(requested, common);
  if (!locale) throw new ContentRepositoryError("LEGAL_CONTENT_UNAVAILABLE");
  return locale;
}
