import { isUiLocale, uiLocales, type UiLocale } from "./messages";

export const defaultUiLocale: UiLocale = "en";
export const uiLocaleCookie = "callassist_ui_locale";

export function localeFromPathname(pathname: string): UiLocale | null {
  const segment = pathname.split("/").filter(Boolean)[0];
  return segment && isUiLocale(segment) ? segment : null;
}

export function localizePathname(pathname: string, locale: UiLocale) {
  const currentLocale = localeFromPathname(pathname);
  if (currentLocale) return pathname.replace(`/${currentLocale}`, `/${locale}`);
  return pathname === "/" ? `/${locale}` : `/${locale}${pathname}`;
}

export function negotiateUiLocale({ acceptLanguage, cookieLocale }: {
  acceptLanguage?: string | null;
  cookieLocale?: string | null;
}): UiLocale {
  if (cookieLocale && isUiLocale(cookieLocale)) return cookieLocale;
  const requested = (acceptLanguage ?? "").split(",")
    .map((entry) => entry.split(";")[0]?.trim().toLowerCase()).filter(Boolean);
  for (const language of requested) {
    const match = uiLocales.find((locale) =>
      language === locale || language?.startsWith(`${locale}-`));
    if (match) return match;
  }
  return defaultUiLocale;
}
