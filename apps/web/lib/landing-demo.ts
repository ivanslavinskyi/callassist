import type { CallPlanPresentationData } from "@/components/call-plan-presentation";
import type { CallSummaryPayload } from "@callassist/contracts";
import type { UiLocale } from "./i18n/messages";

type LandingDemo = {
  educationalLabel: string;
  educationalNote: string;
  recipient: string;
  requestLabel: string;
  request: string;
  planLabel: string;
  questionsLabel: string;
  factsLabel: string;
  excerptLabel: string;
  excerptNote: string;
  outcomeLabel: string;
  outcome: string[];
  summary: CallSummaryPayload;
  plan: CallPlanPresentationData;
  excerpt: Array<{ speaker: string; text: string }>;
};

/** Fictional educational text, never a call/compilation record or provider input. */
export const landingDemo: Record<UiLocale, LandingDemo> = {
  en: {
    educationalLabel: "Illustrative example",
    educationalNote: "A fictional example of a call plan and conversation. No call is placed.",
    recipient: "Municipal office · residence form",
    requestLabel: "Your request",
    request: "Ask my municipal office whether my residence form arrived. If anything is missing, ask what I need to send. You may share my name, Anna Keller, and that I sent the form on 2 September.",
    planLabel: "The plan you review",
    questionsLabel: "Questions to ask",
    factsLabel: "Information you approve",
    excerptLabel: "Conversation excerpt",
    excerptNote: "An illustrative exchange after the recipient has agreed to recording and transcription.",
    outcomeLabel: "What you could learn",
    outcome: ["The form arrived.", "A copy of the passport is still missing.", "The municipal office says the copy can be submitted by email."],
    summary: {
      schemaVersion: 2,
      overview: [
        { label: "Form", text: "Received by the municipal office.", findingIds: ["goal"] },
        { label: "Missing document", text: "A copy of the passport.", findingIds: ["question.0"] }
      ],
      findings: [
        { id: "goal", label: "Form status", text: "The municipal office confirmed receipt.", certainty: "reported", sourceSegmentIds: ["demo-1"] },
        { id: "question.0", label: "Missing document", text: "A copy of the passport.", certainty: "reported", sourceSegmentIds: ["demo-1"] }
      ],
      nextSteps: [{ text: "The office says the missing copy can be submitted by email.", sourceSegmentIds: ["demo-3"] }],
      unresolved: ["The email address was not specified in this excerpt."]
    },
    plan: {
      localizedObjective: "Check whether Anna Keller’s residence form arrived and ask which documents, if any, are still needed.",
      successCriteria: ["Find out the status of the form and any missing documents."],
      tone: "neutral",
      addressingStyle: "formal",
      resultHandling: "capture_in_callassist",
      opening: {
        recipientAddress: "Hello.",
        purposeStatement: "I’m calling on behalf of Anna Keller about her residence form.",
        readinessQuestion: "Could you help me check whether it arrived?"
      },
      orderedQuestions: [
        { text: "Have you received Anna Keller’s residence form?", purpose: "Confirm receipt", required: true },
        { text: "Are any documents missing, and how should Anna send them?", purpose: "Clarify the next step", required: true }
      ],
      approvedFacts: [
        { sourceText: "Anna Keller", callLanguageText: "Name: Anna Keller" },
        { sourceText: "Form sent on 2 September", callLanguageText: "The form was sent on 2 September." }
      ],
      prohibitedActions: ["Do not provide other personal details or make commitments."]
    },
    excerpt: [
      { speaker: "Assistant", text: "Have you received Anna Keller’s residence form?" },
      { speaker: "Municipal office", text: "Yes, we have the form, but a copy of her passport is still missing." },
      { speaker: "Assistant", text: "How should she send the copy?" },
      { speaker: "Municipal office", text: "She can submit it by email." }
    ]
  },
  de: {
    educationalLabel: "Anschauliches Beispiel",
    educationalNote: "Ein fiktiver Anrufplan und Gesprächsverlauf zur Veranschaulichung. Es wird kein Anruf gestartet.",
    recipient: "Gemeinde · Aufenthaltsformular",
    requestLabel: "Ihre Anfrage",
    request: "Fragen Sie meine Gemeinde, ob mein Aufenthaltsformular angekommen ist. Falls etwas fehlt, fragen Sie, was ich noch senden muss. Sie dürfen meinen Namen Anna Keller nennen und sagen, dass ich das Formular am 2. September gesendet habe.",
    planLabel: "Der Plan zur Prüfung",
    questionsLabel: "Geplante Fragen",
    factsLabel: "Freigegebene Angaben",
    excerptLabel: "Gesprächsausschnitt",
    excerptNote: "Ein beispielhafter Austausch nach Zustimmung der angerufenen Person zur Aufnahme und Transkription.",
    outcomeLabel: "Was Sie erfahren könnten",
    outcome: ["Das Formular ist angekommen.", "Eine Passkopie fehlt noch.", "Die Gemeinde sagt, dass die Kopie per E-Mail eingereicht werden kann."],
    summary: {
      schemaVersion: 2,
      overview: [
        { label: "Formular", text: "Bei der Gemeinde eingegangen.", findingIds: ["goal"] },
        { label: "Fehlende Unterlage", text: "Eine Kopie des Passes.", findingIds: ["question.0"] }
      ],
      findings: [
        { id: "goal", label: "Stand des Formulars", text: "Die Gemeinde hat den Eingang bestätigt.", certainty: "reported", sourceSegmentIds: ["demo-1"] },
        { id: "question.0", label: "Fehlende Unterlage", text: "Eine Kopie des Passes.", certainty: "reported", sourceSegmentIds: ["demo-1"] }
      ],
      nextSteps: [{ text: "Laut Gemeinde kann die fehlende Kopie per E-Mail eingereicht werden.", sourceSegmentIds: ["demo-3"] }],
      unresolved: ["Die E-Mail-Adresse wurde in diesem Ausschnitt nicht genannt."]
    },
    plan: {
      localizedObjective: "Klären, ob Anna Kellers Aufenthaltsformular angekommen ist und ob noch Unterlagen fehlen.",
      successCriteria: ["Den Stand des Formulars und gegebenenfalls fehlende Unterlagen erfahren."],
      tone: "neutral",
      addressingStyle: "formal",
      resultHandling: "capture_in_callassist",
      opening: {
        recipientAddress: "Guten Tag.",
        purposeStatement: "Ich rufe im Auftrag von Anna Keller wegen ihres Aufenthaltsformulars an.",
        readinessQuestion: "Können Sie mir sagen, ob es angekommen ist?"
      },
      orderedQuestions: [
        { text: "Ist Anna Kellers Aufenthaltsformular bei Ihnen eingegangen?", purpose: "Eingang bestätigen", required: true },
        { text: "Fehlen noch Unterlagen, und wie soll Anna diese einreichen?", purpose: "Nächsten Schritt klären", required: true }
      ],
      approvedFacts: [
        { sourceText: "Anna Keller", callLanguageText: "Name: Anna Keller" },
        { sourceText: "Formular am 2. September gesendet", callLanguageText: "Das Formular wurde am 2. September gesendet." }
      ],
      prohibitedActions: ["Keine weiteren persönlichen Angaben weitergeben und keine verbindlichen Zusagen machen."]
    },
    excerpt: [
      { speaker: "Assistent", text: "Ist Anna Kellers Aufenthaltsformular bei Ihnen eingegangen?" },
      { speaker: "Gemeinde", text: "Ja, das Formular ist da. Eine Kopie ihres Passes fehlt noch." },
      { speaker: "Assistent", text: "Wie soll sie die Kopie einreichen?" },
      { speaker: "Gemeinde", text: "Sie kann sie per E-Mail einreichen." }
    ]
  }
};
