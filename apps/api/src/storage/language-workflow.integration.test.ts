import "../config/load-env";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { CallService } from "../call-service";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "./postgres-call-repository";

const database = isolatedTestDatabase();
let sql: postgres.Sql, repository: PostgresCallRepository, service: CallService;
const owner = randomUUID();
beforeAll(async () => {
  await database.setup();
  sql = postgres(database.url, { max: 1 });
  await sql`INSERT INTO users(id,email,password_hash,phone_e164,phone_verified_at,first_name,last_name,role,status,ui_locale,created_at)
    VALUES(${owner},${`${owner}@example.com`},'test-only','+41710000209',now(),'Nina','Keller','user','active','en',now())`;
  repository = new PostgresCallRepository(database.url, Buffer.alloc(32, 9));
  service = new CallService(repository);
  await service.initialize();
}, 30000);
afterAll(async () => { await service?.close(); await sql?.end(); await database.teardown(); });

it("atomically publishes language metadata beside unchanged plans and preserves manual choice", async () => {
  const input = {
    recipientName: "Gemeinde", phoneNumber: "+41523686688", objective: "Ask which documents are needed for registration",
    assistantProfileId: "sebastian" as const, representedPersonFirstName: "Nina", representedPersonLastName: "Keller",
    locale: "de-CH" as const, allowLanguageSwitch: false, allowedFacts: []
  };
  const request = randomUUID();
  const language = { preferences: { mode: "manual" as const, targetLanguage: "ru" as const, uiLocaleHint: "en" } };
  const preparation = await service.prepare(input, owner, request, language);
  await expect(service.findPreparationByRequest(input, owner, request, language)).resolves.toMatchObject({ id: preparation.id });
  await expect(service.findPreparationByRequest(input, owner, request, { preferences: { mode: "manual", targetLanguage: "uk" } })).rejects.toMatchObject({ code: "CALL_PREPARATION_IDEMPOTENCY_CONFLICT" });
  let callId = "";
  await vi.waitFor(async () => {
    const p = await service.getPreparation(preparation.id, owner);
    expect(p.status).toBe("succeeded"); callId = p.callBriefId!;
  }, { timeout: 8000, interval: 30 });
  const first = (await service.get(callId))!;
  expect(first.languageContext).toMatchObject({ taskContentLanguage: "ru", selectionSource: "task", compilationRevision: 1 });
  const originalHash = first.compilation!.snapshotHash;
  await repository.updateContentLanguage(callId, "uk", 1);
  expect((await service.get(callId))?.compilation?.snapshotHash).toBe(originalHash);
  await expect(repository.updateContentLanguage(callId, "fr", 1)).rejects.toMatchObject({ code: "CALL_LANGUAGE_STALE" });
  const next = await service.recompile(callId, { ...input, objective: input.objective + " next week" }, owner, randomUUID(), { preferences: { mode: "auto", uiLocaleHint: "de" } });
  await vi.waitFor(async () => { expect((await service.getPreparation(next.id, owner)).status).toBe("succeeded"); }, { timeout: 8000, interval: 30 });
  expect((await service.get(callId))?.languageContext).toMatchObject({ taskContentLanguage: "uk", selectionRevision: 2, compilationRevision: 2 });
  const [stored] = await sql`SELECT count(*)::int AS count FROM call_preparation_language_contexts`;
  expect(stored?.count).toBe(2);
}, 20000);
