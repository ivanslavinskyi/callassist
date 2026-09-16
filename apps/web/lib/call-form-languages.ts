import type { CallLocale, CreateCallBriefInput } from "@callassist/contracts";

function currentLocale(locale: CallLocale): CallLocale {
  if (locale === "de-DE") return "de-CH";
  if (locale === "en-US") return "en-GB";
  return locale;
}

/** Adapt editable forms only; saved call snapshots retain their original locale. */
export function normalizeCallFormLanguages(form: CreateCallBriefInput): CreateCallBriefInput {
  const locale = currentLocale(form.locale);
  const fallbackLocale = form.fallbackLocale ? currentLocale(form.fallbackLocale) : undefined;
  if (locale === form.locale && fallbackLocale === form.fallbackLocale && fallbackLocale !== locale) return form;
  const next = { ...form, locale, fallbackLocale };
  if (fallbackLocale === locale) {
    next.allowLanguageSwitch = false;
    delete next.fallbackLocale;
  }
  return next;
}
