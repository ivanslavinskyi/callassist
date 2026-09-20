export type UiLocaleDefinition = {
  nativeName: string;
  formatLocale: string;
  direction: "ltr" | "rtl";
  enabled?: boolean; ui?: boolean;
};

export { uiLocaleRegistry, uiLocales, type UiLocale } from "@callassist/contracts";

export function createUiLocaleRouting<const R extends Record<string, UiLocaleDefinition>>(registry: R, defaultLocale: keyof R & string) {
  type L = keyof R & string;
  const locales = Object.keys(registry).filter(key => registry[key]?.enabled !== false && registry[key]?.ui !== false) as L[];
  const isLocale = (value: string): value is L => locales.includes(value as L);
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
