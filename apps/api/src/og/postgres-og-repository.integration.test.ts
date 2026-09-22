import "../config/load-env";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireTestDatabaseUrl } from "../db/require-test-database";
import { runMigrations } from "../db/migrate";
import { PostgresAuthRepository } from "../auth/postgres-auth-repository";
import { PostgresOgRepository } from "./postgres-og-repository";
import { OgService } from "./og-service";

const url = requireTestDatabaseUrl();
describe("PostgreSQL OG publication", () => {
  const sql = postgres(url, { max: 1 });
  const auth = new PostgresAuthRepository(url);
  let repository: PostgresOgRepository;
  let actorId: string;
  const hashes: string[] = [];
  let initialized = false;
  let initial: { published_id: string | null; previous_id: string | null; draft_id: string | null; revision: number } | undefined;
  beforeAll(async () => {
    await runMigrations(url);
    [initial] = await sql`SELECT * FROM home_og_locales WHERE locale = 'rm'`;
    initialized = true;
    repository = new PostgresOgRepository(url);
    const suffix = randomUUID();
    const actor = await auth.createUser({ email: `og.${suffix}@example.com`, passwordHash: "test", phoneE164: `+417${Date.now().toString().slice(-9)}`, firstName: "OG", lastName: "Test", uiLocale: "en" });
    actorId = actor.id;
  });
  afterAll(async () => {
    if (initialized && initial) {
      await sql`UPDATE home_og_locales SET published_id = ${initial.published_id}, previous_id = ${initial.previous_id},
        draft_id = ${initial.draft_id}, revision = ${initial.revision} WHERE locale = 'rm'`;
    } else if (initialized) await sql`DELETE FROM home_og_locales WHERE locale = 'rm'`;
    if (actorId) {
      await sql`DELETE FROM home_og_audit WHERE actor_user_id = ${actorId}`;
      await sql`DELETE FROM home_og_versions WHERE created_by = ${actorId}`;
      await sql`DELETE FROM home_og_assets WHERE hash IN ${sql(hashes.length ? hashes : ["none"])}
        AND NOT EXISTS (SELECT 1 FROM home_og_versions WHERE asset_hash = home_og_assets.hash)`;
      await sql`DELETE FROM users WHERE id = ${actorId}`;
    }
    await Promise.all([repository?.close(), auth.close(), sql.end()]);
  });
  it("survives reconnect, atomically publishes, rejects races and audits restoration", async () => {
    let service = new OgService(repository);
    const base = await repository.state("rm");
    const first = await service.prepare("rm", actorId, base.revision, { slogan: "Ins na sto betg discurrer." });
    hashes.push(first.draft!.hash);
    const published = await service.publish("rm", first.draft!.id, actorId, first.revision);
    const originalBytes = await repository.image("rm", first.draft!.hash);
    await repository.close();
    repository = new PostgresOgRepository(url); service = new OgService(repository);
    expect((await repository.state("rm")).published!.id).toBe(first.draft!.id);
    expect(await service.published()).toEqual(expect.arrayContaining([
      { locale: "rm", hash: first.draft!.hash, alt: first.draft!.alt }
    ]));
    expect(await repository.image("rm", first.draft!.hash)).toEqual(originalBytes);
    const outcomes = await Promise.allSettled([
      service.prepare("rm", actorId, published.revision, { slogan: "First revision" }),
      service.prepare("rm", actorId, published.revision, { slogan: "Competing revision" })
    ]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const second = await repository.state("rm");
    hashes.push(second.draft!.hash);
    expect(await repository.image("rm", second.draft!.hash)).toBeNull();
    expect(await repository.image("de", second.draft!.hash, true)).toBeNull();
    const changed = await service.publish("rm", second.draft!.id, actorId, second.revision);
    expect(changed.previous!.id).toBe(first.draft!.id);
    await service.publish("rm", first.draft!.id, actorId, changed.revision);
    expect(await repository.image("rm", second.draft!.hash)).toBeInstanceOf(Buffer);
    expect((await repository.state("rm")).published!.id).toBe(first.draft!.id);
    expect(await sql`SELECT action FROM home_og_audit WHERE actor_user_id = ${actorId} ORDER BY id`)
      .toEqual([{ action: "draft" }, { action: "publish" }, { action: "draft" }, { action: "publish" }, { action: "publish" }]);
  });
});
