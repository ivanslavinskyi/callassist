import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { expect, it } from "vitest";
import { normalizeCreateCallBriefInput } from "@callassist/contracts";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { decryptJson, parseDataEncryptionKeyring } from "../security/encryption";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { isolatedTestDatabase } from "./isolated-test-database";
import { reencryptDatabase } from "./reencrypt-data";

it("rotates intact and privacy-redacted feedback, resumes without old keys, and rejects tampering", async () => {
  const database = isolatedTestDatabase();
  const sql = postgres(database.url, { max: 1, onnotice: () => undefined });
  const oldKey = Buffer.alloc(32, 7);
  const newKey = Buffer.alloc(32, 9).toString("base64");
  const environment = {
    DATABASE_URL: database.url,
    DATA_ENCRYPTION_KEY: newKey,
    DATA_ENCRYPTION_ACTIVE_KEY_ID: "current",
    DATA_ENCRYPTION_LEGACY_V1_KEY_ID: "old",
    DATA_ENCRYPTION_PREVIOUS_KEYS: JSON.stringify({ old: oldKey.toString("base64") }),
    DATA_ENCRYPTION_REENCRYPT_CONFIRM: "current",
    DATA_ENCRYPTION_REENCRYPT_BATCH_SIZE: "1"
  };
  const currentKeyring = parseDataEncryptionKeyring({
    DATA_ENCRYPTION_KEY: newKey, DATA_ENCRYPTION_ACTIVE_KEY_ID: "current"
  });
  const old = new PostgresCallRepository(database.url, oldKey);
  const current = new PostgresCallRepository(database.url, currentKeyring);
  try {
    await database.setup();
    const userId = randomUUID();
    await sql`INSERT INTO users(id,email,password_hash,phone_e164,first_name,last_name,role,status,ui_locale,created_at)
      VALUES(${userId},${`${userId}@example.test`},'test-only',${`fixture:${userId}`},'Feedback','Rotation','user','active','en',now())`;
    await sql`UPDATE users SET phone_verified_at=now() WHERE id=${userId}`;
    const input = normalizeCreateCallBriefInput({
      recipientName: "Office", phoneNumber: "+41710000001", objective: "Ask opening hours",
      assistantProfileId: "sebastian", representedPersonFirstName: "Feedback", representedPersonLastName: "Rotation",
      locale: "en-GB", allowLanguageSwitch: false, allowedFacts: []
    });
    const compilation = await new DeterministicBriefCompiler().compile(input);
    const fixtures = [];
    for (const [repository, deleted, comment] of [
      [old, false, "Retained private comment"],
      [old, true, "Deleted legacy comment"],
      [current, true, "Deleted current-key comment"],
      [old, false, null]
    ] as const) {
      const brief = await repository.create(input, compilation, userId);
      await repository.updateStatus(brief.id, "completed");
      const feedback = { idempotencyKey: randomUUID(), goalResult: "yes" as const, transcriptQuality: null, comment };
      const submitted = await repository.submitOwnerCallFeedback(brief.id, userId, feedback);
      if (deleted) await repository.deleteCallData({
        callId: brief.id, userId, requestId: randomUUID(),
        providerRecordingDisposition: "not_present", deletedAt: new Date().toISOString()
      });
      fixtures.push({ callId: brief.id, deleted, feedback, submitted });
    }

    const rotated = await reencryptDatabase(environment);
    expect(rotated).toMatchObject({ rewrittenFeedbackRows: 4, verifiedFeedbackFingerprints: 4 });
    const rows = await sql`SELECT call_brief_id, comment_ciphertext, payload_fingerprint_key_id FROM call_feedback_revisions`;
    for (const fixture of fixtures) {
      const row = rows.find(row => row.call_brief_id === fixture.callId)!;
      expect(row.payload_fingerprint_key_id).toBe("current");
      if (fixture.deleted || fixture.feedback.comment === null) expect(row.comment_ciphertext).toBeNull();
      else expect(decryptJson(row.comment_ciphertext, currentKeyring)).toBe(fixture.feedback.comment);
      if (fixture.deleted) expect(await current.get(fixture.callId)).toBeNull();
      else expect(await current.submitOwnerCallFeedback(fixture.callId, userId, fixture.feedback)).toEqual(fixture.submitted);
    }
    expect(await reencryptDatabase({ ...environment, DATA_ENCRYPTION_PREVIOUS_KEYS: "", DATA_ENCRYPTION_LEGACY_V1_KEY_ID: "current" }))
      .toMatchObject({ rewrittenCiphertexts: 0, rewrittenFeedbackRows: 0, verifiedFeedbackFingerprints: 4 });

    const retained = fixtures[0]!;
    await expect(sql`UPDATE call_feedback_revisions SET payload_fingerprint=${"0".repeat(64)} WHERE call_brief_id=${retained.callId}`)
      .rejects.toThrow(/immutable/);
    await expect(sql.begin(async tx => {
      await tx`SELECT set_config('callassist.encryption_rotation', 'enabled', true)`;
      await tx`UPDATE call_feedback_revisions SET goal_result='no' WHERE call_brief_id=${retained.callId}`;
    })).rejects.toThrow(/immutable/);
    // A missing comment alone is not proof of privacy deletion.
    await sql`UPDATE call_feedback_revisions SET comment_ciphertext=NULL WHERE call_brief_id=${retained.callId}`;
    await expect(reencryptDatabase(environment)).rejects.toThrow("Stored feedback fingerprint verification failed");
  } finally {
    await old.close(); await current.close(); await sql.end(); await database.teardown();
  }
}, 30_000);
