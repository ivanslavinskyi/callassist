/** Product interface/content capabilities. Voice and generated-text capabilities are independent. */
export const DEFAULT_UI_LOCALE = "en";
export const uiLocaleRegistry = {
  de: { code: "de", medallion: "goethe", shortCode: "DE", nativeName: "Deutsch", order: 0, group: "swiss", enabled: true, ui: true, pages: true, fallback: "en", formatLocale: "de-CH", direction: "ltr", slogan: "Reden ist kein Muss.", slugs: { privacy: "datenschutz", terms: "nutzungsbedingungen", acceptable_use: "nutzungsregeln", support: "hilfe", faq: "faq", imprint: "impressum" } },
  fr: { code: "fr", medallion: "moliere", shortCode: "FR", nativeName: "Français", order: 1, group: "swiss", enabled: true, ui: true, pages: true, fallback: "en", formatLocale: "fr-CH", direction: "ltr", slogan: "Pas besoin de parler.", slugs: { privacy: "confidentialite", terms: "conditions", acceptable_use: "utilisation", support: "aide", faq: "faq", imprint: "mentions-legales" } },
  it: { code: "it", medallion: "dante", shortCode: "IT", nativeName: "Italiano", order: 2, group: "swiss", enabled: true, ui: true, pages: true, fallback: "en", formatLocale: "it-CH", direction: "ltr", slogan: "Non serve parlare.", slugs: { privacy: "privacy", terms: "condizioni", acceptable_use: "utilizzo", support: "aiuto", faq: "faq", imprint: "note-legali" } },
  rm: { code: "rm", medallion: "peider_lansel", shortCode: "RM", nativeName: "Rumantsch", order: 3, group: "swiss", enabled: true, ui: true, pages: true, fallback: "en", formatLocale: "rm-CH", direction: "ltr", slogan: "Ins na sto betg discurrer.", slugs: { privacy: "protecziun-da-datas", terms: "cundiziuns", acceptable_use: "utilisaziun", support: "agid", faq: "faq", imprint: "impressum" } },
  en: { code: "en", medallion: "shakespeare", shortCode: "EN", nativeName: "English", order: 4, group: "additional", enabled: true, ui: true, pages: true, fallback: "en", formatLocale: "en-GB", direction: "ltr", slogan: "No need to talk.", slugs: { privacy: "privacy", terms: "terms", acceptable_use: "acceptable-use", support: "support", faq: "faq", imprint: "imprint" } },
  ru: { code: "ru", medallion: "pushkin", shortCode: "RU", nativeName: "Русский", order: 5, group: "additional", enabled: true, ui: true, pages: true, fallback: "en", formatLocale: "ru-RU", direction: "ltr", slogan: "Говорить не обязательно.", slugs: { privacy: "privacy", terms: "terms", acceptable_use: "acceptable-use", support: "support", faq: "faq", imprint: "imprint" } },
  uk: { code: "uk", medallion: "shevchenko", shortCode: "UK", nativeName: "Українська", order: 6, group: "additional", enabled: true, ui: true, pages: true, fallback: "en", formatLocale: "uk-UA", direction: "ltr", slogan: "Говорити не обов’язково.", slugs: { privacy: "privacy", terms: "terms", acceptable_use: "acceptable-use", support: "support", faq: "faq", imprint: "imprint" } }
} as const;
export type UiLocale = keyof typeof uiLocaleRegistry;
export const uiLocales = (Object.keys(uiLocaleRegistry) as UiLocale[])
  .filter(code => uiLocaleRegistry[code].enabled && uiLocaleRegistry[code].ui)
  .sort((a, b) => uiLocaleRegistry[a].order - uiLocaleRegistry[b].order);
/** Publishing capabilities may lag behind UI availability; pages then fall back as a whole. */
export const contentUiLocales = uiLocales.filter(code => uiLocaleRegistry[code].pages);
export function isUiLocale(value: string): value is UiLocale { return uiLocales.includes(value as UiLocale); }
export function resolveUiLocale(...candidates: Array<string | null | undefined>): UiLocale {
  for (const value of candidates) {
    if (!value) continue;
    const base = value.toLowerCase().split("-")[0]!;
    if (isUiLocale(base)) return base;
  }
  return DEFAULT_UI_LOCALE;
}
export function formatLocale(value: string): string { return uiLocaleRegistry[resolveUiLocale(value)].formatLocale; }
export function formatDateTime(value: string | Date, locale: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat(formatLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zurich", ...options }).format(new Date(value));
}
export function formatNumber(value: number, locale: string, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(formatLocale(locale), options).format(value);
}
