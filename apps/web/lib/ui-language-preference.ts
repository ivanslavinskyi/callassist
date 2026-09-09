import { isUiLocale, type UiLocale } from "./i18n/messages";
import { uiLocaleCookie } from "./i18n/routing";

const explicitGuestCookie = "callassist_explicit_guest_locale";

export function readExplicitGuestLocale(cookie: string): UiLocale | null {
  const value = cookie.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${explicitGuestCookie}=`))?.split("=")[1];
  return value && isUiLocale(value) ? value : null;
}

export function resolvePostLoginLocale({ explicitGuestLocale, accountLocale, pageLocale }: {
  explicitGuestLocale: UiLocale | null;
  accountLocale: string;
  pageLocale: UiLocale;
}): UiLocale {
  return explicitGuestLocale ?? (isUiLocale(accountLocale) ? accountLocale : pageLocale);
}

export function rememberUiLocale(locale: UiLocale, explicitGuest = false) {
  document.cookie = `${uiLocaleCookie}=${locale};path=/;max-age=31536000;samesite=lax`;
  if (explicitGuest) {
    document.cookie = `${explicitGuestCookie}=${locale};path=/;max-age=86400;samesite=lax`;
  }
}

export function clearExplicitGuestLocale() {
  document.cookie = `${explicitGuestCookie}=;path=/;max-age=0;samesite=lax`;
}
