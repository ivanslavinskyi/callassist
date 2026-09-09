export type UiLocaleDefinition = {
  nativeName: string;
  formatLocale: string;
  direction: "ltr" | "rtl";
};

/** Interface capabilities are independent of call voices, content storage and text-generation directions. */
export const uiLocaleRegistry = {
  en: { nativeName: "English", formatLocale: "en-GB", direction: "ltr" },
  de: { nativeName: "Deutsch", formatLocale: "de-CH", direction: "ltr" }
} as const satisfies Record<string, UiLocaleDefinition>;

export type UiLocale = keyof typeof uiLocaleRegistry;
export const uiLocales = Object.keys(uiLocaleRegistry) as UiLocale[];

export function createUiLocaleRouting<const R extends Record<string, UiLocaleDefinition>>(registry: R, defaultLocale: keyof R & string) {
  type L = keyof R & string;
  const locales = Object.keys(registry) as L[];
  const isLocale = (value: string): value is L => Object.prototype.hasOwnProperty.call(registry, value);
  const fromPathname = (pathname: string): L | null => {
    const segment = pathname.split("/").filter(Boolean)[0];
    return segment && isLocale(segment) ? segment : null;
  };
  return {
    locales, isLocale, fromPathname,
    localizePathname(pathname: string, locale: L) {
      const current = fromPathname(pathname);
      return current ? pathname.replace(`/${current}`, `/${locale}`) : pathname === "/" ? `/${locale}` : `/${locale}${pathname}`;
    },
    negotiate({ acceptLanguage, cookieLocale }: { acceptLanguage?: string | null; cookieLocale?: string | null }): L {
      if (cookieLocale && isLocale(cookieLocale)) return cookieLocale;
      const requested = (acceptLanguage ?? "").split(",").map((entry, index) => {
        const [tag, weight] = entry.trim().split(";");
        const quality = weight?.trim().startsWith("q=") ? Number(weight.trim().slice(2)) : 1;
        return { tag: tag?.toLowerCase(), quality, index };
      }).filter((entry) => entry.tag && Number.isFinite(entry.quality) && entry.quality > 0 && entry.quality <= 1)
        .sort((left, right) => right.quality - left.quality || left.index - right.index);
      for (const { tag } of requested) {
        const match = locales.find((locale) => tag === locale.toLowerCase() || tag?.startsWith(`${locale.toLowerCase()}-`));
        if (match) return match;
      }
      return defaultLocale;
    }
  };
}
