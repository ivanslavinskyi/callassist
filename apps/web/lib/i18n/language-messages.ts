import { extendMessages } from "./extend-messages";
import type { CallLocale, TextLanguage } from "@callassist/contracts";
import type { UiLocale } from "./messages";

const callLanguageLabels = extendMessages({
  en: {
    "de-CH": "German", "de-DE": "German (Germany)",
    "fr-CH": "French", "it-CH": "Italian",
    "en-GB": "English", "en-US": "English (United States)", "ru-RU": "Russian"
  },
  de: {
    "de-CH": "Deutsch", "de-DE": "Deutsch (Deutschland)",
    "fr-CH": "Französisch", "it-CH": "Italienisch",
    "en-GB": "Englisch", "en-US": "Englisch (USA)", "ru-RU": "Russisch"
  }
}) satisfies Record<UiLocale, Record<CallLocale, string>>;

const textLanguageLabels = extendMessages({
  en: { en: "English", de: "German", fr: "French", it: "Italian", ru: "Russian", uk: "Ukrainian" },
  de: { en: "Englisch", de: "Deutsch", fr: "Französisch", it: "Italienisch", ru: "Russisch", uk: "Ukrainisch" }
}) satisfies Record<UiLocale, Record<TextLanguage, string>>;

export function getCallLanguageLabel(callLocale: CallLocale, uiLocale: UiLocale) {
  if (uiLocale === "en" || uiLocale === "de") return callLanguageLabels[uiLocale][callLocale];
  return new Intl.DisplayNames([uiLocale], { type: "language" }).of(callLocale) ?? callLocale;
}

export function getTextLanguageLabel(language: TextLanguage, uiLocale: UiLocale) {
  if (uiLocale === "en" || uiLocale === "de") return textLanguageLabels[uiLocale][language];
  return new Intl.DisplayNames([uiLocale], { type: "language" }).of(language) ?? language;
}

export const languageMessages = extendMessages({
  en: {
    taskLanguage: "Plan and result",
    callLanguageForbidden: "This call language is not available for your account. Choose another language and prepare the plan again.",
    automatic: "Interface language",
    preferenceTitle: "Fallback text language",
    preferenceHelp: "Plans and results use the language of your request. This fallback is used only when that language cannot be identified or is not supported. Existing calls keep their language.",
    saved: "Language preference saved.",
    saveError: "The language preference could not be saved. Please try again.",
    legacyEnglish: "This earlier plan used US English. Updated plans use British English.",
    originalPlan: "The plan below is in the call language.",
    change: "Change"
  },
  de: {
    taskLanguage: "Plan und Ergebnis",
    callLanguageForbidden: "Diese Anrufsprache ist für Ihr Konto nicht verfügbar. Wählen Sie eine andere Sprache und erstellen Sie den Plan erneut.",
    automatic: "Sprache der Oberfläche",
    preferenceTitle: "Ersatzsprache für Texte",
    preferenceHelp: "Pläne und Ergebnisse verwenden die Sprache Ihrer Anfrage. Diese Ersatzsprache wird nur genutzt, wenn die Sprache nicht erkannt oder nicht unterstützt wird. Bestehende Anrufe behalten ihre Sprache.",
    saved: "Spracheinstellung gespeichert.",
    saveError: "Die Spracheinstellung konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.",
    legacyEnglish: "Dieser frühere Plan verwendete US-Englisch. Aktualisierte Pläne verwenden britisches Englisch.",
    originalPlan: "Der folgende Plan ist in der Anrufsprache.",
    change: "Ändern"
  }
}) satisfies Record<UiLocale, Record<string, string>>;
