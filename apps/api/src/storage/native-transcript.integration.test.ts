import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "./postgres-call-repository";
import { InMemoryCallRepository } from "./in-memory-call-repository";
import { approvedCall } from "../voice/voice-test-helpers";

const fixture = isolatedTestDatabase();
beforeAll(() => fixture.setup());
afterAll(() => fixture.teardown());

describe.each(["memory", "postgres"])("%s native result workflow", mode => {
  it.each([false, true])("publishes one revision before the recording callback, preserves it on replay and schedules retention (application audio=%s)", async applicationAudio => {
    const repository = mode === "postgres" ? new PostgresCallRepository(fixture.url, Buffer.alloc(32, 7)) : new InMemoryCallRepository();
    const providerCallId = `CA-native-${applicationAudio}`;
    const providerRecordingId = `RE-native-${applicationAudio}`;
    const call = await approvedCall(undefined, repository, "en-GB", providerCallId);
    try {
      const recording = (await repository.beginRecording(call.brief.id)).recording;
      const attached = await repository.attachProviderRecording(recording.id, providerRecordingId, "in-progress");
      const timing = { sessionId: "native-result", eventId: "answer", sessionStartedAt: attached.recording.startedAt!, startMs: 1000, endMs: 2000 };
      await call.service.addNativeLiveTranscript(call.brief.id, "recipient", "М-м, я хочу жареной картошки", "native-answer", timing);
      if (applicationAudio) await call.service.addApplicationPlaybackTranscript(call.brief.id, "Vielen Dank. Auf Wiederhören.", "closing", {
        sessionId: timing.sessionId, markId: "twilio-closing", durationMs: 1000,
        sentAt: new Date(Date.parse(timing.sessionStartedAt) + 2500).toISOString(),
        acknowledgedAt: new Date(Date.parse(timing.sessionStartedAt) + 3500).toISOString()
      });
      const capture = { version: 1 as const, sessionId: timing.sessionId, model: "gpt-live-1", status: "complete" as const, updatedAt: new Date().toISOString() };
      await call.service.setNativeTranscriptCapture(call.brief.id, call.attempt.id, capture);
      await expect.poll(async () => (await repository.get(call.brief.id))?.finalTranscript?.status).toBe("completed");
      const snapshot = (await repository.get(call.brief.id))!;
      expect(snapshot.finalTranscript).toMatchObject({ source: applicationAudio ? "live_composed" : "live_native", model: "gpt-live-1" });
      expect(snapshot.finalTranscript!.text).toContain("М-м, я хочу жареной картошки");
      const revision = (await repository.getCurrentTranscriptRevision(call.brief.id))!;
      expect(revision).toMatchObject({ source: applicationAudio ? "live_composed" : "live_native", text: snapshot.finalTranscript!.text });
      if (applicationAudio) {
        expect(snapshot.transcript.at(-1)?.applicationPlayback?.markId).toBe("twilio-closing");
        expect(revision.segments.at(-1)).toMatchObject({ source: "application_playback", applicationPlayback: { markId: "twilio-closing" } });
      }
      expect(snapshot.recording?.deleteAfter).toBeNull();
      await call.service.setNativeTranscriptCapture(call.brief.id, call.attempt.id, capture);
      await call.service.handleTwilioRecordingStatus({ callBriefId: call.brief.id, recordingId: recording.id, providerCallId,
        providerRecordingId, providerStatus: "completed", durationSeconds: 4, channels: 2 });
      expect((await repository.get(call.brief.id))?.recording?.deleteAfter).toBeTruthy();
      expect((await repository.listDurableJobs()).some(job => job.type === "recording_retention" && job.recordingId === recording.id)).toBe(true);
      expect((await repository.listDurableJobs()).some(job => job.type === "final_transcription")).toBe(false);
      expect((await repository.getCurrentTranscriptRevision(call.brief.id))?.id).toBe(revision.id);
      expect((await repository.exportCallTextData(call.brief.id)).transcriptRevisions).toHaveLength(1);
    } finally { await call.service.close(); if (repository instanceof PostgresCallRepository) await repository.close(); }
  });
});
