import { uiLocales, type UiLocale } from "@callassist/contracts";
import fr from "./resources/fr.json";
import it from "./resources/it.json";
import rm from "./resources/rm.json";
import ru from "./resources/ru.json";
import uk from "./resources/uk.json";

/** Additional catalogues use complete source phrases, including interpolation slots.
 * Existing typed EN/DE namespaces and their callers remain the public interface. */
export const additionalUiResources: Partial<Record<UiLocale, Record<string, string>>> = { fr, it, rm, ru, uk };
const patternCache = new Map<string, Array<{ pattern: RegExp; value: string }>>();
export function translatePhrase(source: string, locale: UiLocale): string {
  const resource = additionalUiResources[locale];
  if (!resource) return source;
  if (Object.hasOwn(resource, source)) return resource[source]!;
  let patterns = patternCache.get(locale);
  if (!patterns) {
    patterns = Object.entries(resource).filter(([key]) => key.includes("{0}"))
      .sort(([a], [b]) => b.replace(/\{\d+\}/g, "").length - a.replace(/\{\d+\}/g, "").length)
      .map(([key, value]) => ({ pattern: new RegExp("^" + key.split(/\{\d+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("([\\s\\S]*?)") + "$"), value }));
    patternCache.set(locale, patterns);
  }
  for (const { pattern, value } of patterns) {
    const matches = pattern.exec(source);
    if (matches) return value.replace(/\{(\d+)\}/g, (_match, index: string) => matches[Number(index) + 1] ?? "");
  }
  return source;
}
export function localizeResource<T>(value: T, locale: UiLocale): T {
  if (typeof value === "string") return translatePhrase(value, locale) as T;
  if (typeof value === "function") return ((...args: unknown[]) => translatePhrase(value(...args), locale)) as T;
  if (Array.isArray(value)) return value.map(item => localizeResource(item, locale)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localizeResource(item, locale)])) as T;
  return value;
}
export function extendMessages<T>(base: { en: T; de: T }): Record<UiLocale, T> {
  return Object.fromEntries(uiLocales.map(locale => [locale, locale in base ? base[locale as "en" | "de"] : localizeResource(base.en, locale)])) as Record<UiLocale, T>;
}
