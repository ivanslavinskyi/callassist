import { createHash } from "node:crypto";
import { consentEvidenceSchema, type ConsentEvidence, type ConsentDisclosureInput, type ConsentDecisionInput, type DurableCallEvent } from "@callassist/contracts";
import { CallRepositoryError } from "./call-repository";

export function consentDecisionKey(input: ConsentDecisionInput) {
  return `consent:decision:${input.disclosureReceiptId}:${input.revision}:${input.decisionMethod}`;
}
export function consentDisclosureKey(input: ConsentDisclosureInput) {
  return `consent:disclosure:${createHash("sha256").update(JSON.stringify([input.callAttemptId, input.sessionId, input.generation])).digest("hex")}`;
}
export function requireConsentReceipt(events: DurableCallEvent[], attemptId: string, receiptId: string) {
  const receipt = events.findLast(event => event.callAttemptId === attemptId && event.payload.name === "disclosure.completed");
  if (!receipt || receipt.id !== receiptId) throw new CallRepositoryError("RECORDING_NOT_AVAILABLE");
  return receipt;
}
/** New audit bindings are complete; old voice/dtmf evidence remains readable. */
export function validateConsentGrant(input: ConsentEvidence | undefined, attemptId: string, events: DurableCallEvent[], requireBinding = false): ConsentEvidence | undefined {
  if (!input) {
    if (requireBinding) throw new CallRepositoryError("RECORDING_NOT_AVAILABLE");
    return undefined;
  }
  const evidence = consentEvidenceSchema.parse(input);
  const bound = evidence.callAttemptId || evidence.disclosureReceiptId || evidence.decisionId || evidence.consentDecision || evidence.decisionMethod;
  if (!bound) {
    if (requireBinding) throw new CallRepositoryError("RECORDING_NOT_AVAILABLE");
    return evidence;
  }
  if (evidence.callAttemptId !== attemptId || !evidence.disclosureReceiptId || !evidence.decisionMethod || !evidence.decisionId)
    throw new CallRepositoryError("RECORDING_NOT_AVAILABLE");
  requireConsentReceipt(events, attemptId, evidence.disclosureReceiptId);
  const decision = events.findLast(event => event.callAttemptId === attemptId && event.payload.name === "consent.decision");
  if (!decision || decision.id !== evidence.decisionId || decision.payload.name !== "consent.decision")
    throw new CallRepositoryError("RECORDING_NOT_AVAILABLE");
  const metadata = decision.payload.metadata;
  if (metadata.decision !== "affirmative" || metadata.disclosureReceiptId !== evidence.disclosureReceiptId ||
      metadata.decisionMethod !== evidence.decisionMethod || metadata.locale !== evidence.locale ||
      (evidence.method === "dtmf") !== (metadata.decisionMethod === "dtmf"))
    throw new CallRepositoryError("RECORDING_NOT_AVAILABLE");
  const { consentDecision: _input, ...persisted } = evidence;
  return persisted;
}
