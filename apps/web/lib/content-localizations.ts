/** Preserve all language keys when an editor changes one translation. */
export function normalizeLocalizedText(values: Record<string, string>) {
  return Object.fromEntries(Object.entries(values).map(([locale, text]) => [locale, text.trim()]));
}

export function normalizeLocalizedList(values: Record<string, string[]>) {
  return Object.fromEntries(Object.entries(values).map(([locale, items]) => [locale,
    items.map((item) => item.trim()).filter(Boolean)
  ]));
}

export function contentLanguageDirection(locale: string): "ltr" | "rtl" {
  return /^(ar|arc|dv|fa|he|ku|ps|sd|ug|ur|yi)(-|$)|-(Arab|Hebr|Thaa|Syrc)(-|$)/i.test(locale) ? "rtl" : "ltr";
}
