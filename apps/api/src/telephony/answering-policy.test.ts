import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import twilio from "twilio";
import { approvedExecutionSnapshotSchema, canRepeatUnansweredCall } from "@callassist/contracts";
import { CallService } from "../call-service";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { buildWebhookApp } from "../app";
import { TwilioTelephonyProvider } from "./twilio-telephony-provider";

const services: CallService[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.close(); vi.useRealTimers(); });
async function fixture(action: "hang_up" | "leave_neutral_message" = "hang_up") {
  const repository = new InMemoryCallRepository();
  const service = new CallService(repository, undefined, undefined, undefined, undefined, undefined, undefined, { durableWorkerEnabled: false });
  services.push(service);
  const brief = await service.create({ recipientName: "Test Office", phoneNumber: "+41523686688", objective: "Ask when the office opens tomorrow",
    assistantProfileId: "sebastian", representedPersonFirstName: "Test", representedPersonLastName: "Owner", locale: "en-GB", allowedFacts: [],
    voicemailPolicy: action === "hang_up" ? "do_not_leave_details" : "leave_neutral_message" });
  await repository.approveCompilation(brief.id, await originalPlanReview(repository, brief.id));
  const { attempt } = await repository.startAttempt(brief.id, { provider: "twilio" });
  const providerCallId = `CA${randomUUID().replaceAll("-", "")}`;
  const input = { attemptId: attempt.id, providerCallId, snapshotHash: attempt.compilationSnapshotHash!, now: new Date().toISOString() };
  const transition = (answer: string) => repository.transitionAnswering(brief.id, { ...input, kind: "resolve", answeredBy: answer, durationMs: 4_000 });
  return { repository, service, brief, attempt, input, transition };
}

describe("answering policy and repository admission", () => {
  it.each(["busy", "no-answer"] as const)("keeps repeat available for %s before AMD runs", async providerStatus => {
    const f = await fixture();
    await f.repository.transitionAnswering(f.brief.id, { ...f.input, kind: "bind" });
    await f.repository.applyProviderStatus(f.input.providerCallId, providerStatus, "failed", f.brief.id);
    expect((await f.service.repeatUnansweredCall(f.brief.id, null)).status).toBe("review_required");
    expect(f.repository.providerOperationsForTest()).toEqual([]);
  });
  it("recovers a missing AMD callback through a durable job after restart", async () => {
    const f = await fixture();
    await f.repository.attachProviderCall(f.attempt.id, f.input.providerCallId, "in-progress");
    const now = Date.now();
    await f.repository.enqueueDurableJob({ type: "answer_detection_timeout", callAttemptId: f.attempt.id,
      runAfter: new Date(now + 80_000).toISOString(), maxAttempts: 5 });
    let status = "in-progress" as "in-progress" | "completed";
    const stopCall = vi.fn(async () => { status = "completed"; });
    const after = new CallService(f.repository, { mode: "twilio", stopCall,
      startCall: async () => { throw new Error("Unexpected new call"); },
      getCallStatus: async () => ({ providerCallId: f.input.providerCallId, status }),
      startRecording: async () => { throw new Error("Unexpected recording"); },
      getRecordingMedia: async () => { throw new Error("Unexpected recording"); }, deleteRecording: async () => {}
    }, () => undefined);
    services.push(after);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now + 81_000);
    await after.initialize();
    await vi.waitFor(() => expect(stopCall).toHaveBeenCalledOnce());
    expect((await f.repository.get(f.brief.id))?.brief.lifecycle?.answering).toMatchObject({ failure: "timeout", decision: "hang_up" });
    vi.setSystemTime(now + 90_000);
    await vi.waitFor(async () => expect((await f.repository.get(f.brief.id))?.brief.status).toBe("completed"));
    expect(stopCall).toHaveBeenCalledOnce();
    expect((await f.transition("human")).applied).toBe(false);
  });
  it.each([
    ["hang_up", "human", "consent", null], ["hang_up", "machine_start", "hang_up", "automated_answer"],
    ["leave_neutral_message", "machine_end_beep", "message", "voicemail_detected"],
    ["leave_neutral_message", "machine_end_silence", "hang_up", "voicemail_detected"],
    ["leave_neutral_message", "machine_end_other", "hang_up", "automated_answer"],
    ["hang_up", "fax", "hang_up", "fax_detected"], ["hang_up", "unknown", "hang_up", "answer_unknown"],
    ["hang_up", "machine_end_beep", "hang_up", "answer_detection_failed"], ["hang_up", "bad", "hang_up", "answer_detection_failed"]
  ] as const)("%s / %s -> %s", async (action, answer, decision, result) => {
    const f = await fixture(action);
    const resolved = await f.transition(answer);
    expect(resolved).toMatchObject({ applied: true, decision });
    const admitted = await f.repository.transitionAnswering(f.brief.id, { ...f.input, kind: "admit" });
    expect(admitted.applied).toBe(decision === "consent");
    await f.repository.applyProviderStatus(f.input.providerCallId, "completed", "completed", f.brief.id);
    const snapshot = (await f.repository.get(f.brief.id))!;
    expect(snapshot.brief.lifecycle?.result).toBe(result ?? "consent_not_received");
    expect(snapshot.recording).toBeNull();
    expect(snapshot.transcript).toEqual([]);
    if (result) {
      expect(snapshot.brief.lifecycle?.consent).toBe("not_requested");
      expect(canRepeatUnansweredCall(snapshot.brief)).toBe(true);
      const repeated = await f.service.repeatUnansweredCall(f.brief.id, null);
      expect(repeated.status).toBe("review_required");
      expect(await f.repository.getLatestAttempt(repeated.id)).toBeNull();
    }
  });

  it("claims playback once under concurrent callbacks and confirms only through the completion callback", async () => {
    const f = await fixture("leave_neutral_message");
    const results = await Promise.all([f.transition("machine_end_beep"), f.transition("machine_end_beep")]);
    expect(results.filter(r => r.applied)).toHaveLength(1);
    expect((await f.repository.get(f.brief.id))?.brief.lifecycle?.answering?.message).toBe("issued");
    await f.repository.applyProviderStatus(f.input.providerCallId, "completed", "completed", f.brief.id);
    expect((await f.repository.get(f.brief.id))?.brief.lifecycle?.answering?.message).toBe("unknown");
    expect(await f.repository.transitionAnswering(f.brief.id, { ...f.input, kind: "complete" })).toMatchObject({ applied: true, decision: "hang_up" });
    expect((await f.repository.get(f.brief.id))?.brief.lifecycle?.answering?.message).toBe("playback_completed");
    expect((await f.transition("machine_end_beep")).applied).toBe(false);
    expect((await f.repository.listCallTelemetryEvents(f.brief.id)).filter(e => e.payload.name === "answering.updated")).toHaveLength(2);
  });

  it("rejects wrong SID/hash, a stopped call, unsolicited playback completion and duplicate streams", async () => {
    const f = await fixture();
    expect((await f.repository.transitionAnswering(f.brief.id, { ...f.input, kind: "complete" })).applied).toBe(false);
    expect((await f.repository.transitionAnswering(f.brief.id, { ...f.input, snapshotHash: "f".repeat(64), kind: "resolve", answeredBy: "human" })).applied).toBe(false);
    await f.transition("human");
    expect((await f.repository.transitionAnswering(f.brief.id, { ...f.input, providerCallId: "CAwrong", kind: "admit" })).applied).toBe(false);
    expect((await f.repository.transitionAnswering(f.brief.id, { ...f.input, kind: "admit" })).applied).toBe(true);
    expect((await f.repository.transitionAnswering(f.brief.id, { ...f.input, kind: "admit" })).applied).toBe(false);
    await f.repository.appendCallTelemetryEvent(f.brief.id, { callAttemptId: f.attempt.id, idempotencyKey: "stop", payload: { name: "call.stop", metadata: { actor: "user", phase: "requested" } } });
    expect((await f.transition("human")).applied).toBe(false);
  });

  it("revokes an unused human admission at its durable deadline and rejects late streams", async () => {
    const f = await fixture();
    await f.transition("human");
    const timeout = await f.repository.transitionAnswering(f.brief.id, { ...f.input, kind: "timeout" });
    expect(timeout).toMatchObject({ applied: true, decision: "hang_up", state: { failure: "timeout" } });
    expect((await f.repository.transitionAnswering(f.brief.id, { ...f.input, kind: "admit" })).applied).toBe(false);
  });

  it("rejects a stop racing the first speech claim", async () => {
    const f = await fixture("leave_neutral_message");
    await f.repository.appendCallTelemetryEvent(f.brief.id, { callAttemptId: f.attempt.id,
      idempotencyKey: "stop-before-answer", payload: { name: "call.stop", metadata: { actor: "user", phase: "requested" } } });
    expect((await f.transition("machine_end_beep")).applied).toBe(false);
    expect(f.repository.providerOperationsForTest()).toEqual([]);
  });

  it("rejects changes to the immutable approved neutral message", async () => {
    const f = await fixture("leave_neutral_message");
    expect(approvedExecutionSnapshotSchema.safeParse({ ...f.attempt.executionSnapshot, answering: {
      policyVersion: "twilio-sync-beep-v1", action: "leave_neutral_message", message: "Private task details"
    } }).success).toBe(false);
  });
});

describe("signed Twilio AMD webhook", () => {
  it.each(["human", "machine_end_beep", "machine_end_silence", "unknown"])("routes %s without model decisions", async answer => {
    const f = await fixture("leave_neutral_message");
    const provider = new TwilioTelephonyProvider({ accountSid: "ACtest", authToken: "test-key", fromNumber: "+41710000001", publicBaseUrl: "https://voice.example.test" });
    const app = buildWebhookApp({ service: f.service, twilioProvider: provider, realtimeBridge: { handleTwilioSocket: socket => socket.close() }, logger: false });
    try {
      const query = new URLSearchParams({ callBriefId: f.brief.id, callAttemptId: f.attempt.id, compilationSnapshotHash: f.input.snapshotHash });
      const path = `/webhooks/twilio/voice?${query}`;
      const body = { CallSid: f.input.providerCallId, AnsweredBy: answer, MachineDetectionDuration: "4500" };
      const request = () => app.inject({ method: "POST", url: path, headers: { "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": twilio.getExpectedTwilioSignature("test-key", `https://voice.example.test${path}`, body) }, payload: new URLSearchParams(body).toString() });
      const response = await request();
      expect(response.statusCode).toBe(200);
      expect(response.body.includes("<Connect>")).toBe(answer === "human");
      expect(response.body.includes("<Say ")).toBe(answer === "machine_end_beep");
      expect(response.body).not.toContain("Test Owner");
      expect(response.body).not.toContain("office opens");
      if (answer === "machine_end_beep") expect(response.body).toContain("/webhooks/twilio/voicemail-complete?");
      expect((await request()).body).toContain("<Hangup/>");
      expect((await f.repository.get(f.brief.id))?.recording).toBeNull();
    } finally { await app.close(); }
  });
});
