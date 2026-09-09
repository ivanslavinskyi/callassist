import { createUiLocaleRouting, uiLocaleRegistry, type UiLocale } from "./registry";

export const defaultUiLocale: UiLocale = "en";
export const uiLocaleCookie = "callassist_ui_locale";
const routing = createUiLocaleRouting(uiLocaleRegistry, defaultUiLocale);
export const localeFromPathname = routing.fromPathname;
export const localizePathname = routing.localizePathname;
export const negotiateUiLocale = routing.negotiate;
