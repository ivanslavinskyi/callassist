import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { normalizeCreateCallBriefInput } from "@callassist/contracts";
import { isolatedTestDatabase } from "./isolated-test-database";
import { cutoverLocalSummaries } from "./cutover-summary-v2";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { encryptJson } from "../security/encryption";

describe("local summary cutover", () => {
  it("rejects nonlocal databases before connecting", async () => {
    await expect(cutoverLocalSummaries("postgres://example.test/callassist", true)).rejects.toThrow("LOCAL_DATABASE_REQUIRED");
  });

  it("redacts only old summaries, cancels their jobs, and preserves source hashes, approvals and translations", async () => {
    const fixture = isolatedTestDatabase();
    await fixture.setup();
    const key = Buffer.alloc(32, 9), sql = postgres(fixture.url, { max: 1 });
    const repository = new PostgresCallRepository(fixture.url, key);
    try {
      const raw = normalizeCreateCallBriefInput({ recipientName: "Office", phoneNumber: "+41710000001", objective: "Ask about office hours",
        assistantProfileId: "sebastian", representedPersonFirstName: "Nina", representedPersonLastName: "Example", locale: "en-GB", allowLanguageSwitch: false, allowedFacts: [], audioRetentionDays: 0 });
      const compilation = await new DeterministicBriefCompiler().compile(raw);
      const brief = await repository.create(raw, compilation);
      await repository.approveCompilation(brief.id, { revision: compilation.revision, snapshotHash: compilation.snapshotHash,
        review: { mode: "original", language: "en-GB", selectionRevision: 1 } });
      const { attempt } = await repository.startAttempt(brief.id, { provider: "twilio" });
      await repository.attachProviderCall(attempt.id, "CA-cutover", "in-progress");
      await expect(cutoverLocalSummaries(fixture.url, true)).rejects.toThrow("QUIESCENT_RUNTIME");
      const { recording } = await repository.beginRecording(brief.id);
      await repository.attachProviderRecording(recording.id, "RE-cutover", "in-progress");
      await repository.applyRecordingStatus({ callBriefId: brief.id, recordingId: recording.id, providerCallId: "CA-cutover", providerRecordingId: "RE-cutover", providerStatus: "completed", durationSeconds: 20, channels: 2 });
      await repository.claimFinalTranscript(recording.id, "test-model");
      await repository.completeFinalTranscript(recording.id, "Open on weekdays.", []);
      await repository.applyProviderStatus("CA-cutover", "completed", "completed", brief.id);
      const revision = (await repository.getCurrentTranscriptRevision(brief.id))!;
      const source = await repository.getPlanSource(brief.id);
      const base = { callId: brief.id, kind: "call_summary" as const, compilationId: source.compilationId, transcriptRevisionId: revision.id, sourceHash: revision.sourceHash, targetLanguage: "en" as const };
      const old = await repository.enqueueTextArtifact({ ...base, generatorVersion: "old-summary" });
      const current = await repository.enqueueTextArtifact({ ...base, generatorVersion: "summary-v2:test" });
      const translation = await repository.enqueueTextArtifact({ ...base, kind: "transcript_translation", generatorVersion: "text-processing-v2:test" });
      const preserved = await sql`SELECT id,kind,status,source_hash,payload_ciphertext,payload_hash FROM call_text_artifacts WHERE id IN (${current.id},${translation.id}) ORDER BY id`;
      const sourceBefore = await sql`SELECT * FROM final_transcript_revisions WHERE id=${revision.id}`;
      const receiptBefore = await repository.getCurrentReviewReceipt(brief.id);
      const legacy = encryptJson({ answers: [{ question: "Hours?", answer: "Weekdays" }], nextSteps: [], unresolved: [] }, key);
      await sql`UPDATE call_text_artifacts SET payload_ciphertext=${legacy},payload_hash=${"a".repeat(64)},status='ready' WHERE id=${old.id}`;
      await sql`INSERT INTO call_text_artifact_chunks(id,artifact_id,chunk_index,payload_ciphertext,payload_hash) VALUES (${randomUUID()},${old.id},0,${legacy},${"b".repeat(64)})`;
      expect(await cutoverLocalSummaries(fixture.url)).toMatchObject({ applied: false, payloads: 1, chunks: 1 });
      expect(await cutoverLocalSummaries(fixture.url, true)).toMatchObject({ applied: true, payloads: 1, chunks: 1 });
      expect((await repository.getTextArtifact(brief.id, old.id))).toMatchObject({ status: "cancelled", payload: null, payloadHash: "a".repeat(64) });
      expect(await sql`SELECT id,kind,status,source_hash,payload_ciphertext,payload_hash FROM call_text_artifacts WHERE id IN (${current.id},${translation.id}) ORDER BY id`).toEqual(preserved);
      expect(await sql`SELECT * FROM final_transcript_revisions WHERE id=${revision.id}`).toEqual(sourceBefore);
      expect(await repository.getCurrentReviewReceipt(brief.id)).toEqual(receiptBefore);
      expect((await sql`SELECT status FROM durable_jobs WHERE text_artifact_id=${old.id}`)[0]?.status).toBe("cancelled");
      expect((await sql`SELECT payload_ciphertext,payload_hash FROM call_text_artifact_chunks WHERE artifact_id=${old.id}`)[0]).toMatchObject({ payload_ciphertext: null, payload_hash: "b".repeat(64) });
      expect(await cutoverLocalSummaries(fixture.url, true)).toMatchObject({ payloads: 0, chunks: 0 });
    } finally { await repository.close(); await sql.end(); await fixture.teardown(); }
  }, 30_000);
});
