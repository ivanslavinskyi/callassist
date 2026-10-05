import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "./postgres-call-repository";
import type { DurableJob } from "../jobs/durable-job";
import type { CreateCallBriefInput } from "@callassist/contracts";

const input: CreateCallBriefInput = { recipientName: "Test office", phoneNumber: "+41710000064", objective: "Ask about opening hours",
  assistantProfileId: "sebastian", representedPersonFirstName: "Nina", representedPersonLastName: "Keller", assistanceReason: "speech_impairment",
  locale: "en-GB", allowLanguageSwitch: false, allowedFacts: [] };
describe("preparation admission across PostgreSQL connections", () => {
  const database = isolatedTestDatabase();
  let sql: postgres.Sql, first: PostgresCallRepository, second: PostgresCallRepository;
  const owners = Array.from({ length: 10 }, () => randomUUID());
  beforeAll(async () => {
    await database.setup(); sql = postgres(database.url, { max: 2 });
    first = new PostgresCallRepository(database.url, Buffer.alloc(32,7));
    second = new PostgresCallRepository(database.url, Buffer.alloc(32,7));
    for (const [index,id] of owners.entries()) await sql`INSERT INTO users(id,email,password_hash,phone_e164,first_name,last_name,role,status,ui_locale,created_at,phone_verified_at)
      VALUES(${id},${`${id}@example.test`},'test',${`+4171000${String(index).padStart(4,'0')}`},'Test','Owner',${index === 0 ? 'superadmin' : 'user'},'active','en',now(),now())`;
  });
  afterAll(async () => { await Promise.all([first?.close(),second?.close(),sql?.end()]); await database.teardown(); });
  afterEach(() => { vi.unstubAllEnvs(); });
  const enqueue = (userId: string, key = randomUUID()) => first.enqueueCallPreparation({ userId, idempotencyKey: key,
    inputFingerprint: "a".repeat(64), input, now: new Date().toISOString() });
  const claim = (repo: PostgresCallRepository, workerId: string = randomUUID()) => repo.claimDueDurableJob({ types: ["brief_compilation"],
    workClasses: ["preparation"], useDatabaseTime: true, workerId, now: new Date().toISOString(), leaseExpiresAt: new Date(Date.now()+120000).toISOString() });
  const fence = (job: DurableJob) => ({ jobId: job.id, workerId: job.leaseOwner!, generation: job.generation,
    attemptNumber: job.attemptCount, checkedAt: new Date().toISOString() });

  it("admits ten users but claims at most four across two pools; one slot per owner", async () => {
    await Promise.all(owners.map(id => enqueue(id)));
    const claims = (await Promise.all(Array.from({ length: 10 }, (_,i) => claim(i%2 ? first : second)))).filter((j): j is DurableJob => j !== null);
    expect(claims).toHaveLength(4);
    const work = await Promise.all(claims.map(j => first.claimCallPreparation(j.callPreparationId!,fence(j))));
    expect(new Set(work.map(w => w.userId)).size).toBe(4);
    await Promise.all(claims.map(j => first.failDurableJob(j.id,j.leaseOwner!,"TEST_FINISHED",new Date().toISOString(),new Date().toISOString(),false,false,fence(j))));
  });
  it("pins existing policy and serializes concurrent model switches without reports", async () => {
    const settings = await first.getPreparationSettings();
    const updates = await Promise.allSettled([first,second].map(repo => repo.updatePreparationSettings({ generation: {model:"gpt-6-luna",serviceTier:"fast"},
      capacity: { ...settings.capacity, generationSlots: 2 }, expectedRevision: settings.policy.revision, reason: "test capacity" },owners[0]!)));
    expect(updates.filter(r=>r.status === "fulfilled")).toHaveLength(1);
    expect((await first.getPreparationSettings()).history).toHaveLength(1);
    const [row] = await sql`SELECT runtime_policy FROM call_preparation_requests ORDER BY created_at LIMIT 1`;
    expect(row!.runtime_policy.revision).toBe(1);
    await expect(sql`UPDATE call_preparation_requests SET runtime_policy=jsonb_set(runtime_policy,'{revision}','9')`).rejects.toMatchObject({ message: "PREPARATION_SNAPSHOT_IMMUTABLE" });
  });
  it("rejects stale fences even if the same owner string is reused", async () => {
    const job = (await claim(first,"same-worker"))!; expect(job).not.toBeNull();
    await sql`UPDATE durable_jobs SET run_after=now()+interval '1 hour' WHERE id<>${job.id} AND status='queued'`;
    await sql`UPDATE durable_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=${job.id}`;
    const newer = (await claim(second,"same-worker"))!;
    expect(newer.id).toBe(job.id); expect(newer.attemptCount).toBe(job.attemptCount+1);
    expect(await first.renewDurableJobLease(job.id,"same-worker",new Date().toISOString(),new Date(Date.now()+120000).toISOString(),fence(job))).toBe(false);
    await expect(first.claimCallPreparation(job.callPreparationId!,fence(job))).rejects.toMatchObject({ code: "DURABLE_JOB_LEASE_LOST" });
    if (newer) await first.failDurableJob(newer.id,newer.leaseOwner!,"TEST_FINISHED",new Date().toISOString(),new Date().toISOString(),false,false,fence(newer));
    await sql`UPDATE durable_jobs SET run_after=now() WHERE status='queued'`;
  });
  it("preserves replay at a full per-user queue and excludes review work from operations workers", async () => {
    const key=randomUUID(), owner=randomUUID();
    await sql`INSERT INTO users(id,email,password_hash,phone_e164,first_name,last_name,role,status,ui_locale,created_at,phone_verified_at) VALUES(${owner},${`${owner}@example.test`},'test','+41719999999','Test','Owner','user','active','en',now(),now())`;
    const original=await enqueue(owner,key); await enqueue(owner);
    expect((await enqueue(owner,key)).id).toBe(original.id);
    await expect(enqueue(owner)).rejects.toMatchObject({ message: "PREPARATION_USER_QUEUE_FULL" });
    expect(await first.claimDueDurableJob({ types:["brief_compilation"],workClasses:["operations"],workerId:"ops",now:new Date().toISOString(),leaseExpiresAt:new Date(Date.now()+120000).toISOString() })).toBeNull();
  });
  it("pins an operator model choice without requiring local testing", async () => {
    vi.stubEnv("PREPARATION_LOCAL_TESTING","true"); vi.stubEnv("NODE_ENV","development");
    vi.stubEnv("API_HOST","127.0.0.1"); vi.stubEnv("DATABASE_URL",database.url);
    const settings = await first.getPreparationSettings();
    const update = {generation:{model:"gpt-6-luna" as const,serviceTier:"fast" as const},capacity:settings.capacity,
      expectedRevision:settings.policy.revision,reason:"Local manual test"};
    await expect(first.updatePreparationSettings(update,owners[1]!)).rejects.toMatchObject({code:"PREPARATION_FORBIDDEN"});
    const saved = await first.updatePreparationSettings(update,owners[0]!);
    expect(saved.localTesting).toBeUndefined();
    expect(saved.approvedProfiles).toEqual(["gpt-5.6:default"]);
    expect(saved.history[0]).toMatchObject({localTest:false,reportSha256:null,actorUserId:owners[0]});
    const request = await enqueue(owners[9]!);
    const [pinned] = await sql`select runtime_policy from call_preparation_requests where id=${request.id}`;
    expect(pinned!.runtime_policy.generation).toEqual(update.generation);
    vi.stubEnv("PREPARATION_LOCAL_TESTING","false");
    expect((await second.getPreparationSettings()).history[0]!.localTest).toBe(false);
    await expect(second.updatePreparationSettings({...update,expectedRevision:saved.policy.revision},owners[0]!))
      .resolves.toMatchObject({policy:{generation:update.generation}});
  });
});
