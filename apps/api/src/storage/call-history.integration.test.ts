import "../config/load-env";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { beforeAll, afterAll, describe } from "vitest";
import { isolatedTestDatabase } from "../db/isolated-test-database";
import { PostgresCallRepository } from "./postgres-call-repository";
import { callHistorySuite } from "./call-history.test-suite";

const db = isolatedTestDatabase();
let sql: postgres.Sql, repository: PostgresCallRepository, sequence = 0;
beforeAll(async () => {
  await db.setup(); sql = postgres(db.url, { max: 2 });
  repository = new PostgresCallRepository(db.url, Buffer.alloc(32, 29));
}, 30000);
afterAll(async () => { await repository?.close(); await sql?.end(); await db.teardown(); });
describe("call history PostgreSQL", () => callHistorySuite(async () => {
  const owner = randomUUID(), other = randomUUID();
  for (const id of [owner, other]) await sql`
    INSERT INTO users(id,email,password_hash,phone_e164,phone_verified_at,first_name,last_name,role,status,ui_locale,created_at)
    VALUES(${id},${`${id}@example.com`},'test-only',${`+4173000${String(++sequence).padStart(4, "0")}`},now(),'Nina','Example','user','active','en',now())`;
  return { repository, owner, other };
}));
