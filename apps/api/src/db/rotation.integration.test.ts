import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import postgres from "postgres";
import { normalizeCreateCallBriefInput, type CreateCallBriefInput } from "@callassist/contracts";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { parseDataEncryptionKeyring } from "../security/encryption";
import { encryptedColumns } from "./encrypted-columns";
import { isolatedTestDatabase } from "./isolated-test-database";
import { reencryptDatabase } from "./reencrypt-data";

const database = isolatedTestDatabase();
const sql = postgres(database.url, { max: 1, onnotice: () => undefined });
beforeAll(() => database.setup(), 15_000);
afterAll(async () => { await sql.end(); await database.teardown(); });

it("rotates queued preparation input, completes without the old key, and replays as a no-op", async () => {
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
    await old.approveCompilation(historical.id);
    await old.grantSignupCredits(userId);
    await old.startAttempt(historical.id, { provider: "twilio" });
    const historicalHash = (await old.get(historical.id))?.compilation?.snapshotHash;
    expect(historicalHash).toMatch(/^[a-f0-9]{64}$/);
    const queued = await old.enqueueCallPreparation({ userId, idempotencyKey, inputFingerprint: "a".repeat(64), input, now });
    const environment = { DATABASE_URL: database.url, DATA_ENCRYPTION_KEY: newKey,
      DATA_ENCRYPTION_ACTIVE_KEY_ID: "current", DATA_ENCRYPTION_LEGACY_V1_KEY_ID: "old",
      DATA_ENCRYPTION_PREVIOUS_KEYS: JSON.stringify({ old: oldKey }), DATA_ENCRYPTION_REENCRYPT_CONFIRM: "current" };
    const rotation = await reencryptDatabase(environment);
    expect(rotation).toMatchObject({
      ciphertextFamilies: 13, remainingNonActiveCiphertexts: 0
    });
    expect(rotation.rewrittenCiphertexts).toBeGreaterThanOrEqual(4);
    expect((await current.get(historical.id))?.compilation?.snapshotHash).toBe(historicalHash);
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
}, 15_000);
