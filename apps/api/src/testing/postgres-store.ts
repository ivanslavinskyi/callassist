import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type { TestScenario, TestScenarioInput, User, TestScenarioSelection, TestingAttribution } from "@callassist/contracts";
import { testScenarioSchema } from "@callassist/contracts";
import { decryptJson, encryptJson, type DataEncryptionMaterial } from "../security/encryption";
import { effectiveTestingAccess, TestingError, type TestingStore } from "./store";
type Sql = postgres.Sql | postgres.TransactionSql;
export class PostgresTestingStore implements TestingStore {
  readonly sql: postgres.Sql;
  constructor(url: string, private readonly key: DataEncryptionMaterial) { this.sql = postgres(url, { max: 3, onnotice: () => undefined }); }
  async user(sql: Sql, id: string, lock = false) {
    const rows = await sql<Pick<User,"role"|"status">[]>`SELECT role,status FROM users WHERE id=${id} ${lock ? sql`FOR UPDATE` : sql``}`;
    return rows[0] ?? null;
  }
  async admin(sql: Sql, id: string) {
    const user = await this.user(sql, id, true);
    if (user?.role !== "superadmin" || user.status !== "active") throw new TestingError("TESTING_FORBIDDEN", 403);
  }
  async access(id: string) {
    const user = await this.user(this.sql, id);
    const [grant] = await this.sql<{ enabled: boolean; revision: number }[]>`SELECT enabled,revision FROM testing_access WHERE user_id=${id}`;
    return effectiveTestingAccess(user, grant);
  }
  async attribution(userId:string, objective:string, selection?:TestScenarioSelection):Promise<TestingAttribution> {
    const access=await this.access(userId);
    if(selection&&!access.enabled) throw new TestingError("SCENARIO_SELECTION_UNAVAILABLE",403);
    const [row]=selection?await this.sql<{payload:string}[]>`SELECT payload_ciphertext AS payload FROM test_scenario_revisions WHERE scenario_id=${selection.id} AND revision=${selection.revision}`:[];
    if(selection&&!row) throw new TestingError("SCENARIO_SELECTION_UNAVAILABLE",403);
    const scenario=row?testScenarioSchema.parse(decryptJson(row.payload,this.key)):null;
    return {tester:access.enabled,byRole:access.byRole,scenario:selection??null,objectiveModified:scenario?objective!==scenario.objective:null};
  }
  async recordPreparation(id:string, attribution:TestingAttribution) {
    await this.sql`INSERT INTO testing_preparation_attribution(preparation_id,tester,by_role,scenario_id,scenario_revision,objective_modified)
      VALUES(${id},${attribution.tester},${attribution.byRole},${attribution.scenario?.id??null},${attribution.scenario?.revision??null},${attribution.objectiveModified}) ON CONFLICT DO NOTHING`;
  }
  async setAccess(actorId: string, targetId: string, enabled: boolean, expectedRevision: number) {
    return this.sql.begin(async sql => {
      await sql`SELECT id FROM users WHERE id IN (${actorId},${targetId}) ORDER BY id FOR UPDATE`;
      await this.admin(sql, actorId);
      const target = await this.user(sql, targetId, true);
      if (!target || target.status !== "active" || target.role === "content_editor") throw new TestingError("TESTING_TARGET_UNAVAILABLE", 422);
      if (target.role === "superadmin") throw new TestingError("TESTING_INCLUDED_BY_ROLE", 422);
      const [old] = await sql<{ revision: number }[]>`SELECT revision FROM testing_access WHERE user_id=${targetId}`;
      if ((old?.revision ?? 0) !== expectedRevision) throw new TestingError("TESTING_REVISION_CONFLICT");
      const revision = expectedRevision+1;
      await sql`INSERT INTO testing_access(user_id,enabled,revision,updated_by) VALUES(${targetId},${enabled},${revision},${actorId})
        ON CONFLICT(user_id) DO UPDATE SET enabled=EXCLUDED.enabled,revision=EXCLUDED.revision,updated_by=EXCLUDED.updated_by,updated_at=now()`;
      await sql`INSERT INTO testing_audit(id,actor_user_id,target_user_id,revision,action) VALUES(${randomUUID()},${actorId},${targetId},${revision},${enabled ? "grant" : "revoke"})`;
      return effectiveTestingAccess(target, { enabled, revision });
    });
  }
  async list(actorId: string, admin = false) {
    // A single transaction protects access checks and the catalog read against revocation.
    return this.sql.begin(async sql => {
      const user = await this.user(sql, actorId, true);
      const [grant] = await sql<{ enabled: boolean; revision: number }[]>`SELECT enabled,revision FROM testing_access WHERE user_id=${actorId}`;
      if (!effectiveTestingAccess(user, grant).enabled || (admin && user?.role !== "superadmin")) throw new TestingError("TESTING_FORBIDDEN", 403);
      const rows = await sql<{ payload: string }[]>`SELECT r.payload_ciphertext AS payload FROM test_scenarios s
        JOIN test_scenario_revisions r ON r.scenario_id=s.id AND r.revision=s.revision
        WHERE (${admin} OR s.status='active') ORDER BY s.sort_order,s.id`;
      return rows.map(row => testScenarioSchema.parse(decryptJson(row.payload,this.key)));
    });
  }
  async save(actorId: string, id: string | null, input: TestScenarioInput, expectedRevision: number) {
    return this.sql.begin(async sql => {
      await this.admin(sql, actorId);
      // Serialize catalog edits, including the bounded catalog count.
      await sql`SELECT pg_advisory_xact_lock(807214,1)`;
      const [old] = id ? await sql<{ revision: number }[]>`SELECT revision FROM test_scenarios WHERE id=${id} FOR UPDATE` : [];
      if (id && !old) throw new TestingError("SCENARIO_NOT_FOUND", 404);
      if ((old?.revision ?? 0) !== expectedRevision) throw new TestingError("TESTING_REVISION_CONFLICT");
      const [count] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM test_scenarios`;
      if (!id && count!.count >= 100) throw new TestingError("SCENARIO_CATALOG_LIMIT", 422);
      const result: TestScenario = { ...input,id: id ?? randomUUID(),revision: expectedRevision+1,updatedAt: new Date().toISOString() };
      await sql`INSERT INTO test_scenarios(id,revision,status,sort_order,updated_at) VALUES(${result.id},${result.revision},${result.status},${result.sortOrder},${result.updatedAt})
        ON CONFLICT(id) DO UPDATE SET revision=EXCLUDED.revision,status=EXCLUDED.status,sort_order=EXCLUDED.sort_order,updated_at=EXCLUDED.updated_at`;
      await sql`INSERT INTO test_scenario_revisions(id,scenario_id,revision,payload_ciphertext,created_by) VALUES(${randomUUID()},${result.id},${result.revision},${encryptJson(result,this.key)},${actorId})`;
      await sql`INSERT INTO testing_audit(id,actor_user_id,scenario_id,revision,action) VALUES(${randomUUID()},${actorId},${result.id},${result.revision},'scenario_saved')`;
      return result;
    });
  }
  async close() { await this.sql.end(); }
}
