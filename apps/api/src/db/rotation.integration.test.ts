import { originalPlanReview } from "../test-helpers/original-plan-review";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import postgres from "postgres";
import { normalizeCreateCallBriefInput, type CreateCallBriefInput } from "@callassist/contracts";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { decryptJson, encryptJson, parseDataEncryptionKeyring } from "../security/encryption";
import { encryptedColumns } from "./encrypted-columns";
import { isolatedTestDatabase } from "./isolated-test-database";
import { reencryptDatabase } from "./reencrypt-data";
import { runRecoveryDrill } from "./recovery-drill";

const database = isolatedTestDatabase();
const sql = postgres(database.url, { max: 1, onnotice: () => undefined });
beforeAll(() => database.setup(), 15_000);
afterAll(async () => { await sql.end(); await database.teardown(); });

it("rotates immutable text evidence and queued input without changing source hashes, then replays as a no-op", async () => {
  const oldKey = Buffer.alloc(32, 7).toString("base64");
  const newKey = Buffer.alloc(32, 9).toString("base64");
  const old = new PostgresCallRepository(database.url, parseDataEncryptionKeyring({
    DATA_ENCRYPTION_KEY: oldKey, DATA_ENCRYPTION_ACTIVE_KEY_ID: "old", DATA_ENCRYPTION_LEGACY_V1_KEY_ID: "old"
  }));
  const current = new PostgresCallRepository(database.url, parseDataEncryptionKeyring({
    DATA_ENCRYPTION_KEY: newKey, DATA_ENCRYPTION_ACTIVE_KEY_ID: "current", DATA_ENCRYPTION_LEGACY_V1_KEY_ID: "current"
  }));
  try {
    const userId = randomUUID();
    await sql`INSERT INTO users(id,email,password_hash,phone_e164,first_name,last_name,role,status,ui_locale,created_at)
      VALUES (${userId},${`${userId}@example.test`},'test-only',${`fixture:${userId}`},'Rotation','Test','user','active','en',now())`;
    await sql`UPDATE users SET phone_verified_at=now() WHERE id=${userId}`;
    const input: CreateCallBriefInput = {
      recipientName: "Office", phoneNumber: "+41710000001", objective: "Ask opening hours",
      assistantProfileId: "sebastian", representedPersonFirstName: "Rotation", representedPersonLastName: "Test",
      assistanceReason: "none", locale: "en-GB", allowLanguageSwitch: false, allowedFacts: []
    };
    const idempotencyKey = randomUUID();
    const now = new Date().toISOString();
    const historical = await old.create(input,
      await new DeterministicBriefCompiler().compile(normalizeCreateCallBriefInput(input)), userId);
    await old.approveCompilation(historical.id, await originalPlanReview(old, historical.id));
    await old.grantSignupCredits(userId);
    const attempt = await old.startAttempt(historical.id, { provider: "twilio" });
    const providerCallId = `CA-${randomUUID()}`;
    await old.attachProviderCall(attempt.attempt.id, providerCallId, "in-progress");
    const recording = await old.beginRecording(historical.id);
    const providerRecordingId = `RE-${randomUUID()}`;
    await old.attachProviderRecording(recording.recording.id, providerRecordingId, "in-progress");
    await old.applyRecordingStatus({ callBriefId: historical.id, recordingId: recording.recording.id,
      providerCallId, providerRecordingId, providerStatus: "completed", durationSeconds: 20, channels: 2 });
    await old.claimFinalTranscript(recording.recording.id, "rotation-test");
    await old.completeFinalTranscript(recording.recording.id, "The office closes at 17:00.", []);
    const transcript = await old.getCurrentTranscriptRevision(historical.id);
    const receipt = await old.getCurrentReviewReceipt(historical.id);
    const source = await old.getPlanSource(historical.id);
    const artifact = await old.enqueueTextArtifact({ callId: historical.id, kind: "plan_review",
      compilationId: source.compilationId, sourceHash: source.snapshotHash, targetLanguage: "ru", generatorVersion: "rotation-v1" });
    const textJob = await old.claimDueDurableJob({ types: ["text_artifact_generation"], workerId: "rotate-text",
      now: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 120_000).toISOString() });
    expect(textJob?.textArtifactId).toBe(artifact.id);
    const textLease = { jobId: textJob!.id, workerId: "rotate-text", generation: textJob!.generation,
      attemptNumber: textJob!.attemptCount, checkedAt: new Date().toISOString() };
    await old.claimTextArtifact(artifact.id, textLease);
    const payload = { fields: [{ id: "objective", text: "Уточнить часы работы" }] };
    await old.saveTextArtifactChunk(artifact.id, 0, payload, textLease);
    const ready = await old.completeTextArtifact(artifact.id, payload, textLease);
    // Simulate a retained v1 ciphertext: rotation must support it even after the evidence became immutable.
    await sql.begin(async (transaction) => {
      await transaction`SELECT set_config('callassist.encryption_rotation', 'enabled', true)`;
      await transaction`UPDATE call_text_artifacts SET payload_ciphertext=${encryptJson(payload, Buffer.from(oldKey, "base64"))}
        WHERE id=${artifact.id}`;
    });
    await expect(sql`UPDATE call_text_artifacts SET payload_ciphertext='tampered' WHERE id=${artifact.id}`)
      .rejects.toThrow(/immutable/i);
    await expect(sql`UPDATE final_transcript_revisions SET source_hash=${"0".repeat(64)} WHERE id=${transcript!.id}`)
      .rejects.toThrow(/immutable/i);
    await expect(sql`UPDATE call_plan_review_receipts SET language='ru' WHERE id=${receipt!.id}`)
      .rejects.toThrow(/immutable/i);
    const historicalHash = (await old.get(historical.id))?.compilation?.snapshotHash;
    expect(historicalHash).toMatch(/^[a-f0-9]{64}$/);
    const queued = await old.enqueueCallPreparation({ userId, idempotencyKey, inputFingerprint: "a".repeat(64), input, now });
    const environment = { DATABASE_URL: database.url, DATA_ENCRYPTION_KEY: newKey,
      DATA_ENCRYPTION_ACTIVE_KEY_ID: "current", DATA_ENCRYPTION_LEGACY_V1_KEY_ID: "old",
      DATA_ENCRYPTION_PREVIOUS_KEYS: JSON.stringify({ old: oldKey }), DATA_ENCRYPTION_REENCRYPT_CONFIRM: "current" };
    const rotation = await reencryptDatabase(environment);
    expect(rotation).toMatchObject({
      ciphertextFamilies: 17, remainingNonActiveCiphertexts: 0
    });
    expect(rotation.rewrittenCiphertexts).toBeGreaterThanOrEqual(4);
    expect((await current.get(historical.id))?.compilation?.snapshotHash).toBe(historicalHash);
    expect(await current.getTextArtifact(historical.id, artifact.id)).toEqual(ready);
    expect(await current.getCurrentTranscriptRevision(historical.id)).toEqual(transcript);
    expect(await current.getCurrentReviewReceipt(historical.id)).toEqual(receipt);
    const [chunk] = await sql<{ payload: string }[]>`SELECT payload_ciphertext AS payload
      FROM call_text_artifact_chunks WHERE artifact_id=${artifact.id}`;
    expect(decryptJson(chunk!.payload, parseDataEncryptionKeyring({ DATA_ENCRYPTION_KEY: newKey,
      DATA_ENCRYPTION_ACTIVE_KEY_ID: "current" }))).toEqual(payload);
    // Opt in for a real Docker pg_dump/restore round trip against this disposable fixture only.
    if (process.env.RUN_TEXT_RECOVERY_DRILL === "true") {
      expect(await runRecoveryDrill({ ...environment, DATA_ENCRYPTION_PREVIOUS_KEYS: "",
        DATA_ENCRYPTION_LEGACY_V1_KEY_ID: "current", RECOVERY_SOURCE_DATABASE_URL: database.url }))
        .toMatchObject({ event: "database_recovery_drill_succeeded", criticalTableCount: 21,
          temporaryResourcesRemoved: true, encryptedSamplesVerified: 14 });
    }
    expect(await reencryptDatabase({ ...environment, DATA_ENCRYPTION_PREVIOUS_KEYS: "",
      DATA_ENCRYPTION_LEGACY_V1_KEY_ID: "current" })).toMatchObject({ rewrittenCiphertexts: 0 });
    const job = await current.claimDueDurableJob({ types: ["brief_compilation"], workerId: "rotation-test", now,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() });
    const lease = { jobId: job!.id, workerId: "rotation-test", checkedAt: now };
    const work = await current.claimCallPreparation(queued.id, lease);
    expect(work.input).toEqual(normalizeCreateCallBriefInput(input));
    if (!work.input) throw new Error("Missing decrypted preparation input");
    const compiled = await new DeterministicBriefCompiler().compile(normalizeCreateCallBriefInput(work.input));
    const brief = await current.create(work.input, compiled, userId, idempotencyKey, { preparationId: queued.id, lease });
    expect(await current.getCallPreparation(queued.id, userId)).toMatchObject({ status: "succeeded", callBriefId: brief.id });
    // A newly added encrypted column must enter rotation AND restore coverage.
    const actual = await sql<{ table_name: string; column_name: string }[]>`
      SELECT table_name,column_name FROM information_schema.columns
      WHERE table_schema='public' AND column_name LIKE '%\_ciphertext' ESCAPE '\'`;
    expect(actual.map((r) => `${r.table_name}.${r.column_name}`).sort())
      .toEqual(encryptedColumns.map(([table, column]) => `${table}.${column}`).sort());
  } finally { await old.close(); await current.close(); }
}, 30_000);
