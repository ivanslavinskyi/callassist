import type { AssistanceReason, CallLocale, CallVoiceGender, ApprovedExecutionSnapshot } from "./call-brief";

export const INITIAL_DISCLOSURE_VERSION = "assistance-inline-v1" as const;
export const LEGACY_INITIAL_DISCLOSURE_VERSION = "assistance-inline-legacy-v1" as const;
export type InitialDisclosure = { version: typeof INITIAL_DISCLOSURE_VERSION | typeof LEGACY_INITIAL_DISCLOSURE_VERSION;
  text: string; assistanceReason: AssistanceReason | null };

type Wording = { identity: (name: string, female: boolean, reason: string) => string;
  reasons: Record<AssistanceReason, string>; question: string };
const de: Wording = {
  identity: (name, female, reason) => `Guten Tag, ich bin ${female ? "eine KI-Assistentin" : "ein KI-Assistent"} und rufe${reason ? ` ${reason}` : ""} im Auftrag von ${name} an.`,
  reasons: { none: "", speech_impairment: "wegen einer Sprechbeeinträchtigung", language_barrier: "wegen einer Sprachbarriere" },
  question: "Darf ich das Gespräch aufnehmen und automatisch transkribieren?"
};
const en: Wording = {
  identity: (name, _female, reason) => `Hello, I’m an AI assistant calling on behalf of ${name}${reason ? ` ${reason}` : ""}.`,
  reasons: { none: "", speech_impairment: "because of a speech impairment", language_barrier: "because of a language barrier" },
  question: "May I record and automatically transcribe this call?"
};
const wording: Record<CallLocale, Wording> = {
  "de-CH": de, "de-DE": de, "en-GB": en, "en-US": en,
  "ru-RU": { identity: (name, _female, reason) => `Здравствуйте, я ИИ-ассистент, звоню от имени ${name}${reason ? ` ${reason}` : ""}.`,
    reasons: { none: "", speech_impairment: "из-за нарушений речи", language_barrier: "из-за языкового барьера" },
    question: "Разрешаете запись и автоматическую расшифровку разговора?" },
  "fr-CH": { identity: (name, female, reason) => `Bonjour, je suis ${female ? "une assistante IA" : "un assistant IA"} et j’appelle au nom de ${name}${reason ? ` ${reason}` : ""}.`,
    reasons: { none: "", speech_impairment: "en raison de difficultés d’élocution", language_barrier: "en raison d’une barrière linguistique" },
    question: "Puis-je enregistrer et transcrire automatiquement cet appel ?" },
  "it-CH": { identity: (name, female, reason) => `Buongiorno, sono ${female ? "un’assistente IA" : "un assistente IA"} e chiamo per conto di ${name}${reason ? ` ${reason}` : ""}.`,
    reasons: { none: "", speech_impairment: "a causa di difficoltà nel parlare", language_barrier: "a causa di una barriera linguistica" },
    question: "Posso registrare e trascrivere automaticamente questa chiamata?" }
};

export function buildInitialDisclosure(locale: CallLocale, representedPerson: string, voiceGender: CallVoiceGender,
  assistanceReason: AssistanceReason): InitialDisclosure & { version: typeof INITIAL_DISCLOSURE_VERSION; assistanceReason: AssistanceReason } {
  const copy = wording[locale];
  if (!representedPerson.trim() || !copy || !(assistanceReason in copy.reasons)) throw new Error("INVALID_INITIAL_DISCLOSURE_INPUT");
  return { version: INITIAL_DISCLOSURE_VERSION, assistanceReason,
    text: `${copy.identity(representedPerson.trim(), voiceGender === "female", copy.reasons[assistanceReason])} ${copy.question}` };
}

/** Historical approved text is data: never infer a reason or rewrite an approval. */
export function resolveInitialDisclosure(snapshot: ApprovedExecutionSnapshot, approvedFullName: string): InitialDisclosure {
  if (snapshot.runtime.initialDisclosure) return snapshot.runtime.initialDisclosure;
  const copy = wording[snapshot.plan.callLocale];
  if (!approvedFullName.trim()) throw new Error("INVALID_INITIAL_DISCLOSURE_INPUT");
  return { version: LEGACY_INITIAL_DISCLOSURE_VERSION, assistanceReason: null,
    text: [copy.identity(approvedFullName.trim(), snapshot.runtime.voiceGender === "female", ""),
      snapshot.runtime.assistanceDisclosure, copy.question].filter(Boolean).join(" ") };
}

export function initialDisclosureProjection(attempt: { id: string; executionSnapshot: ApprovedExecutionSnapshot | null } | null | undefined) {
  const script = attempt?.executionSnapshot?.runtime.initialDisclosure;
  return attempt && script ? { callAttemptId: attempt.id, version: script.version,
    locale: attempt.executionSnapshot!.plan.callLocale, text: script.text } : null;
}
