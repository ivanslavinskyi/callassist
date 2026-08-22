import { randomUUID } from "node:crypto";
import {
  normalizeCreateCallBriefInput,
  type CreateCallBriefInput
} from "@callassist/contracts";
import { describe, expect, it, vi } from "vitest";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { DurableJobExecutionError } from "./durable-job";
import { DurableJobWorker } from "./durable-job-worker";

const input: CreateCallBriefInput = {
  recipientName: "Durable worker test",
  phoneNumber: "+41710000064",
  objective: "Verify durable background processing",
  assistantProfileId: "sebastian",
  representedPersonFirstName: "Nina",
  representedPersonLastName: "Keller",
  assistanceReason: "speech_impairment",
  locale: "en-GB",
  allowLanguageSwitch: false,
  allowedFacts: []
};

async function repositoryWithAvailableRecording() {
  const repository = new InMemoryCallRepository();
  const compilation = await new DeterministicBriefCompiler().compile(
    normalizeCreateCallBriefInput(input)
  );
  const brief = await repository.create(input, compilation, randomUUID());
  await repository.approveCompilation(brief.id);
  const attempt = await repository.startAttempt(brief.id, {
    provider: "twilio"
  });
  const providerCallId = `CA-job-${brief.id}`;
  await repository.attachProviderCall(
    attempt.attempt.id,
    providerCallId,
    "in-progress"
  );
  const begun = await repository.beginRecording(brief.id);
  const providerRecordingId = `RE-job-${brief.id}`;
  await repository.attachProviderRecording(
    begun.recording.id,
    providerRecordingId,
    "in-progress"
  );
  await repository.applyRecordingStatus({
    callBriefId: brief.id,
    recordingId: begun.recording.id,
    providerCallId,
    providerRecordingId,
    providerStatus: "completed",
    durationSeconds: 30,
    channels: 2
  });
  return { repository, brief, recordingId: begun.recording.id };
}

describe("durable job worker", () => {
  it("fences stale provider reconciliation writes after lease recovery", async () => {
    const { repository, brief } = await repositoryWithAvailableRecording();
    const attempt = await repository.getLatestAttempt(brief.id);
    const job = await repository.enqueueDurableJob({
      type: "provider_call_reconciliation",
      callAttemptId: attempt!.id,
      runAfter: "2098-12-01T00:00:00.000Z",
      maxAttempts: 5
    });
    const first = await repository.claimDueDurableJob({
      types: ["provider_call_reconciliation"],
      workerId: "provider-worker-a",
      now: "2098-12-01T00:00:00.000Z",
      leaseExpiresAt: "2098-12-01T00:00:01.000Z"
    });
    const second = await repository.claimDueDurableJob({
      types: ["provider_call_reconciliation"],
      workerId: "provider-worker-b",
      now: "2098-12-01T00:00:02.000Z",
      leaseExpiresAt: "2098-12-01T00:01:02.000Z"
    });
    expect(first?.id).toBe(job.id);
    expect(second).toMatchObject({ id: job.id, leaseOwner: "provider-worker-b" });

    await expect(repository.applyProviderStatus(
      attempt!.providerCallId!,
      "completed",
      "completed",
      brief.id,
      {
        jobId: job.id,
        workerId: "provider-worker-a",
        checkedAt: "2098-12-01T00:00:02.000Z"
      }
    )).rejects.toMatchObject({ code: "DURABLE_JOB_LEASE_LOST" });
    expect((await repository.get(brief.id))?.brief.status).toBe("dialing");

    await repository.applyProviderStatus(
      attempt!.providerCallId!,
      "completed",
      "completed",
      brief.id,
      {
        jobId: job.id,
        workerId: "provider-worker-b",
        checkedAt: "2098-12-01T00:00:02.000Z"
      }
    );
    expect((await repository.get(brief.id))?.brief.status).toBe("completed");
  });

  it("fences an expired worker and lets a new lease recover processing", async () => {
    const { repository, recordingId } = await repositoryWithAvailableRecording();
    const firstNow = "2099-01-01T00:00:00.000Z";
    const first = await repository.claimDueDurableJob({
      types: ["final_transcription"],
      workerId: "worker-a",
      now: firstNow,
      leaseExpiresAt: "2099-01-01T00:00:01.000Z"
    });
    expect(first).toMatchObject({ attemptCount: 1, status: "running" });
    await repository.claimFinalTranscript(
      recordingId,
      "test-model",
      false,
      { jobId: first!.id, workerId: "worker-a", checkedAt: firstNow }
    );

    const secondNow = "2099-01-01T00:00:02.000Z";
    const second = await repository.claimDueDurableJob({
      types: ["final_transcription"],
      workerId: "worker-b",
      now: secondNow,
      leaseExpiresAt: "2099-01-01T00:01:02.000Z"
    });
    expect(second).toMatchObject({
      id: first!.id,
      attemptCount: 2,
      leaseOwner: "worker-b"
    });
    await expect(repository.completeFinalTranscript(
      recordingId,
      "stale result",
      [],
      { jobId: first!.id, workerId: "worker-a", checkedAt: secondNow }
    )).rejects.toMatchObject({ code: "DURABLE_JOB_LEASE_LOST" });

    await repository.claimFinalTranscript(
      recordingId,
      "test-model",
      false,
      { jobId: second!.id, workerId: "worker-b", checkedAt: secondNow }
    );
    await repository.completeFinalTranscript(
      recordingId,
      "fresh result",
      [],
      { jobId: second!.id, workerId: "worker-b", checkedAt: secondNow }
    );
    await expect(repository.completeDurableJob(
      second!.id,
      "worker-b",
      "2099-01-01T00:00:03.000Z"
    )).resolves.toBe(true);
    expect((await repository.listDurableJobAttempts(second!.id)).map(
      ({ outcome }) => outcome
    )).toEqual(["lease_expired", "succeeded"]);
    expect((await repository.get(second!.callId))?.finalTranscript?.text)
      .toBe("fresh result");
  });

  it("uses bounded retry state before succeeding exactly once", async () => {
    const { repository } = await repositoryWithAvailableRecording();
    let clock = new Date("2099-02-01T00:00:00.000Z");
    const handler = vi.fn()
      .mockRejectedValueOnce(new DurableJobExecutionError("provider_timeout"))
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const worker = new DurableJobWorker(
      repository,
      { final_transcription: handler },
      onError,
      {
        workerId: "deterministic-worker",
        leaseDurationMs: 60_000,
        now: () => clock
      }
    );

    await worker.runOnce();
    let job = (await repository.listDurableJobs()).find(
      ({ type }) => type === "final_transcription"
    )!;
    expect(job).toMatchObject({
      status: "queued",
      attemptCount: 1,
      lastErrorCode: "provider_timeout"
    });
    expect(handler).toHaveBeenCalledOnce();

    clock = new Date("2099-02-01T00:00:05.000Z");
    await worker.runOnce();
    job = (await repository.listDurableJobs()).find(
      ({ type }) => type === "final_transcription"
    )!;
    expect(job).toMatchObject({ status: "succeeded", attemptCount: 2 });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((await repository.listDurableJobAttempts(job.id)).map(
      ({ outcome }) => outcome
    )).toEqual(["retry_scheduled", "succeeded"]);
  });

  it("requires an audited superadmin action to restart dead-letter work", async () => {
    const { repository, recordingId } = await repositoryWithAvailableRecording();
    const job = await repository.enqueueDurableJob({
      type: "recording_retention",
      recordingId,
      runAfter: "2099-03-01T00:00:00.000Z",
      maxAttempts: 1
    });
    const claimed = await repository.claimDueDurableJob({
      types: ["recording_retention"],
      workerId: "dead-letter-worker",
      now: "2099-03-01T00:00:00.000Z",
      leaseExpiresAt: "2099-03-01T00:01:00.000Z"
    });
    expect(claimed?.id).toBe(job.id);
    await expect(repository.failDurableJob(
      job.id,
      "dead-letter-worker",
      "provider_unavailable",
      "2099-03-01T00:00:01.000Z",
      "2099-03-01T00:00:06.000Z"
    )).resolves.toMatchObject({ status: "dead_letter" });

    const actorUserId = randomUUID();
    await expect(repository.retryDurableJob(
      job.id,
      actorUserId,
      "Provider incident has cleared",
      "2099-03-01T00:05:00.000Z"
    )).resolves.toMatchObject({
      status: "queued",
      generation: 2,
      attemptCount: 0
    });
    expect(repository.durableJobAdminEventsForTest()).toEqual([
      {
        jobId: job.id,
        actorUserId,
        reason: "Provider incident has cleared",
        createdAt: "2099-03-01T00:05:00.000Z"
      }
    ]);
  });

  it("does not expire jobs for types the worker cannot execute", async () => {
    const { repository, recordingId } = await repositoryWithAvailableRecording();
    const retention = await repository.enqueueDurableJob({
      type: "recording_retention",
      recordingId,
      runAfter: "2099-04-01T00:00:00.000Z",
      maxAttempts: 2
    });
    await repository.claimDueDurableJob({
      types: ["recording_retention"],
      workerId: "retention-worker",
      now: "2099-04-01T00:00:00.000Z",
      leaseExpiresAt: "2099-04-01T00:00:01.000Z"
    });
    const worker = new DurableJobWorker(
      repository,
      { final_transcription: async () => undefined },
      () => undefined,
      {
        workerId: "transcription-only-worker",
        now: () => new Date("2099-04-01T00:00:02.000Z")
      }
    );

    await worker.runOnce();

    expect((await repository.listDurableJobs()).find(
      ({ id }) => id === retention.id
    )).toMatchObject({
      status: "running",
      attemptCount: 1,
      leaseOwner: "retention-worker"
    });
    expect(await repository.listDurableJobAttempts(retention.id)).toEqual([]);
  });

  it("does not claim work when this process is configured as API-only", async () => {
    const { repository } = await repositoryWithAvailableRecording();
    const handler = vi.fn(async () => undefined);
    const worker = new DurableJobWorker(
      repository,
      { final_transcription: handler },
      () => undefined,
      {
        enabled: false,
        now: () => new Date("2099-05-01T00:00:00.000Z")
      }
    );

    worker.start();
    worker.wake();
    await worker.runOnce();

    expect(worker.enabled).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect((await repository.listDurableJobs()).find(
      ({ type }) => type === "final_transcription"
    )).toMatchObject({ status: "queued", attemptCount: 0 });
    await worker.close();
  });

  it("registers and stops its externally visible runtime heartbeat", async () => {
    const repository = new InMemoryCallRepository();
    const worker = new DurableJobWorker(
      repository,
      { final_transcription: async () => undefined },
      () => undefined,
      {
        workerId: "heartbeat-worker",
        reportRuntimeHeartbeat: true,
        runtimeHeartbeatIntervalMs: 60_000,
        now: () => new Date("2099-05-02T00:00:00.000Z")
      }
    );

    worker.start();
    await vi.waitFor(async () => {
      const facts = await repository.getAdminSystemFacts(
        "2099-05-02T00:00:01.000Z",
        "2099-05-01T00:00:00.000Z"
      );
      expect(facts.externalWorker).toMatchObject({
        healthyInstances: 1,
        staleInstances: 0,
        activeJobs: 0
      });
    });

    await worker.close();
    await expect(repository.getAdminSystemFacts(
      "2099-05-02T00:00:02.000Z",
      "2099-05-01T00:00:00.000Z"
    )).resolves.toMatchObject({
      externalWorker: {
        healthyInstances: 0,
        staleInstances: 0,
        activeJobs: 0,
        lastSeenAt: "2099-05-02T00:00:00.000Z"
      }
    });
  });

  it("finishes the active lease on shutdown and leaves later work for restart", async () => {
    const { repository, recordingId } = await repositoryWithAvailableRecording();
    await repository.enqueueDurableJob({
      type: "recording_retention",
      recordingId,
      runAfter: "2099-06-01T00:00:00.000Z",
      maxAttempts: 3
    });
    let releaseFirst!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const firstHandler = vi.fn(async () => {
      markStarted();
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
    });
    const worker = new DurableJobWorker(
      repository,
      {
        final_transcription: firstHandler,
        recording_retention: firstHandler
      },
      () => undefined,
      {
        workerId: "stopping-worker",
        now: () => new Date("2099-06-01T00:00:01.000Z")
      }
    );

    worker.wake();
    await started;
    const closing = worker.close();
    expect(firstHandler).toHaveBeenCalledOnce();
    releaseFirst();
    await closing;

    expect((await repository.listDurableJobs()).map(({ status }) => status))
      .toEqual(["succeeded", "queued"]);

    const restartedHandler = vi.fn(async () => undefined);
    const restarted = new DurableJobWorker(
      repository,
      {
        final_transcription: restartedHandler,
        recording_retention: restartedHandler
      },
      () => undefined,
      {
        workerId: "restarted-worker",
        now: () => new Date("2099-06-01T00:00:02.000Z")
      }
    );
    await restarted.runOnce();

    expect(restartedHandler).toHaveBeenCalledOnce();
    expect((await repository.listDurableJobs()).map(({ status }) => status))
      .toEqual(["succeeded", "succeeded"]);
    await restarted.close();
  });
});
