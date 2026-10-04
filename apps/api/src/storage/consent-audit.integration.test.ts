import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "./postgres-call-repository";
import { consentAuditCases } from "./consent-audit.fixture";
import { approvedCall } from "../voice/voice-test-helpers";

const database = isolatedTestDatabase();
beforeAll(() => database.setup());
afterAll(() => database.teardown());
describe("PostgreSQL consent audit", () => consentAuditCases(() => new PostgresCallRepository(database.url, Buffer.alloc(32, 9))));

it("serializes settings updates, verifies the active superadmin and pins admissions across connections", async () => {
  const repository = new PostgresCallRepository(database.url, Buffer.alloc(32, 9));
  const second = new PostgresCallRepository(database.url, Buffer.alloc(32, 9));
  const sql = postgres(database.url, { max: 1 }), actor = randomUUID(), ordinaryAdmin = randomUUID();
  let before: Awaited<ReturnType<typeof approvedCall>> | undefined, after: Awaited<ReturnType<typeof approvedCall>> | undefined;
  try {
    for (const [id, role, phone] of [[actor, "superadmin", "+41710000991"], [ordinaryAdmin, "admin", "+41710000992"]]) {
      await sql`INSERT INTO users(id,email,password_hash,phone_e164,first_name,last_name,role,status,ui_locale,created_at)
        VALUES(${id!},${id! + "@example.test"},'fixture',${phone!},'Test','Admin',${role!},'active','en',now())`;
    }
    before = await approvedCall(undefined, repository, "en-GB", "CA-policy-before");
    const input = { mode: "hybrid_deterministic_v1" as const, expectedRevision: 1, reason: "Approved local hybrid evaluation" };
    await expect(repository.updateVoiceConsentSettings(input, ordinaryAdmin)).rejects.toThrow("VOICE_CONSENT_FORBIDDEN");
    const updates = await Promise.allSettled([repository.updateVoiceConsentSettings(input, actor), second.updateVoiceConsentSettings(input, actor)]);
    expect(updates.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await second.getVoiceConsentSettings()).toMatchObject({ policy: { mode: "hybrid_deterministic_v1", revision: 2 }, updatedByUserId: actor });
    expect(await second.getConsentRuntimePolicy(before.brief.id, before.attempt.id)).toMatchObject({ mode: "semantic_native", revision: 1 });
    after = await approvedCall(undefined, repository, "en-GB", "CA-policy-after");
    expect(await second.getConsentRuntimePolicy(after.brief.id, after.attempt.id)).toMatchObject({ mode: "hybrid_deterministic_v1", revision: 2 });
    const audit = await sql`SELECT previous_policy,next_policy,actor_user_id FROM voice_consent_settings_audit`;
    expect(audit).toHaveLength(1); expect(audit[0]).toMatchObject({ actor_user_id: actor, previous_policy: { mode: "semantic_native" }, next_policy: { mode: "hybrid_deterministic_v1" } });
    await sql`UPDATE call_attempts SET consent_runtime_policy=NULL WHERE id=${before.attempt.id}`;
    expect(await second.getConsentRuntimePolicy(before.brief.id, before.attempt.id)).toMatchObject({ mode: "semantic_native", revision: 1 });
    await sql`UPDATE users SET status='suspended' WHERE id=${actor}`;
    await expect(repository.updateVoiceConsentSettings({ ...input, expectedRevision: 2 }, actor)).rejects.toThrow("VOICE_CONSENT_FORBIDDEN");
  } finally { await before?.service.close(); await after?.service.close(); await repository.close(); await second.close(); await sql.end(); }
});
