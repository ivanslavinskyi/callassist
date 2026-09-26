import { createHash } from "node:crypto";
import type { AnsweringState } from "@callassist/contracts";
import type { CallAttemptRecord, TelephonyProviderOperationRecord } from "../storage/call-repository";

/** Stable identities; recorded atomically with the decision before returning TwiML. */
export function answeringUsage(attempt: CallAttemptRecord, state: AnsweringState): TelephonyProviderOperationRecord[] {
  if (state.phase === "pending" || attempt.executionSnapshot?.version !== 3) return [];
  const kinds = state.message === "issued" ? ["answering_detection", "voicemail_tts"] as const : ["answering_detection"] as const;
  return kinds.map(operationType => {
    const amd = operationType === "answering_detection";
    const hash = createHash("sha256").update(`${attempt.id}:${operationType}`).digest("hex");
    const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
    const model = amd ? "twilio-amd-v1" : `polly-standard-voicemail-v1:${attempt.executionSnapshot!.plan.callLocale}`;
    const characters = amd ? null : [...(attempt.executionSnapshot!.version === 3 ? attempt.executionSnapshot!.answering.message ?? "" : "")].length;
    return {
      id, callBriefId: attempt.callBriefId, callAttemptId: attempt.id, provider: "twilio", operationType,
      stage: amd ? `answer.${state.answeredBy ?? state.failure}` : "neutral_message_issued",
      requestedModel: model, clientRequestId: id, startedAt: state.observedAt,
      result: {
        outcome: state.failure ? "invalid_response" : "succeeded", providerRequestId: null,
        providerResponseId: `${operationType}:${attempt.id}`, providerModel: model, statusCode: null,
        completedAt: state.observedAt, durationMs: amd ? state.durationMs ?? 0 : 0,
        errorCode: state.failure ? "ANSWER_DETECTION_FAILED" : null,
        usage: state.failure ? null : {
          requestCount: 1, inputTextTokens: null, cachedInputTextTokens: null, cacheWriteInputTextTokens: null,
          outputTextTokens: null, reasoningOutputTokens: null, totalTokens: null,
          rawUsage: { answered_by: state.answeredBy, characters, policy_version: state.policyVersion,
            basis: amd ? "provider_detection_callback" : "twiml_issued_not_delivery_confirmation" }
        }
      }
    };
  });
}
