import { normalizeLanguageTag, resolveUiLocale, uiLocales, type UiLocale } from "@callassist/contracts";

export type EmailLocale = UiLocale;
export type CommunicationLanguage = UiLocale;
// Twilio's SMS capability is separate: it has no approved Romansh template.
export const communicationLocales = Object.fromEntries(uiLocales.map(locale => [locale, {
  email: locale, sms: locale === "rm" ? "en" : locale,
  emailReadiness: locale === "en" || locale === "de" ? "reviewed" : "candidate"
}])) as Record<UiLocale, { email: UiLocale; sms: Exclude<UiLocale, "rm">; emailReadiness: "reviewed" | "candidate" }>;
export function resolveCommunicationLocale(value: string | null | undefined) {
  const tag = value ? normalizeLanguageTag(value) : null;
  const language = resolveUiLocale(tag);
  return { requested: tag, language, ...communicationLocales[language] };
}
export function resolveEmailLocale(preferred: string | null | undefined, session?: string | null): EmailLocale {
  return resolveUiLocale(preferred, session);
}
