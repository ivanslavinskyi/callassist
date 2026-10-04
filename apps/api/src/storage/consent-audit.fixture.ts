import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { ConsentDecisionInput, ConsentEvidence } from "@callassist/contracts";
import { CallService } from "../call-service";
import type { TelephonyProvider } from "../telephony/telephony-provider";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import type { CallRepository } from "./call-repository";

export function consentAuditCases(makeRepository: () => CallRepository) {
  const services: CallService[] = [];
  afterEach(async () => { for (const service of services.splice(0)) await service.close(); });
  async function fixture(recordDisclosure = true) {
    const repository = makeRepository();
    const recording = vi.fn(async () => ({ providerRecordingId: `RE-${randomUUID()}`, providerStatus: "in-progress" }));
    const provider: TelephonyProvider = { mode: "twilio", startCall: async () => ({ providerCallId: null, providerStatus: "queued" }),
      stopCall: async () => {}, startRecording: recording, getRecordingMedia: async () => { throw new Error("unused"); }, deleteRecording: async () => {} };
    const service = new CallService(repository, provider, () => {}, undefined, undefined, undefined, undefined, { durableWorkerEnabled: false });
    services.push(service);
    const brief = await service.create({ recipientName: "Office", phoneNumber: "+41710000001", objective: "Ask when the office opens",
      assistantProfileId: "anna", representedPersonFirstName: "Nina", representedPersonLastName: "Keller", locale: "en-GB", allowedFacts: [] });
    await repository.approveCompilation(brief.id, await originalPlanReview(repository, brief.id));
    const { attempt } = await repository.startAttempt(brief.id, { provider: "twilio" });
    const providerCallId = `CA-${randomUUID()}`;
    await repository.attachProviderCall(attempt.id, providerCallId, "in-progress");
    const now = new Date().toISOString();
    const disclosure = { callAttemptId: attempt.id, compilationSnapshotHash: attempt.compilationSnapshotHash!,
      generation: 1, version: "assistance-inline-v1", textHash: "a".repeat(64), markId: "required:1", sessionId: "test-live",
      sentAt: now, acknowledgedAt: now, durationMs: 100 };
    const receiptId = recordDisclosure ? await service.recordConsentDisclosure(brief.id, disclosure) : randomUUID();
    const decision: ConsentDecisionInput = { callAttemptId: attempt.id, disclosureReceiptId: receiptId, revision: 1,
      decision: "affirmative", decisionMethod: "deterministic_voice", locale: "en-GB", policyVersion: "consent-phrases-v1" };
    const evidence: ConsentEvidence = { method: "voice", decision: "affirmative", locale: "en-GB", decisionMethod: "deterministic_voice",
      callAttemptId: attempt.id, disclosureReceiptId: receiptId, consentDecision: decision };
    return { repository, service, brief, attempt, recording, disclosure, receiptId, decision, evidence, providerCallId };
  }
  it("commits one linked decision and request before exactly one provider side effect", async () => {
    const f = await fixture();
    f.recording.mockImplementation(async () => {
      const events = await f.repository.listCallTelemetryEvents(f.brief.id);
      expect(events.map(e => e.payload.name).slice(-4)).toEqual(["disclosure.completed", "consent.decision", "consent.granted", "recording.requested"]);
      expect((await f.repository.get(f.brief.id))!.recording?.status).toBe("starting");
      return { providerRecordingId: "RE-atomic", providerStatus: "in-progress" };
    });
    const results = await Promise.allSettled([f.service.startRecordingAfterConsent(f.brief.id, f.evidence), f.service.startRecordingAfterConsent(f.brief.id, f.evidence)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(f.recording).toHaveBeenCalledOnce();
    const events = await f.repository.listCallTelemetryEvents(f.brief.id);
    const decision = events.find(e => e.payload.name === "consent.decision")!;
    const requested = events.find(e => e.payload.name === "recording.requested")!;
    expect(requested.payload.metadata).toMatchObject({ decisionId: decision.id, disclosureReceiptId: f.receiptId });
    expect(Date.parse(requested.occurredAt)).toBeGreaterThanOrEqual(Date.parse(decision.occurredAt));
    expect(events.find(e => e.payload.name === "recording.started")?.payload.metadata).toMatchObject({ providerRecordingId: "RE-atomic" });
    expect(JSON.stringify(events)).not.toMatch(/Nina|Keller|recipientAnswer|consentDecision/);
  });
  it("rejects wrong attempts, missing receipts, and negative decisions without a provider request", async () => {
    const f = await fixture();
    await expect(f.service.startRecordingAfterConsent(f.brief.id)).rejects.toThrow();
    await expect(f.service.startRecordingAfterConsent(f.brief.id, { method: "voice", decision: "affirmative", locale: "en-GB" })).rejects.toThrow();
    await expect(f.service.startRecordingAfterConsent(f.brief.id, { ...f.evidence, callAttemptId: randomUUID() })).rejects.toThrow();
    await expect(f.service.startRecordingAfterConsent(f.brief.id, { ...f.evidence, disclosureReceiptId: randomUUID() })).rejects.toThrow();
    const decisionId = await f.service.recordConsentDecision(f.brief.id, { ...f.decision, decision: "negative" });
    const { consentDecision: _embedded, ...binding } = f.evidence;
    await expect(f.service.startRecordingAfterConsent(f.brief.id, { ...binding, decisionId })).rejects.toThrow();
    expect(f.recording).not.toHaveBeenCalled(); expect((await f.repository.get(f.brief.id))!.recording).toBeNull();
    expect((await f.repository.listCallTelemetryEvents(f.brief.id)).some(e => e.payload.name === "recording.requested")).toBe(false);
  });
  it("requires complete consent evidence for a new unified descriptor even before a playback receipt exists", async () => {
    const f = await fixture(false);
    await f.repository.recordRuntimeDescriptor(f.brief.id, f.attempt.id, { version: 1, runtime: "unified_live", runtimeVersion: "test",
      releaseSha: null, compilerVersion: "test", policyVersion: "test", promptHash: "b".repeat(64), compilationHash: f.attempt.compilationSnapshotHash!,
      models: { live: "test", delegation: "test", speech: "test" }, voice: "marin", callLocale: "en-GB", disclosureVersion: "assistance-inline-v1",
      consentPolicy: await f.repository.getConsentRuntimePolicy(f.brief.id, f.attempt.id) });
    await expect(f.service.startRecordingAfterConsent(f.brief.id)).rejects.toThrow();
    await expect(f.service.startRecordingAfterConsent(f.brief.id, { method: "voice", decision: "affirmative", locale: "en-GB" })).rejects.toThrow();
    await expect(f.service.startRecordingAfterConsent(f.brief.id, f.evidence)).rejects.toThrow();
    expect(f.recording).not.toHaveBeenCalled(); expect((await f.repository.get(f.brief.id))!.recording).toBeNull();
  });
  it.each(["semantic_voice", "dtmf"] as const)("accepts %s after a durable unclear local decision without changing legacy method", async method => {
    const f = await fixture();
    await f.service.recordConsentDecision(f.brief.id, { ...f.decision, decision: "unclear" });
    const evidence: ConsentEvidence = { ...(method === "dtmf" ? { method: "dtmf" as const, digit: "1" as const } : { method: "voice" as const, decision: "affirmative" as const }),
      locale: "en-GB", callAttemptId: f.attempt.id, disclosureReceiptId: f.receiptId, decisionMethod: method,
      consentDecision: { ...f.decision, decisionMethod: method } };
    await f.service.startRecordingAfterConsent(f.brief.id, evidence);
    expect(f.recording).toHaveBeenCalledOnce();
    const event = (await f.repository.listCallTelemetryEvents(f.brief.id)).find(e => e.payload.name === "consent.granted")!;
    expect(event.payload.metadata).toMatchObject({ method: method === "dtmf" ? "dtmf" : "voice", decisionMethod: method });
  });
  it("deduplicates evidence, rejects conflicting replay, and prevents old receipts from granting after replay", async () => {
    const f = await fixture();
    expect(await f.service.recordConsentDisclosure(f.brief.id, f.disclosure)).toBe(f.receiptId);
    await expect(f.service.recordConsentDisclosure(f.brief.id, { ...f.disclosure, textHash: "b".repeat(64) })).rejects.toThrow();
    const unclear = { ...f.decision, decision: "unclear" as const };
    const id = await f.service.recordConsentDecision(f.brief.id, unclear);
    expect(await f.service.recordConsentDecision(f.brief.id, unclear)).toBe(id);
    await expect(f.service.recordConsentDecision(f.brief.id, f.decision)).rejects.toThrow();
    await f.service.recordConsentDisclosure(f.brief.id, { ...f.disclosure, generation: 2, markId: "required:2" });
    await expect(f.service.startRecordingAfterConsent(f.brief.id, f.evidence)).rejects.toThrow();
    expect(f.recording).not.toHaveBeenCalled();
  });
  it("blocks provider calls when admission persistence fails and preserves failed request evidence", async () => {
    const f = await fixture();
    const begin = vi.spyOn(f.repository, "beginRecording").mockRejectedValueOnce(new Error("audit unavailable"));
    await expect(f.service.startRecordingAfterConsent(f.brief.id, f.evidence)).rejects.toThrow("audit unavailable");
    expect(f.recording).not.toHaveBeenCalled(); begin.mockRestore();
    f.recording.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(f.service.startRecordingAfterConsent(f.brief.id, f.evidence)).rejects.toThrow("RECORDING_START_FAILED");
    expect((await f.repository.get(f.brief.id))!.recording?.status).toBe("failed");
    expect((await f.repository.listCallTelemetryEvents(f.brief.id)).filter(e => e.payload.name === "recording.requested")).toHaveLength(1);
    await expect(f.service.startRecordingAfterConsent(f.brief.id, f.evidence)).rejects.toThrow(); expect(f.recording).toHaveBeenCalledOnce();
  });
  it("accepts a signed provider callback before REST resolves without duplicating start or moving the boundary", async () => {
    const f = await fixture();
    const providerStartedAt = new Date().toISOString();
    f.recording.mockImplementation(async () => {
      const recordingId = (await f.repository.get(f.brief.id))!.recording!.id;
      await f.service.handleTwilioRecordingStatus({ callBriefId: f.brief.id, recordingId, providerCallId: f.providerCallId,
        providerRecordingId: "RE-callback", providerStatus: "in-progress", startedAt: providerStartedAt });
      await f.service.handleTwilioRecordingStatus({ callBriefId: f.brief.id, recordingId, providerCallId: f.providerCallId,
        providerRecordingId: "RE-callback", providerStatus: "completed", durationSeconds: 1 });
      return { providerRecordingId: "RE-callback", providerStatus: "in-progress" };
    });
    const result = await f.service.startRecordingAfterConsent(f.brief.id, f.evidence);
    expect(result.recording).toMatchObject({ status: "available", startedAt: providerStartedAt, providerRecordingId: "RE-callback" });
    const events = await f.repository.listCallTelemetryEvents(f.brief.id);
    expect(events.filter(e => e.payload.name === "recording.started")).toHaveLength(1);
    await expect(f.repository.attachProviderRecording(result.recording!.id, "RE-wrong", "in-progress")).rejects.toThrow();
    expect((await f.repository.get(f.brief.id))!.recording?.providerRecordingId).toBe("RE-callback");
  });
  it("keeps REST-observed recording admission fixed when an older provider timestamp arrives later", async () => {
    const f = await fixture(), result = await f.service.startRecordingAfterConsent(f.brief.id, f.evidence);
    const boundary = result.recording!.startedAt!;
    await f.service.handleTwilioRecordingStatus({ callBriefId: f.brief.id, recordingId: result.recording!.id, providerCallId: f.providerCallId,
      providerRecordingId: result.recording!.providerRecordingId!, providerStatus: "in-progress", startedAt: new Date(Date.parse(boundary) - 500).toISOString() });
    expect((await f.repository.get(f.brief.id))!.recording!.startedAt).toBe(boundary);
  });
  it("retains authoritative start evidence after a completed callback even if REST fails", async () => {
    const f = await fixture(), providerStartedAt = new Date().toISOString();
    f.recording.mockImplementation(async () => {
      const recordingId = (await f.repository.get(f.brief.id))!.recording!.id;
      const binding = { callBriefId: f.brief.id, recordingId, providerCallId: f.providerCallId, providerRecordingId: "RE-out-of-order" };
      await f.service.handleTwilioRecordingStatus({ ...binding, providerStatus: "completed", durationSeconds: 1 });
      await f.service.handleTwilioRecordingStatus({ ...binding, providerStatus: "in-progress", startedAt: providerStartedAt });
      throw new Error("REST response lost");
    });
    await expect(f.service.startRecordingAfterConsent(f.brief.id, f.evidence)).rejects.toThrow("RECORDING_START_FAILED");
    expect((await f.repository.get(f.brief.id))!.recording).toMatchObject({ status: "available", startedAt: providerStartedAt });
    const events = await f.repository.listCallTelemetryEvents(f.brief.id);
    expect(events.filter(e => e.payload.name === "recording.started")).toHaveLength(1);
    expect(events.find(e => e.payload.name === "recording.started")?.payload.metadata).toMatchObject({ providerRecordingId: "RE-out-of-order" });
  });
}
