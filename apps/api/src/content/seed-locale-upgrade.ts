import { isDeepStrictEqual } from "node:util";
import { contentUiLocales, type AdminEditorialRevision } from "@callassist/contracts";
import { editorialAvailableLocales } from "./content-locales";

/** Only upgrade an unchanged bundled EN/DE publication. Edited CMS content wins. */
export function canUpgradeSeedLocales(current: AdminEditorialRevision, seed: AdminEditorialRevision): boolean {
  if (contentUiLocales.every(locale => editorialAvailableLocales(current).includes(locale))) return false;
  // Comparing the full existing copy also protects manually added/partial translations.
  return isDeepStrictEqual(current.items, legacyCopy(seed.items));
}
function legacyCopy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(legacyCopy);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (Object.hasOwn(record, "en") && Object.hasOwn(record, "de")) return { en: record.en, de: record.de };
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, legacyCopy(item)]));
}
