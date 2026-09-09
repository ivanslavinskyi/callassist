import { originalPlanReview } from "../test-helpers/original-plan-review";
import { randomUUID } from "node:crypto";
import { expect, vi } from "vitest";
import { CallService } from "../call-service";
import type { CallRepository } from "../storage/call-repository";
import type { TelephonyProvider } from "../telephony/telephony-provider";

export async function verifyAgentHangupRecovery(repository: CallRepository, reopen: () => CallRepository) {
  const providerId = `CA-recovery-${randomUUID()}`;
  let providerStatus: "in-progress" | "completed" = "in-progress";
  const stopCall = vi.fn(async () => {
    providerStatus = "completed";
    throw new Error("Provider ended the call but the REST response was lost");
  });
  const provider: TelephonyProvider = {
    mode: "twilio",
    startCall: async () => ({ providerCallId: providerId, providerStatus }),
    stopCall,
    getCallStatus: vi.fn(async () => ({ providerCallId: providerId, status: providerStatus, durationSeconds: 12 })),
    startRecording: async () => { throw new Error("unused"); },
    getRecordingMedia: async () => { throw new Error("unused"); },
    deleteRecording: async () => {}
  };
  const before = new CallService(repository, provider, () => undefined, undefined, undefined, undefined, undefined,
    { durableWorkerEnabled: false, liveEventMode: "disabled" });
  let after: CallService | undefined;
  vi.useFakeTimers({ toFake: ["Date"] });
  const now = Date.now();
  try {
    const brief = await before.create({ recipientName: "Hangup recovery office", phoneNumber: "+41710000008",
      objective: "Ask for opening hours and record the answer", assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina", representedPersonLastName: "Keller", locale: "en-GB",
      allowLanguageSwitch: false, allowedFacts: [] });
    await before.approveCompilation(brief.id, await originalPlanReview(before, brief.id));
    const { attempt } = await repository.startAttempt(brief.id, { provider: "twilio" });
    await repository.attachProviderCall(attempt.id, providerId, "in-progress", new Date(now + 900_000).toISOString());
    await before.recordTelemetry(brief.id, {
      callAttemptId: attempt.id, idempotencyKey: "r21:hangup:requested",
      payload: { name: "conversation.hangup", metadata: { phase: "requested", reason: "objective_resolved", generation: 1 } }
    });
    expect(await before.prepareAgentHangup(brief.id, randomUUID(), providerId)).toBe(false);
    expect(await before.prepareAgentHangup(brief.id, attempt.id, "CA-other")).toBe(false);
    await Promise.all([before.prepareAgentHangup(brief.id, attempt.id, providerId), before.prepareAgentHangup(brief.id, attempt.id, providerId)]);
    const jobs = (await repository.listDurableJobs()).filter(job => job.callAttemptId === attempt.id && job.type === "provider_call_reconciliation");
    expect(jobs).toHaveLength(1);
    expect(new Date(jobs[0]!.runAfter).getTime()).toBe(now + 2_000);
    await before.close();
    vi.setSystemTime(now + 3_000);
    after = new CallService(reopen(), provider, () => undefined, undefined, undefined, undefined, undefined,
      { liveEventMode: "disabled" });
    await after.initialize();
    await vi.waitFor(() => expect(stopCall).toHaveBeenCalledWith(providerId), { timeout: 3_000 });
    await vi.waitFor(async () => {
      const job = (await after!.repository.listDurableJobs()).find(job => job.id === jobs[0]!.id);
      expect(job?.status).toBe("queued");
      expect(job?.attemptCount).toBe(1);
    }, { timeout: 3_000 });
    vi.setSystemTime(now + 10_000);
    await vi.waitFor(async () => expect((await after!.get(brief.id))?.brief.status).toBe("completed"), { timeout: 3_000 });
    expect(stopCall).toHaveBeenCalledTimes(1); // Retry fetched the terminal state instead of hanging up again.
    expect((await after.listTelemetry(brief.id)).some(event => event.payload.name === "conversation.hangup")).toBe(true);
    expect(await after.prepareAgentHangup(brief.id, attempt.id, providerId)).toBe(false);
    await after.handleTwilioStatus(providerId, "completed", brief.id, undefined, { durationSeconds: 12 });
    expect((await after.get(brief.id))?.brief.status).toBe("completed");
  } finally {
    await (after ?? before).close();
    vi.useRealTimers();
  }
}
