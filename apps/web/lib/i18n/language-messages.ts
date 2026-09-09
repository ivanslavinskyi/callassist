import type { CallLocale, TextLanguage } from "@callassist/contracts";
import type { UiLocale } from "./messages";

const callLanguageLabels = {
  en: {
    "de-CH": "German (Switzerland)", "de-DE": "German (Germany)",
    "fr-CH": "French (Switzerland)", "it-CH": "Italian (Switzerland)",
    "en-GB": "English", "en-US": "English (United States)", "ru-RU": "Russian"
  },
  de: {
    "de-CH": "Deutsch (Schweiz)", "de-DE": "Deutsch (Deutschland)",
    "fr-CH": "Französisch (Schweiz)", "it-CH": "Italienisch (Schweiz)",
    "en-GB": "Englisch", "en-US": "Englisch (USA)", "ru-RU": "Russisch"
  }
} satisfies Record<UiLocale, Record<CallLocale, string>>;

const textLanguageLabels = {
  en: { en: "English", de: "German", fr: "French", it: "Italian", ru: "Russian", uk: "Ukrainian" },
  de: { en: "Englisch", de: "Deutsch", fr: "Französisch", it: "Italienisch", ru: "Russisch", uk: "Ukrainisch" }
} satisfies Record<UiLocale, Record<TextLanguage, string>>;

export function getCallLanguageLabel(callLocale: CallLocale, uiLocale: UiLocale) {
  return callLanguageLabels[uiLocale][callLocale];
}

export function getTextLanguageLabel(language: TextLanguage, uiLocale: UiLocale) {
  return textLanguageLabels[uiLocale][language];
}

export const languageMessages = {
  en: {
    taskLanguage: "Plan and result",
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
    automatic: "Sprache der Oberfläche",
    preferenceTitle: "Ersatzsprache für Texte",
    preferenceHelp: "Pläne und Ergebnisse verwenden die Sprache Ihrer Anfrage. Diese Ersatzsprache wird nur genutzt, wenn die Sprache nicht erkannt oder nicht unterstützt wird. Bestehende Anrufe behalten ihre Sprache.",
    saved: "Spracheinstellung gespeichert.",
    saveError: "Die Spracheinstellung konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.",
    legacyEnglish: "Dieser frühere Plan verwendete US-Englisch. Aktualisierte Pläne verwenden britisches Englisch.",
    originalPlan: "Der folgende Plan ist in der Anrufsprache.",
    change: "Ändern"
  }
} satisfies Record<UiLocale, Record<string, string>>;
