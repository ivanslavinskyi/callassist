import type { UiLocale } from "./messages";

const en = {
  eyebrow: "Before your first call",
  title: "Review the beta boundaries",
  intro: "CallAssist places real phone calls. Confirm the current legal versions and the operational safeguards before entering the call console.",
  terms: "Beta terms of use",
  acceptableUse: "Acceptable Use Policy",
  privacy: "Privacy notice",
  revision: (number: number) => `Revision ${number}`,
  legalHeading: "Legal acceptance",
  acceptTerms: "I have read and accept the current Beta terms of use.",
  acceptAcceptableUse: "I have read and accept the current Acceptable Use Policy.",
  safeguardsHeading: "Operational acknowledgements",
  consent: "I understand that the assistant identifies itself and recipient processing or recording starts only after the recipient presses 1.",
  retention: "I understand the 0, 7, and 30-day audio-retention choices and that transcripts may remain after audio deletion.",
  useLimits: "I will use CallAssist only for legitimate low-risk tasks and never for emergencies, harassment, deception, spam, or high-stakes negotiation.",
  credits: "I understand that the beta is Switzerland-only, includes three signup credits, and charges a credit only after a confirmed connection.",
  submit: "Accept and open CallAssist",
  submitting: "Recording acceptance…",
  signOut: "Sign out",
  signOutError: "You could not be signed out. Please try again.",
  error: "Acceptance could not be recorded. Please review the current documents and try again.",
  changed: "A legal document changed while this page was open. The current revision has been loaded; please review it again."
} as const;

type OnboardingMessages = {
  [Key in keyof typeof en]: Key extends "revision"
    ? (number: number) => string
    : string;
};

const de: OnboardingMessages = {
  eyebrow: "Vor dem ersten Anruf",
  title: "Grenzen der Beta prüfen",
  intro: "CallAssist führt echte Telefonanrufe durch. Bestätigen Sie die aktuellen rechtlichen Versionen und Schutzmechanismen, bevor Sie die Anrufkonsole öffnen.",
  terms: "Beta-Nutzungsbedingungen",
  acceptableUse: "Regeln zur akzeptablen Nutzung",
  privacy: "Datenschutzhinweise",
  revision: (number: number) => `Version ${number}`,
  legalHeading: "Rechtliche Zustimmung",
  acceptTerms: "Ich habe die aktuellen Beta-Nutzungsbedingungen gelesen und akzeptiere sie.",
  acceptAcceptableUse: "Ich habe die aktuellen Regeln zur akzeptablen Nutzung gelesen und akzeptiere sie.",
  safeguardsHeading: "Bestätigung der Schutzmechanismen",
  consent: "Ich verstehe, dass sich der Assistent als KI nennt und Verarbeitung oder Aufnahme erst beginnt, nachdem die empfangende Person die 1 gedrückt hat.",
  retention: "Ich verstehe die Audioaufbewahrung von 0, 7 oder 30 Tagen und dass Transkripte nach der Audiolöschung bestehen bleiben können.",
  useLimits: "Ich nutze CallAssist nur für legitime Aufgaben mit geringem Risiko und nie für Notfälle, Belästigung, Täuschung, Spam oder Verhandlungen mit hohem Risiko.",
  credits: "Ich verstehe, dass die Beta auf die Schweiz begrenzt ist, drei Startguthaben enthält und erst nach einer bestätigten Verbindung belastet wird.",
  submit: "Akzeptieren und CallAssist öffnen",
  submitting: "Zustimmung wird gespeichert…",
  signOut: "Abmelden",
  signOutError: "Sie konnten nicht abgemeldet werden. Versuchen Sie es erneut.",
  error: "Die Zustimmung konnte nicht gespeichert werden. Prüfen Sie die aktuellen Dokumente und versuchen Sie es erneut.",
  changed: "Ein rechtliches Dokument wurde währenddessen geändert. Die aktuelle Version wurde geladen; bitte prüfen Sie sie erneut."
};

export const onboardingMessages: Record<UiLocale, OnboardingMessages> = { en, de };
