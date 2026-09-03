import type { UiLocale } from "./messages";

type OnboardingMessages = {
  eyebrow: string;
  title: string;
  intro: string;
  terms: string;
  acceptableUse: string;
  privacy: string;
  agreement: string;
  informationHeading: string;
  information: string[];
  submit: string;
  submitting: string;
  signOut: string;
  signOutError: string;
  error: string;
  changed: string;
};

const en: OnboardingMessages = {
  eyebrow: "Getting started",
  title: "Before your first call",
  intro: "Before using SHPROHLI, please read the Terms of Use, Acceptable Use Policy and Privacy Notice.",
  terms: "Terms of Use",
  acceptableUse: "Acceptable Use Policy",
  privacy: "Privacy Notice",
  agreement: "I agree to the Terms of Use and Acceptable Use Policy.",
  informationHeading: "Before you continue",
  information: [
    "The recipient is told that an AI assistant is calling, and the call continues only with their consent.",
    "AI conversations and transcripts can contain errors. Check important details.",
    "SHPROHLI is for legitimate, low-risk everyday calls and cannot be used for prohibited purposes."
  ],
  submit: "Agree and continue",
  submitting: "Saving…",
  signOut: "Sign out",
  signOutError: "You could not be signed out. Please try again.",
  error: "Your agreement could not be saved. Please review the documents and try again.",
  changed: "A legal document changed while this page was open. Please review the current documents and try again."
};

const de: OnboardingMessages = {
  eyebrow: "Erste Schritte",
  title: "Vor Ihrem ersten Anruf",
  intro: "Bevor Sie SHPROHLI nutzen, lesen Sie bitte die Nutzungsbedingungen, die Regeln zur akzeptablen Nutzung und die Datenschutzhinweise.",
  terms: "Nutzungsbedingungen",
  acceptableUse: "Regeln zur akzeptablen Nutzung",
  privacy: "Datenschutzhinweise",
  agreement: "Ich stimme den Nutzungsbedingungen und den Regeln zur akzeptablen Nutzung zu.",
  informationHeading: "Bevor Sie fortfahren",
  information: [
    "Die angerufene Person wird darüber informiert, dass ein KI-Assistent anruft. Der Anruf wird nur mit ihrer Zustimmung fortgesetzt.",
    "KI-Gespräche und Transkripte können Fehler enthalten. Prüfen Sie wichtige Angaben.",
    "SHPROHLI ist für legitime, risikoarme Alltagstelefonate bestimmt und darf nicht für verbotene Zwecke verwendet werden."
  ],
  submit: "Zustimmen und weiter",
  submitting: "Wird gespeichert…",
  signOut: "Abmelden",
  signOutError: "Sie konnten nicht abgemeldet werden. Versuchen Sie es erneut.",
  error: "Ihre Zustimmung konnte nicht gespeichert werden. Prüfen Sie die Dokumente und versuchen Sie es erneut.",
  changed: "Ein rechtliches Dokument wurde währenddessen geändert. Prüfen Sie bitte die aktuellen Dokumente und versuchen Sie es erneut."
};

export const onboardingMessages: Record<UiLocale, OnboardingMessages> = { en, de };
