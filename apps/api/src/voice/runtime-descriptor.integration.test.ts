import "../config/load-env";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { approvedCall } from "./voice-test-helpers";
import { liveRuntimeDescriptor } from "./runtime-descriptor";
import type { VoiceConversationContext } from "./voice-runtime";

describe("runtime descriptor persistence privacy", () => {
  const db = isolatedTestDatabase(), key = Buffer.alloc(32, 11), owner = randomUUID();
  const sql = postgres(db.url, { max: 2, onnotice: () => undefined });
  const repository = new PostgresCallRepository(db.url, key);
  beforeAll(async () => {
    await db.setup();
    await sql`INSERT INTO users(id,email,password_hash,phone_e164,first_name,last_name,role,status,ui_locale,phone_verified_at,created_at)
      VALUES(${owner},${`${owner}@example.test`},'fixture',${`fixture:${owner}`},'Runtime','Test','user','active','en',now(),now())`;
  }, 30000);
  afterAll(async () => { await Promise.all([repository.close(), sql.end()]); await db.teardown(); });

  it("preserves first-write metadata, scrubs it on deletion and refuses stale runtime initialization", async () => {
    const call = await approvedCall(undefined, repository);
    try {
      await sql`UPDATE call_briefs SET user_id=${owner} WHERE id=${call.brief.id}`;
      await sql`UPDATE call_attempts SET user_id=${owner} WHERE id=${call.attempt.id}`;
      const snapshot = (await repository.get(call.brief.id))!;
      const descriptor = liveRuntimeDescriptor({ brief: snapshot.brief, snapshot: call.snapshot } as VoiceConversationContext,
        snapshot.compilation!, "fixture runtime prompt", { live: "gpt-live-1", delegation: "gpt-6-luna", speech: "gpt-4o-mini-tts" }, {});
      await repository.recordRuntimeDescriptor(call.brief.id, call.attempt.id, descriptor);
      await repository.recordRuntimeDescriptor(call.brief.id, call.attempt.id, { ...descriptor, promptHash: "b".repeat(64) });
      expect((await sql`SELECT runtime_descriptor FROM call_attempts WHERE id=${call.attempt.id}`)[0]!.runtime_descriptor).toEqual(descriptor);
      await repository.updateStatus(call.brief.id, "completed");
      await repository.deleteCallData({ callId: call.brief.id, userId: owner, requestId: randomUUID(),
        providerRecordingDisposition: "not_present", deletedAt: new Date().toISOString() });
      expect((await sql`SELECT runtime_descriptor FROM call_attempts WHERE id=${call.attempt.id}`)[0]!.runtime_descriptor).toBeNull();
      await expect(repository.recordRuntimeDescriptor(call.brief.id, call.attempt.id, descriptor)).rejects.toMatchObject({ code: "CALL_NOT_FOUND" });
      expect((await sql`SELECT runtime_descriptor FROM call_attempts WHERE id=${call.attempt.id}`)[0]!.runtime_descriptor).toBeNull();
    } finally { await call.service.close(); }
  });
});
