import { z } from "zod";

/** Immutable user-authored data approved with the plan; never system instructions. */
export const liveTaskSourcesSchema = z.strictObject({
  objective: z.string().max(4000),
  context: z.string().max(12000),
  allowedFacts: z.array(z.string().max(300)).max(40),
  clarificationAnswers: z.array(z.strictObject({ issueCode: z.string().max(100), answer: z.string().max(1000) })).max(10),
  deliveryInstruction: z.string().max(1000)
});
export type LiveTaskSources = z.infer<typeof liveTaskSourcesSchema>;

export const liveTaskAppendixSectionSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(400),
  content: z.string().min(1).max(4000)
});
export const liveTaskAppendixSchema = z.array(liveTaskAppendixSectionSchema).max(12).superRefine((sections, ctx) => {
  if (new Set(sections.map(section => section.id)).size !== sections.length)
    ctx.addIssue({ code: "custom", message: "Appendix section IDs must be unique" });
});
export type LiveTaskAppendixSection = z.infer<typeof liveTaskAppendixSectionSchema>;

export const NATIVE_OPENING_VERSION = "native-declarative-v1" as const;
export const nativeOpeningSchema = z.strictObject({
  version: z.literal(NATIVE_OPENING_VERSION),
  assistanceReason: z.enum(["none", "speech_impairment", "language_barrier"]),
  introduction: z.string().min(1).max(1500),
  recordingNotice: z.string().min(1).max(400),
  readinessQuestion: z.string().min(1).max(300),
  purposeExample: z.string().min(1).max(700)
});
export type NativeOpening = z.infer<typeof nativeOpeningSchema>;

/** Pure rendering: one approved source of opening copy for review and runtime. */
export function buildNativeOpening(input: {
  locale: string; representedPerson: string; assistantName: string;
  voiceGender: "male" | "female"; addressingStyle: "formal" | "informal";
  assistanceReason: NativeOpening["assistanceReason"]; purposeExample: string;
}): NativeOpening {
  const { representedPerson: person, assistantName: name, assistanceReason: reason } = input;
  const informal = input.addressingStyle === "informal", female = input.voiceGender === "female";
  const lang = input.locale.split("-")[0];
  const reasons: Record<string, Record<NativeOpening["assistanceReason"], string>> = {
    ru: { none: "", speech_impairment: " из-за нарушений речи", language_barrier: " из-за языкового барьера" },
    de: { none: "", speech_impairment: " wegen einer Sprechbeeinträchtigung", language_barrier: " wegen einer Sprachbarriere" },
    en: { none: "", speech_impairment: " because of a speech impairment", language_barrier: " because of a language barrier" },
    fr: { none: "", speech_impairment: " en raison de difficultés d’élocution", language_barrier: " en raison d’une barrière linguistique" },
    it: { none: "", speech_impairment: " a causa di difficoltà nel parlare", language_barrier: " a causa di una barriera linguistica" }
  };
  const why = reasons[lang]?.[reason];
  if (why === undefined) throw new Error("UNSUPPORTED_OPENING_LOCALE");
  const copy: Record<string, [string, string, string]> = {
    ru: [`Здравствуйте! Я ${name}, ИИ-ассистент. Звоню от имени ${person}${why}.`, "Разговор записывается и расшифровывается.", informal ? "Тебе удобно сейчас говорить?" : "Вам удобно сейчас говорить?"],
    de: [`Guten Tag, ich bin ${name}, ${female ? "eine KI-Assistentin" : "ein KI-Assistent"}. Ich rufe${why} im Auftrag von ${person} an.`, "Das Gespräch wird aufgezeichnet und transkribiert.", informal ? "Passt es dir gerade zu sprechen?" : "Passt es Ihnen gerade zu sprechen?"],
    en: [`Hello, I’m ${name}, an AI assistant calling on behalf of ${person}${why}.`, "This call is being recorded and transcribed.", "Is now a good time to talk?"],
    fr: [`Bonjour, je suis ${name}, ${female ? "une assistante IA" : "un assistant IA"}. J’appelle au nom de ${person}${why}.`, "Cet appel est enregistré et transcrit.", informal ? "Tu as un moment pour parler ?" : "Avez-vous un moment pour parler ?"],
    it: [`Buongiorno, sono ${name}, ${female ? "un’assistente IA" : "un assistente IA"}. Chiamo per conto di ${person}${why}.`, "La chiamata viene registrata e trascritta.", informal ? "Hai un momento per parlare?" : "Ha un momento per parlare?"]
  };
  const [introduction, recordingNotice, readinessQuestion] = copy[lang];
  return nativeOpeningSchema.parse({ version: NATIVE_OPENING_VERSION, assistanceReason: reason,
    introduction, recordingNotice, readinessQuestion, purposeExample: input.purposeExample });
}
