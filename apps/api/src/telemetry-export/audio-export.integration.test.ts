import "../config/load-env";
import { randomUUID, createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { unzipSync, strFromU8 } from "fflate";
import { normalizeCreateCallBriefInput, type TelemetryExportInput } from "@callassist/contracts";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { TelemetryExportService } from "./service";
import { exportMaxRecordingBytes } from "./archive";
import type { RecordingMediaStream } from "../telephony/telephony-provider";

describe("retained audio telemetry archives", () => {
  const db = isolatedTestDatabase(), key = Buffer.alloc(32, 5), actor = randomUUID();
  const sql = postgres(db.url, { max: 3, onnotice: () => undefined });
  const repository = new PostgresCallRepository(db.url, key);
  const fetchMedia = vi.fn<(id: string, channels: 1 | 2, signal: AbortSignal) => Promise<RecordingMediaStream>>();
  const service = new TelemetryExportService(db.url, key, { streamRecordingMedia: fetchMedia });
  let callId: string, recordingId: string, otherRecording: string;
  const request = (): TelemetryExportInput => ({ requestId: randomUUID(), reason: "Audio regression fixture", preset: "last7", timezone: "Europe/Zurich", includeAudio: true });
  const bytes = Buffer.from("RIFF deterministic dual channel recording");
  async function files(id: string) {
    const chunks: Buffer[] = []; for await (const chunk of service.download(actor, id, async () => true)) chunks.push(chunk);
    return unzipSync(Buffer.concat(chunks));
  }
  function successful() {
    fetchMedia.mockImplementation(async (_id, channels) => {
      // The single snapshot connection must be released before provider I/O.
      await service.reader`SELECT 1`;
      return { contentType: "audio/wav", channels, cancel: async () => undefined,
        bytes: (async function* () { yield bytes.subarray(0, 5); yield bytes.subarray(5); })() };
    });
  }
  beforeAll(async () => {
    await db.setup();
    await sql`INSERT INTO users(id,email,password_hash,phone_e164,first_name,last_name,role,status,ui_locale,phone_verified_at,created_at)
      VALUES(${actor},${`${actor}@example.test`},'fixture',${`fixture:${actor}`},'Audio','Test','superadmin','active','en',now(),now())`;
    await repository.grantSignupCredits(actor);
    const input = normalizeCreateCallBriefInput({ recipientName: "Office", phoneNumber: "+41710000001", objective: "Ask office hours",
      assistantProfileId: "sebastian", representedPersonFirstName: "Test", representedPersonLastName: "Caller", assistanceReason: "none", locale: "en-GB", allowLanguageSwitch: false, allowedFacts: [] });
    const call = await repository.create(input, await new DeterministicBriefCompiler().compile(input), actor); callId = call.id;
    await repository.approveCompilation(callId, await originalPlanReview(repository, callId));
    const { attempt } = await repository.startAttempt(callId, { provider: "twilio" });
    const providerCallId = `CA-${randomUUID()}`, providerRecordingId = `RE-${randomUUID()}`;
    await repository.attachProviderCall(attempt.id, providerCallId, "in-progress");
    const recording = await repository.beginRecording(callId); recordingId = recording.recording.id;
    await repository.attachProviderRecording(recordingId, providerRecordingId, "in-progress");
    await repository.applyRecordingStatus({ callBriefId: callId, recordingId, providerCallId, providerRecordingId, providerStatus: "completed", durationSeconds: 20, channels: 2 });
    await repository.updateStatus(callId, "completed");
    const second = await repository.create(input, await new DeterministicBriefCompiler().compile(input), actor);
    await repository.approveCompilation(second.id, await originalPlanReview(repository, second.id));
    const { attempt: secondAttempt } = await repository.startAttempt(second.id, { provider: "twilio" });
    const secondProviderCall = `CA-${secondAttempt.id}`, secondProviderRecording = `RE-${secondAttempt.id}`;
    await repository.attachProviderCall(secondAttempt.id, secondProviderCall, "in-progress");
    const secondRecording = await repository.beginRecording(second.id); otherRecording = secondRecording.recording.id;
    await repository.attachProviderRecording(otherRecording, secondProviderRecording, "in-progress");
    await repository.applyRecordingStatus({ callBriefId: second.id, recordingId: otherRecording, providerCallId: secondProviderCall,
      providerRecordingId: secondProviderRecording, providerStatus: "completed", durationSeconds: 20, channels: 2 });
    await repository.updateStatus(second.id, "completed");
    await sql`UPDATE call_recordings SET delete_after=now()+interval '2 hours' WHERE id IN (${recordingId},${otherRecording})`;
    successful();
  }, 30000);
  afterEach(async () => {
    for (const row of (await service.list(actor)).items) await service.cancel(actor, row.id);
    await sql`UPDATE admin_telemetry_exports SET created_at=now()-interval '2 hours' WHERE actor_user_id=${actor}`;
    fetchMedia.mockReset(); successful();
  });
  afterAll(async () => { await Promise.all([service.close(), repository.close(), sql.end()]); await db.teardown(); });

  it("includes every attempt's retained recording outside the snapshot transaction, with hashes and retention TTL", async () => {
    expect(await service.preview(actor, request())).toMatchObject({ recordings: 2, estimatedBytes: 1_280_000, unknownSizes: 0 });
    const job = await service.create(actor, request()); await service.runOnce();
    const ready = await service.get(actor, job.id); expect(ready.status).toBe("ready");
    expect(ready.counts.audio_included).toBe(2); expect(ready.expiresAt).toBe(ready.audioDeadline);
    const zip = await files(job.id), manifest = JSON.parse(strFromU8(zip["audio-manifest.json"]!));
    expect(manifest).toMatchObject({ version: 2, complete: true });
    expect(manifest.recordings.map((r: {recordingId:string}) => r.recordingId).sort()).toEqual([recordingId, otherRecording].sort());
    for (const item of manifest.recordings) {
      expect(Buffer.from(zip[item.path]!)).toEqual(bytes);
      expect(item).toMatchObject({ status: "included", channels: 2, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    expect(fetchMedia).toHaveBeenCalledTimes(2);
  });
  it("preserves metadata-only mode without contacting a provider", async () => {
    const job = await service.create(actor, { ...request(), includeAudio: false }); await service.runOnce();
    expect((await service.get(actor, job.id)).counts.audio_not_requested).toBe(2); expect(fetchMedia).not.toHaveBeenCalled();
  });
  it("marks provider 404 explicitly and never describes partial audio as complete", async () => {
    fetchMedia.mockRejectedValue(new Error("TWILIO_RECORDING_DOWNLOAD_404"));
    const job = await service.create(actor, request()); await service.runOnce();
    const zip = await files(job.id);
    expect(JSON.parse(strFromU8(zip["manifest.json"]!)).completeness).toBe("partial_audio");
    expect(JSON.parse(strFromU8(zip["audio-manifest.json"]!)).recordings.every((r: {status:string}) => r.status === "unavailable")).toBe(true);
  });
  it("does not publish a truncated WAV after a mid-body failure", async () => {
    fetchMedia.mockResolvedValue({ contentType: "audio/wav", channels: 2, cancel: async () => undefined,
      bytes: (async function* () { yield bytes; throw new Error("fixture body disconnect"); })() });
    const job = await service.create(actor, request()); await service.runOnce();
    expect(await service.get(actor, job.id)).toMatchObject({ status: "queued", failureCode: "EXPORT_AUDIO_STREAM_FAILED" });
    expect((await sql`SELECT id FROM admin_telemetry_export_parts WHERE export_id=${job.id}`).length).toBe(0);
  });
  it("fails explicitly at the media limit instead of dropping a recording", async () => {
    fetchMedia.mockResolvedValue({ contentType: "audio/wav", channels: 2, cancel: async () => undefined,
      bytes: (async function* () { yield new Uint8Array(exportMaxRecordingBytes + 1); })() });
    const job = await service.create(actor, request()); await service.runOnce();
    expect(await service.get(actor, job.id)).toMatchObject({ status: "failed", failureCode: "EXPORT_AUDIO_LIMIT_EXCEEDED" });
  });
  it("revokes on recording deletion intent during a media stream", async () => {
    fetchMedia.mockResolvedValue({ contentType: "audio/wav", channels: 2, cancel: async () => undefined,
      bytes: (async function* () { yield bytes; await sql`UPDATE call_recordings SET delete_after=now() WHERE id=${recordingId}`; yield bytes; })() });
    const job = await service.create(actor, request()); await service.runOnce();
    expect((await service.get(actor, job.id)).status).toBe("revoked");
    expect((await sql`SELECT id FROM admin_telemetry_export_parts WHERE export_id=${job.id}`).length).toBe(0);
    await sql`UPDATE call_recordings SET delete_after=now()+interval '2 hours' WHERE id=${recordingId}`;
  });
  it("refuses a ready archive at its audio deadline even with the worker offline", async () => {
    const job = await service.create(actor, request()); await service.runOnce();
    await sql`UPDATE admin_telemetry_exports SET audio_deadline=now()-interval '1 second' WHERE id=${job.id}`;
    expect((await service.get(actor, job.id)).status).toBe("expired");
    await expect(files(job.id)).rejects.toThrow("EXPORT_NOT_READY");
  });
});
