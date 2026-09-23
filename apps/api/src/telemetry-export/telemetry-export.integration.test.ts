import "../config/load-env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import postgres from "postgres";
import { normalizeCreateCallBriefInput, type CreateCallBriefInput, type TelemetryExportInput } from "@callassist/contracts";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "../storage/postgres-call-repository";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { encryptJson } from "../security/encryption";
import { TelemetryExportService } from "./service";
import { exportSources, sourceQuery } from "./sources";
import { buildTelemetryArchive } from "./archive";
import { buildApp } from "../app";
import { CallService } from "../call-service";
import { AuthService, hashSessionToken } from "../auth/auth-service";
import { PostgresAuthRepository } from "../auth/postgres-auth-repository";
import { MockVerificationProvider } from "../auth/verification-provider";

describe("durable telemetry export", () => {
  const db = isolatedTestDatabase();
  const key = Buffer.alloc(32, 7), actor = randomUUID(), owner = randomUUID(), stranger = randomUUID();
  const sql = postgres(db.url, { max: 3, onnotice: () => undefined });
  const repository = new PostgresCallRepository(db.url, key);
  const service = new TelemetryExportService(db.url, key);
  let callId: string, attemptId: string, preparationId: string, operationId: string;
  const request = (): TelemetryExportInput => ({ requestId: randomUUID(), reason: "Integration quality review", timezone: "Europe/Zurich", preset: "last7" });
  async function archive(id: string) {
    const chunks: Buffer[] = [];
    for await (const buffer of service.download(actor, id, async () => true)) chunks.push(buffer);
    return unzipSync(Buffer.concat(chunks));
  }
  function lines(files: Record<string, Uint8Array>, table: string): Array<{ data: Record<string, unknown>; selectedInPeriod?: boolean; availability?: string }> {
    return strFromU8(files[`data/${table}.jsonl`]!).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  }
  beforeAll(async () => {
    await db.setup();
    for (const [id, role] of [[actor, "superadmin"], [owner, "user"], [stranger, "superadmin"]]) {
      await sql`INSERT INTO users(id,email,password_hash,phone_e164,first_name,last_name,role,status,ui_locale,created_at)
        VALUES(${id!},${`${id}@example.test`},'private-password-hash',${`fixture:${id}`},'Export','Test',${role!},'active','en',now())`;
    }
    await sql`UPDATE users SET phone_verified_at=now() WHERE id IN (${owner},${actor},${stranger})`;
    await repository.grantSignupCredits(owner);
    const input: CreateCallBriefInput = { recipientName: "Test clinic", phoneNumber: "+41710000001", objective: "Ask opening hours",
      context: "Private Unicode context: Привет\nsecond line", assistantProfileId: "sebastian", representedPersonFirstName: "Test", representedPersonLastName: "Caller",
      assistanceReason: "none", locale: "en-GB", allowLanguageSwitch: false, allowedFacts: ["Private approved fact"] };
    const call = await repository.create(input, await new DeterministicBriefCompiler().compile(normalizeCreateCallBriefInput(input)), owner);
    callId = call.id;
    await sql`UPDATE call_briefs SET created_at=now()-interval '40 days' WHERE id=${callId}`;
    await repository.approveCompilation(callId, await originalPlanReview(repository, callId));
    const attempt = await repository.startAttempt(callId, { provider: "twilio" }); attemptId = attempt.attempt.id;
    const providerCallId = `CA-${randomUUID()}`, providerRecordingId = `RE-${randomUUID()}`;
    await repository.attachProviderCall(attemptId, providerCallId, "in-progress");
    const recording = await repository.beginRecording(callId);
    await repository.attachProviderRecording(recording.recording.id, providerRecordingId, "in-progress");
    await repository.applyRecordingStatus({ callBriefId: callId, recordingId: recording.recording.id, providerCallId, providerRecordingId, providerStatus: "completed", durationSeconds: 20, channels: 2 });
    await repository.claimFinalTranscript(recording.recording.id, "test-asr");
    await repository.completeFinalTranscript(recording.recording.id, "First immutable transcript.\nOffice opens at nine.", []);
    await repository.claimFinalTranscript(recording.recording.id, "test-asr-v2", true);
    await repository.completeFinalTranscript(recording.recording.id, "Revised immutable transcript. Office opens at ten.", []);
    await repository.updateStatus(callId, "completed");
    preparationId = randomUUID(); operationId = randomUUID();
    await sql`INSERT INTO call_preparation_requests(id,user_id,idempotency_key,input_fingerprint,status,failure_code,completed_at)
      VALUES(${preparationId},${owner},${randomUUID()},${"a".repeat(64)},'failed','PROVIDER_FAILED',now())`;
    await sql`INSERT INTO provider_operations(id,provider,operation_type,stage,requested_model,client_request_id,call_preparation_id,started_at)
      VALUES(${operationId},'openai','brief_compilation','compile','fixture-model',${randomUUID()},${preparationId},now())`;
    await sql`INSERT INTO provider_operation_results(operation_id,outcome,error_code,completed_at,duration_ms)
      VALUES(${operationId},'provider_error','PROVIDER_FAILED',now(),100)`;
    await sql`INSERT INTO provider_usage_records(id,operation_id,schema_version,request_count,input_text_tokens,raw_usage,observed_at)
      VALUES(${randomUUID()},${operationId},1,1,25,${sql.json({ input_tokens: 25, unsafe: "secret-provider-header" })},now())`;
    await sql`INSERT INTO provider_cost_records(id,operation_id,provider,provider_cost_id,cost_basis,component,amount_micros,currency,raw_cost,observed_at)
      VALUES(${randomUUID()},${operationId},'openai',${randomUUID()},'provider_reported_actual','text',100,'USD','{}',now())`;
  }, 30000);
  afterAll(async () => { await Promise.all([service.close(), repository.close(), sql.end()]); await db.teardown(); });

  it("uses real migrated columns for every allowlisted source", async () => {
    for (const source of exportSources) {
      await expect(sql.unsafe(`${sourceQuery(source)} LIMIT 0`, ["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"]), source.table).resolves.toBeDefined();
    }
  });
  it.each([
    { at: "2026-09-23T00:00:00.000Z", id: "-".repeat(36) },
    { at: "2026-09-23T00:00:00.000Z", id: "a".repeat(36) },
    { at: 123, id: "12345678-1234-4123-8123-123456789abc" },
    { at: "2026-02-30T00:00:00.000Z", id: "12345678-1234-4123-8123-123456789abc" },
    { at: "2026-09-23T00:00:00.000Z", id: null }
  ])("rejects malformed export cursors as client input errors: %j", async cursor => {
    await expect(service.list(actor, Buffer.from(JSON.stringify(cursor)).toString("base64url")))
      .rejects.toMatchObject({ code: "EXPORT_INVALID_CURSOR", status: 400 });
  });
  it("exports the complete retained cohort, revisions and orphan preparation with verified ZIP checksums", async () => {
    const input = request();
    const created = await service.create(actor, input);
    expect((await service.create(actor, input)).id).toBe(created.id);
    await expect(service.create(actor, { ...input, reason: "Different reason" })).rejects.toThrow("EXPORT_IDEMPOTENCY_CONFLICT");
    await expect(service.create(actor, request())).rejects.toThrow("EXPORT_ALREADY_ACTIVE");
    await service.runOnce();
    const result = await service.get(actor, created.id);
    expect(result.status, JSON.stringify(result)).toBe("ready");
    expect(result.counts.selected_attempts).toBe(1);
    const files = await archive(created.id);
    expect(lines(files, "call_briefs")[0]!.data.context).toContain("Привет\nsecond line");
    expect(lines(files, "call_attempts")[0]).toMatchObject({ selectedInPeriod: true, data: { id: attemptId } });
    expect(lines(files, "final_transcript_revisions")).toHaveLength(2);
    expect(lines(files, "call_preparation_requests").some(row => row.data.id === preparationId)).toBe(true);
    expect(lines(files, "provider_operations").some(row => row.data.id === operationId)).toBe(true);
    expect(lines(files, "provider_cost_records")[0]!.data.amount_micros).toBe("100");
    const plain = Object.values(files).map(bytes => strFromU8(bytes)).join("");
    expect(plain).not.toContain("private-password-hash"); expect(plain).not.toContain("secret-provider-header");
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!));
    for (const file of manifest.files) expect(createHash("sha256").update(files[file.path]!).digest("hex")).toBe(file.sha256);
    const [part] = await sql`SELECT payload_ciphertext FROM admin_telemetry_export_parts WHERE export_id=${created.id} LIMIT 1`;
    expect(String(part!.payload_ciphertext)).not.toContain("Private");
    await expect(service.get(stranger, created.id)).rejects.toThrow("EXPORT_NOT_FOUND");
    await expect(service.create(owner, request())).rejects.toThrow("EXPORT_FORBIDDEN");
    await service.cancel(actor, created.id);
  });
  it("keeps a single snapshot while processing concurrently changes", async () => {
    let changed = false;
    const buffers: Buffer[] = [];
    await service.reader.begin("isolation level repeatable read read only", async tx => {
      await buildTelemetryArchive(tx, { id: randomUUID(), from: new Date(Date.now() - 7 * 86400000).toISOString(), to: new Date(Date.now() + 1000).toISOString(), createdAt: new Date().toISOString(), generation: 1 }, key,
        async buffer => { buffers.push(buffer); }, async () => {
          if (!changed) { changed = true; await sql`UPDATE call_briefs SET context_ciphertext=${encryptJson("NEW CONTEXT", key)} WHERE id=${callId}`; }
        });
    });
    expect(lines(unzipSync(Buffer.concat(buffers)), "call_briefs")[0]!.data.context).toContain("Private Unicode");
  });
  it("enforces HTTP authorization, origin, ownership and non-cacheable streamed downloads", async () => {
    const token = randomUUID(), ownerToken = randomUUID(), strangerToken = randomUUID();
    for (const [userId, value] of [[actor, token], [owner, ownerToken], [stranger, strangerToken]]) {
      await sql`INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at,last_seen_at)
        VALUES(${randomUUID()},${userId!},${hashSessionToken(value!)},now()+interval '1 hour',now(),now())`;
    }
    const httpExports = new TelemetryExportService(db.url, key);
    const httpCalls = new PostgresCallRepository(db.url, key);
    const app = buildApp({ logger: false, webOrigin: "http://localhost:3000", telemetryExports: httpExports,
      service: new CallService(httpCalls), authService: new AuthService({ repository: new PostgresAuthRepository(db.url), verificationProvider: new MockVerificationProvider(), signupCreditGranter: httpCalls }) });
    try {
      const route = "/api/admin/telemetry-exports", headers = { cookie: `callassist_session=${token}`, origin: "http://localhost:3000" };
      expect((await app.inject({ url: route })).statusCode).toBe(401);
      expect((await app.inject({ url: route, headers: { cookie: `callassist_session=${ownerToken}` } })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url: route, headers: { ...headers, origin: "https://untrusted.example" }, payload: request() })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url: route, headers, payload: { ...request(), reason: "x" } })).statusCode).toBe(400);
      const result = await app.inject({ method: "POST", url: route, headers, payload: request() });
      expect(result.statusCode).toBe(202); const id = result.json().id;
      expect((await app.inject({ url: `${route}/${id}/download`, headers })).statusCode).toBe(409);
      await httpExports.runOnce();
      expect((await app.inject({ url: `${route}/${id}/download`, headers: { cookie: `callassist_session=${strangerToken}` } })).statusCode).toBe(404);
      const downloaded = await app.inject({ url: `${route}/${id}/download`, headers });
      expect(downloaded.statusCode).toBe(200);
      expect(downloaded.headers["content-type"]).toBe("application/zip");
      expect(downloaded.headers["cache-control"]).toBe("private, no-store");
      expect(unzipSync(downloaded.rawPayload)["manifest.json"]).toBeDefined();
      await expect.poll(async () => (await sql`SELECT id FROM admin_telemetry_export_events WHERE export_id=${id} AND action='download_completed'`).length).toBe(1);
      await sql`UPDATE admin_telemetry_export_parts SET sha256=${"0".repeat(64)} WHERE export_id=${id} AND part=0`;
      const corrupted = await app.inject({ url: `${route}/${id}/download`, headers });
      expect(corrupted.statusCode).toBe(409);
      expect(corrupted.json()).toMatchObject({ code: "EXPORT_INTEGRITY_FAILED" });
      expect((await sql`SELECT id FROM admin_telemetry_export_events WHERE export_id=${id} AND action='download_interrupted'`).length).toBe(1);
      expect((await sql`SELECT id FROM admin_telemetry_export_events WHERE export_id=${id} AND action='download_completed'`).length).toBe(1);
      await sql`UPDATE sessions SET revoked_at=now() WHERE token_hash=${hashSessionToken(token)}`;
      expect((await app.inject({ url: `${route}/${id}/download`, headers })).statusCode).toBe(401);
      await httpExports.cancel(actor, id);
    } finally { await app.close(); }
  });
  it("expires files even if cleanup has not run, then removes encrypted parts", async () => {
    const created = await service.create(actor, request()); await service.runOnce();
    expect((await service.get(actor, created.id)).status).toBe("ready");
    await sql`UPDATE admin_telemetry_exports SET expires_at=now()-interval '1 second' WHERE id=${created.id}`;
    expect((await service.get(actor, created.id)).status).toBe("expired");
    await expect(archive(created.id)).rejects.toThrow("EXPORT_NOT_READY");
    await service.cleanup();
    expect((await sql`SELECT id FROM admin_telemetry_export_parts WHERE export_id=${created.id}`).length).toBe(0);
  });
  it("recovers an expired worker lease and publishes only the next generation", async () => {
    const created = await service.create(actor, request());
    await sql`UPDATE admin_telemetry_exports SET status='running',generation=1,lease_token=${randomUUID()},lease_until=now()-interval '1 second' WHERE id=${created.id}`;
    await Promise.all([service.runOnce(), service.runOnce()]);
    expect(await service.get(actor, created.id)).toMatchObject({ status: "ready", generation: 2 });
    await service.cancel(actor, created.id);
  });
  it("fails closed on ciphertext corruption without publishing a partial ZIP", async () => {
    const [original] = await sql`SELECT context_ciphertext FROM call_briefs WHERE id=${callId}`;
    await sql`UPDATE call_briefs SET context_ciphertext='invalid-ciphertext' WHERE id=${callId}`;
    const created = await service.create(actor, request()); await service.runOnce();
    expect(await service.get(actor, created.id)).toMatchObject({ status: "failed", failureCode: "EXPORT_SOURCE_DECRYPTION_FAILED", retryable: false });
    expect((await sql`SELECT id FROM admin_telemetry_export_parts WHERE export_id=${created.id}`).length).toBe(0);
    await sql`UPDATE call_briefs SET context_ciphertext=${String(original!.context_ciphertext)} WHERE id=${callId}`;
  });
  it("streams bounded encrypted parts, detects corruption, and stops between parts on revocation", async () => {
    const segment = randomUUID();
    await sql`INSERT INTO transcript_segments(id,call_brief_id,role,text,locale,final,created_at)
      VALUES(${segment},${callId},'recipient',${randomBytes(2 * 1024 * 1024).toString("hex")},'en-GB',true,now())`;
    const created = await service.create(actor, request()); await service.runOnce();
    expect((await service.get(actor, created.id)).status).toBe("ready");
    const parts = await sql`SELECT part,byte_count,sha256 FROM admin_telemetry_export_parts WHERE export_id=${created.id} ORDER BY part`;
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every(p => Number(p.byte_count) <= 1048576)).toBe(true);
    const firstHash = String(parts[0]!.sha256);
    await sql`UPDATE admin_telemetry_export_parts SET sha256=${"0".repeat(64)} WHERE export_id=${created.id} AND part=0`;
    await expect(archive(created.id)).rejects.toThrow("EXPORT_INTEGRITY_FAILED");
    await sql`UPDATE admin_telemetry_export_parts SET sha256=${firstHash} WHERE export_id=${created.id} AND part=0`;
    const iterator = service.download(actor, created.id, async () => true);
    expect((await iterator.next()).value?.length).toBe(1048576);
    await sql`UPDATE users SET status='suspended' WHERE id=${owner}`;
    await expect(iterator.next()).rejects.toThrow("EXPORT_REVOKED");
    await sql`UPDATE users SET status='active' WHERE id=${owner}`;
    await sql`DELETE FROM transcript_segments WHERE id=${segment}`;
  });
  it("never publishes a generation revoked during capture", async () => {
    const created = await service.create(actor, request());
    const running = service.runOnce();
    const deadline = Date.now() + 5000;
    while ((await service.get(actor, created.id)).status === "queued" && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    await sql`UPDATE users SET status='suspended' WHERE id=${owner}`;
    await running;
    expect((await service.get(actor, created.id)).status).toBe("revoked");
    expect((await sql`SELECT id FROM admin_telemetry_export_parts WHERE export_id=${created.id}`).length).toBe(0);
    await sql`UPDATE users SET status='active' WHERE id=${owner}`;
  });
  it("revokes a prepared file on role change and a queued file before deletion membership exists", async () => {
    const created = await service.create(actor, request()); await service.runOnce();
    await sql`UPDATE users SET role='admin' WHERE id=${actor}`;
    expect((await service.get(actor, created.id)).status).toBe("revoked");
    await expect(archive(created.id)).rejects.toThrow("EXPORT_NOT_READY");
    expect((await sql`SELECT id FROM admin_telemetry_export_parts`).length).toBe(0);
    await sql`UPDATE users SET role='superadmin' WHERE id=${actor}`;
    // The hourly admission budget is tested separately; allow this larger suite.
    await sql`UPDATE admin_telemetry_exports SET created_at=now()-interval '2 hours' WHERE actor_user_id=${actor}`;
    const queued = await service.create(actor, request());
    await repository.deleteCallData({ callId, userId: owner, requestId: randomUUID(), deletedAt: new Date().toISOString(), providerRecordingDisposition: "deleted" });
    expect((await service.get(actor, queued.id)).status).toBe("revoked");
    const afterDeletion = await service.create(actor, request()); await service.runOnce();
    const files = await archive(afterDeletion.id);
    expect(lines(files, "call_briefs")[0]!.availability).toBe("deleted_or_deletion_pending");
    expect(lines(files, "final_transcript_revisions")).toHaveLength(0);
    expect(Object.values(files).map(bytes => strFromU8(bytes)).join("")).not.toContain("NEW CONTEXT");
    await service.cancel(actor, afterDeletion.id);
  });
  it("revokes on an account deletion request before the source calls are erased", async () => {
    const created = await service.create(actor, request()); await service.runOnce();
    await sql`INSERT INTO account_deletion_requests(id,user_id,status,max_attempts,run_after,requested_at,updated_at)
      VALUES(${randomUUID()},${owner},'queued',5,now(),now(),now())`;
    expect((await service.get(actor, created.id)).status).toBe("revoked");
    const fresh = await service.create(actor, request()); await service.runOnce();
    const files = await archive(fresh.id);
    expect(lines(files, "call_preparation_requests")).toHaveLength(0);
    expect(lines(files, "provider_operations")).toHaveLength(0);
    await service.cancel(actor, fresh.id);
  });
  it("creates a valid empty archive and enforces admission limits", async () => {
    const created = await service.create(actor, { ...request(), preset: "custom", dateFrom: "2000-01-01", dateTo: "2000-01-01" }); await service.runOnce();
    expect((await service.get(actor, created.id)).counts.selected_attempts).toBe(0);
    expect(lines(await archive(created.id), "call_events")).toHaveLength(0);
    await service.cancel(actor, created.id);
    await sql`UPDATE admin_telemetry_exports SET created_at=now() WHERE actor_user_id=${actor}`;
    await expect(service.create(actor, request())).rejects.toThrow("EXPORT_CAPACITY_REACHED");
  });
  it("paginates without losing exports created within the same millisecond", async () => {
    const ids: string[] = Array.from({ length: 21 }, () => randomUUID());
    for (const id of ids) {
      await sql`INSERT INTO admin_telemetry_exports(id,actor_user_id,request_id,input_hash,reason,from_at,to_at,status,created_at)
        VALUES(${id},${stranger},${randomUUID()},'fixture','Pagination test','2020-01-01','2020-01-02','cancelled','2030-01-01T00:00:00.123456Z')`;
    }
    const first = await service.list(stranger);
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const second = await service.list(stranger, first.nextCursor!);
    const seen = [...first.items, ...second.items].map(item => item.id).filter(id => ids.includes(id));
    expect(seen).toHaveLength(21);
    expect(new Set(seen).size).toBe(21);
    expect((await service.list(owner)).items).toHaveLength(0);
  });
});
