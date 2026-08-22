import type { UiLocale } from "./messages";

const en = {
  eyebrow: "Accessible phone assistance",
  title: "Your call. Your intent. An AI assistant that speaks for you.",
  lead: "CallAssist helps people with speech impairments or local-language barriers prepare, review, and supervise everyday phone calls.",
  tryBeta: "Try the beta",
  signIn: "Sign in",
  badges: ["Free public beta", "3 calls included", "Switzerland only"],
  howEyebrow: "How it works",
  howTitle: "You remain in control from brief to result.",
  steps: [
    { title: "Describe", text: "Set the recipient, objective, language, and facts the assistant may share." },
    { title: "Review", text: "CallAssist compiles a bounded plan for you to check and explicitly approve." },
    { title: "Call", text: "The assistant identifies itself and waits for consent before conversation processing or recording." },
    { title: "Result", text: "Follow the live call, stop it at any time, and review the result and transcript." }
  ],
  safetyEyebrow: "Designed for a limited beta",
  safetyTitle: "Clear boundaries before every call.",
  safetyText: "Recording starts only after recipient consent. You choose 0, 7, or 30 days of audio retention and can delete retained audio manually. AI output can be wrong, so every call plan must be reviewed.",
  usesTitle: "Supported everyday tasks",
  uses: ["Request information", "Arrange an appointment", "Check a document or status", "Deliver a neutral message"],
  limitsTitle: "Not supported",
  limits: ["Emergencies", "Harassment or deception", "Spam, bulk marketing, or political persuasion", "High-stakes legal, medical, or financial negotiation"],
  languagesTitle: "Website and call language are separate",
  languagesText: "Use the website in English or German, then choose the appropriate supported language for each call. A controlled fallback language is optional.",
  finalTitle: "Prepare your first supervised call.",
  finalText: "Create an account with your real first and last name, verify your mobile number, and receive three beta call credits."
} as const;

type PublicMessages = {
  [Key in keyof typeof en]: Key extends "steps"
    ? ReadonlyArray<{ title: string; text: string }>
    : Key extends "badges" | "uses" | "limits"
      ? readonly string[]
      : string;
};

const de: PublicMessages = {
  eyebrow: "Barrierefreie Telefonassistenz",
  title: "Ihr Anruf. Ihr Anliegen. Ein KI-Assistent, der für Sie spricht.",
  lead: "CallAssist hilft Menschen mit Sprachbeeinträchtigung oder lokaler Sprachbarriere, alltägliche Telefonanrufe vorzubereiten, zu prüfen und zu begleiten.",
  tryBeta: "Beta testen",
  signIn: "Anmelden",
  badges: ["Kostenlose öffentliche Beta", "3 Anrufe inklusive", "Nur Schweiz"],
  howEyebrow: "So funktioniert es",
  howTitle: "Vom Auftrag bis zum Ergebnis behalten Sie die Kontrolle.",
  steps: [
    { title: "Beschreiben", text: "Empfänger, Ziel, Sprache und freigegebene Fakten festlegen." },
    { title: "Prüfen", text: "CallAssist erstellt einen begrenzten Plan, den Sie prüfen und ausdrücklich genehmigen." },
    { title: "Anrufen", text: "Der Assistent stellt sich vor und wartet vor Verarbeitung oder Aufnahme auf die Einwilligung." },
    { title: "Ergebnis", text: "Anruf live verfolgen, jederzeit stoppen und Ergebnis sowie Transkript prüfen." }
  ],
  safetyEyebrow: "Für eine begrenzte Beta konzipiert",
  safetyTitle: "Klare Grenzen vor jedem Anruf.",
  safetyText: "Die Aufnahme startet erst nach der Einwilligung. Sie wählen 0, 7 oder 30 Tage Audioaufbewahrung und können gespeicherte Aufnahmen manuell löschen. KI kann Fehler machen, deshalb muss jeder Anrufplan geprüft werden.",
  usesTitle: "Unterstützte Alltagsaufgaben",
  uses: ["Informationen anfragen", "Termin vereinbaren", "Dokument oder Status klären", "Neutrale Nachricht übermitteln"],
  limitsTitle: "Nicht unterstützt",
  limits: ["Notfälle", "Belästigung oder Täuschung", "Spam, Massenwerbung oder politische Überzeugungsarbeit", "Rechtliche, medizinische oder finanzielle Verhandlungen mit hohem Risiko"],
  languagesTitle: "Website- und Anrufsprache sind getrennt",
  languagesText: "Nutzen Sie die Website auf Deutsch oder Englisch und wählen Sie für jeden Anruf eine passende unterstützte Sprache. Eine kontrollierte Ausweichsprache ist optional.",
  finalTitle: "Bereiten Sie den ersten begleiteten Anruf vor.",
  finalText: "Erstellen Sie ein Konto mit Ihrem echten Vor- und Nachnamen, bestätigen Sie Ihre Mobilnummer und erhalten Sie drei Beta-Anrufguthaben."
};

export const publicMessages: Record<UiLocale, PublicMessages> = { en, de };
