import "../config/load-env";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { ContentService } from "./content-service";
import { PostgresContentRepository } from "./postgres-content-repository";
import { buildPublicContentReleaseCandidate } from "./public-content-release";
import { stagePublicContentRelease } from "./public-content-staging";

const database = isolatedTestDatabase(), actor = randomUUID();
let sql: postgres.Sql, repository: PostgresContentRepository, service: ContentService;
beforeAll(async () => {
  await database.setup();
  sql = postgres(database.url, { max: 1 });
  await sql`INSERT INTO users(id,email,password_hash,phone_e164,phone_verified_at,first_name,last_name,role,status,ui_locale,created_at)
    VALUES(${actor},${`${actor}@example.com`},'test-only','+41710000312',now(),'Test','Editor','content_editor','active','en',now())`;
  repository = new PostgresContentRepository(database.url);
  service = new ContentService(repository);
  await service.initialize();
}, 30000);
afterAll(async () => { await repository?.close(); await sql?.end(); await database.teardown(); });

it("stages only verified-source new drafts atomically, preserves AUP and is replay-safe", async () => {
  await service.createDraft(actor, "acceptable_use");
  const aup = await service.getAdminPage("acceptable_use", "en");
  const candidate = await buildPublicContentReleaseCandidate(service);
  const dry = await stagePublicContentRelease(database.url, candidate);
  expect(dry.mode).toBe("dry_run");
  expect(dry.rows.filter(row => row.state === "ready")).toHaveLength(6);
  expect((await service.getAdminPage("privacy", "en")).draft).toBeNull();
  await expect(stagePublicContentRelease(database.url, candidate, { apply: true })).rejects.toThrow("explicitly identified");
  await expect(stagePublicContentRelease(database.url, candidate, { apply: true, actorUserId: randomUUID() })).rejects.toThrow("not an active");

  const invalid = structuredClone(candidate);
  invalid.pages = invalid.pages.filter(page => page.key === "privacy");
  invalid.collections = [];
  invalid.pages[0]!.translations[0]!.payload.requiresReacceptance = true;
  await expect(stagePublicContentRelease(database.url, invalid, { apply: true, actorUserId: actor }))
    .rejects.toMatchObject({ code: "CONTENT_REACCEPTANCE_INVALID" });
  expect((await service.getAdminPage("privacy", "en")).draft).toBeNull();

  const applied = await stagePublicContentRelease(database.url, candidate, { apply: true, actorUserId: actor });
  expect(applied.published).toBe(false);
  expect(applied.rows.filter(row => row.state === "staged")).toHaveLength(6);
  expect(await service.getAdminPage("acceptable_use", "en")).toEqual(aup);
  const privacy = await service.getAdminPage("privacy", "de");
  expect(privacy.published?.revision.id).toBe(candidate.pages.find(page => page.key === "privacy")!.translations[1]!.sourceRevisionId);
  expect(privacy.draft?.revision.status).toBe("draft");
  expect(privacy.draft?.revision.sourceRevisionNumber).toBe(privacy.draft?.revision.number);
  const replay = await stagePublicContentRelease(database.url, candidate, { apply: true, actorUserId: actor });
  expect(replay.rows.every(row => row.state === "draft_preserved")).toBe(true);
  const stale = structuredClone(candidate);
  stale.pages[0]!.translations[0]!.sourceRevisionId = randomUUID();
  expect((await stagePublicContentRelease(database.url, stale)).rows[0]!.state).toBe("source_changed");
}, 30000);
