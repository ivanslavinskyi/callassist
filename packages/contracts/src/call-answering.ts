import { z } from "zod";
import type { CallLocale } from "./call-brief";

export const ANSWERING_POLICY_VERSION = "twilio-sync-beep-v1" as const;
export const answeredBySchema = z.enum(["human", "machine_start", "machine_end_beep", "machine_end_silence", "machine_end_other", "fax", "unknown"]);
export type AnsweredBy = z.infer<typeof answeredBySchema>;
export const answeringDecisionSchema = z.enum(["consent", "message", "hang_up"]);
export type AnsweringDecision = z.infer<typeof answeringDecisionSchema>;
export const answeringModeSchema = z.enum(["Enable", "DetectMessageEnd"]);

/** Deliberately contains no caller/recipient identity, task details or callback promise. */
export const neutralVoicemailText: Record<CallLocale, string> = {
  "de-CH": "Guten Tag. Hier hat ein KI-Assistent von SHPROHLI angerufen. Ein Gespräch war nicht möglich. Auf Wiederhören.",
  "de-DE": "Guten Tag. Hier hat ein KI-Assistent von SHPROHLI angerufen. Ein Gespräch war nicht möglich. Auf Wiederhören.",
  "fr-CH": "Bonjour. Un assistant IA de SHPROHLI a tenté de vous joindre. La conversation n’a pas pu avoir lieu. Au revoir.",
  "it-CH": "Buongiorno. Un assistente IA di SHPROHLI ha provato a contattarvi. Non è stato possibile parlare. Arrivederci.",
  "en-GB": "Hello. An AI assistant from SHPROHLI tried to reach you. A conversation was not possible. Goodbye.",
  "en-US": "Hello. An AI assistant from SHPROHLI tried to reach you. A conversation was not possible. Goodbye.",
  "ru-RU": "Здравствуйте. Вам звонил ИИ-ассистент SHPROHLI. Разговор не состоялся. До свидания."
};

export const answeringApprovalSchema = z.strictObject({
  policyVersion: z.literal(ANSWERING_POLICY_VERSION),
  action: z.enum(["hang_up", "leave_neutral_message"]),
  message: z.string().max(1000).nullable()
});
export type AnsweringApproval = z.infer<typeof answeringApprovalSchema>;
export function answeringApproval(action: AnsweringApproval["action"], locale: CallLocale): AnsweringApproval {
  return { policyVersion: ANSWERING_POLICY_VERSION, action, message: action === "leave_neutral_message" ? neutralVoicemailText[locale] : null };
}
export function answeringMode(action: AnsweringApproval["action"]) {
  return action === "hang_up" ? "Enable" as const : "DetectMessageEnd" as const;
}
export function decideAnswering(action: AnsweringApproval["action"], answer: AnsweredBy | null): AnsweringDecision {
  if (answer === "human") return "consent";
  if (answer === "machine_end_beep" && action === "leave_neutral_message") return "message";
  return "hang_up";
}

export const answeringStateSchema = z.strictObject({
  phase: z.enum(["pending", "resolved", "failed"]),
  policyVersion: z.literal(ANSWERING_POLICY_VERSION),
  mode: answeringModeSchema,
  answeredBy: answeredBySchema.nullable(),
  decision: answeringDecisionSchema.nullable(),
  streamAdmitted: z.boolean().default(false),
  observedAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative().max(120_000).nullable(),
  message: z.enum(["not_requested", "not_attempted", "issued", "playback_completed", "interrupted", "unknown"]),
  failure: z.enum(["invalid_result", "timeout", "provider_error"]).nullable()
});
export type AnsweringState = z.infer<typeof answeringStateSchema>;
export const answeringResultSchema = z.enum(["voicemail_detected", "automated_answer", "answer_unknown", "fax_detected", "answer_detection_failed"]);
export type AnsweringResult = z.infer<typeof answeringResultSchema>;
export function answeringResult(state: AnsweringState): AnsweringResult | null {
  if (state.phase === "failed") return "answer_detection_failed";
  if (state.phase !== "resolved" || state.answeredBy === "human") return null;
  if (state.answeredBy === "machine_end_beep" || state.answeredBy === "machine_end_silence") return "voicemail_detected";
  if (state.answeredBy === "machine_start" || state.answeredBy === "machine_end_other") return "automated_answer";
  return state.answeredBy === "fax" ? "fax_detected" : "answer_unknown";
}
