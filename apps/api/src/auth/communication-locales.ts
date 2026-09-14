import { normalizeLanguageTag } from "@callassist/contracts";

// Channel capabilities are independent of UI/voice/task languages. Enabling a UI
// language must include an explicit entry and a reviewed template/fallback decision.
export const communicationLocales = {
  en: { email: "en", sms: "en", emailReadiness: "reviewed" },
  de: { email: "de", sms: "de", emailReadiness: "reviewed" },
  fr: { email: "fr", sms: "fr", emailReadiness: "candidate" },
  it: { email: "it", sms: "it", emailReadiness: "candidate" },
  uk: { email: "uk", sms: "uk", emailReadiness: "candidate" },
  ru: { email: "ru", sms: "ru", emailReadiness: "candidate" },
  // Romansh needs reviewed written copy and an approved Twilio custom template.
  rm: { email: "en", sms: "en", emailReadiness: "fallback" }
} as const;
export type CommunicationLanguage = keyof typeof communicationLocales;
export type EmailLocale = typeof communicationLocales[CommunicationLanguage]["email"];

export function resolveCommunicationLocale(value: string | null | undefined) {
  const tag = value ? normalizeLanguageTag(value) : null;
  const base = tag ? new Intl.Locale(tag).language : "en";
  const language: CommunicationLanguage = Object.hasOwn(communicationLocales, base)
    ? base as CommunicationLanguage : "en";
  return { requested: tag, language, ...communicationLocales[language] };
}

export function resolveEmailLocale(value: string | null | undefined): EmailLocale {
  return resolveCommunicationLocale(value).email;
}
