import { randomUUID } from "node:crypto";
import type { TestScenario, TestScenarioInput, TestingAccess, User, TestScenarioSelection, TestingAttribution } from "@callassist/contracts";
import type { AuthRepository } from "../auth/auth-repository";
export class TestingError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); }
}
export interface TestingStore {
  attribution(userId: string, objective: string, selection?: TestScenarioSelection): Promise<TestingAttribution>;
  recordPreparation(preparationId: string, attribution: TestingAttribution): Promise<void>;
  access(userId: string): Promise<TestingAccess>;
  setAccess(actorId: string, targetId: string, enabled: boolean, expectedRevision: number): Promise<TestingAccess>;
  list(actorId: string, admin?: boolean): Promise<TestScenario[]>;
  save(actorId: string, id: string | null, input: TestScenarioInput, expectedRevision: number): Promise<TestScenario>;
  close(): Promise<void>;
}
export function effectiveTestingAccess(user: Pick<User, "role" | "status"> | null, grant?: { enabled: boolean; revision: number }): TestingAccess {
  const byRole = user?.status === "active" && user.role === "superadmin";
  return { enabled: !!(user?.status === "active" && user.role !== "content_editor" && (byRole || grant?.enabled)), byRole, revision: grant?.revision ?? 0 };
}
export class MemoryTestingStore implements TestingStore {
  readonly preparations: Map<string, TestingAttribution>;
  readonly grants = new Map<string, { enabled: boolean; revision: number }>();
  readonly scenarios = new Map<string, TestScenario>();
  readonly revisions: TestScenario[] = [];
  readonly audit: { actorId: string; targetId?: string; scenarioId?: string; revision: number; action: string }[] = [];
  constructor(private readonly auth: Pick<AuthRepository, "findUserById">, preparations?: Map<string, TestingAttribution>) {
    this.preparations = preparations ?? new Map();
  }
  async access(id: string) {
    const user=await this.auth.findUserById(id);
    if(!user || user.status==='deleted') this.grants.delete(id);
    return effectiveTestingAccess(user, this.grants.get(id));
  }
  async attribution(userId:string, objective:string, selection?:TestScenarioSelection) {
    const access=await this.access(userId);
    const scenario=selection?this.revisions.find(s=>s.id===selection.id&&s.revision===selection.revision):null;
    if(selection&&(!access.enabled||!scenario)) throw new TestingError("SCENARIO_SELECTION_UNAVAILABLE",403);
    return {tester:access.enabled,byRole:access.byRole,scenario:selection??null,objectiveModified:scenario?objective!==scenario.objective:null};
  }
  async recordPreparation(id:string, attribution:TestingAttribution) { if(!this.preparations.has(id)) this.preparations.set(id,attribution); }
  async admin(id: string) { const u = await this.auth.findUserById(id); if (u?.status !== "active" || u.role !== "superadmin") throw new TestingError("TESTING_FORBIDDEN", 403); }
  async setAccess(actorId: string, targetId: string, enabled: boolean, expectedRevision: number) {
    await this.admin(actorId);
    const target = await this.auth.findUserById(targetId);
    if (!target || target.status !== "active" || target.role === "content_editor") throw new TestingError("TESTING_TARGET_UNAVAILABLE", 422);
    if (target.role === "superadmin") throw new TestingError("TESTING_INCLUDED_BY_ROLE", 422);
    const old = this.grants.get(targetId);
    if ((old?.revision ?? 0) !== expectedRevision) throw new TestingError("TESTING_REVISION_CONFLICT");
    const grant = { enabled, revision: expectedRevision + 1 }; this.grants.set(targetId, grant);
    this.audit.push({ actorId, targetId, revision: grant.revision, action: enabled ? "grant" : "revoke" });
    return effectiveTestingAccess(target, grant);
  }
  async list(actorId: string, admin = false) {
    if (admin) await this.admin(actorId); else if (!(await this.access(actorId)).enabled) throw new TestingError("TESTING_FORBIDDEN", 403);
    return [...this.scenarios.values()].filter(s => admin || s.status === "active").sort((a,b) => a.sortOrder-b.sortOrder || a.id.localeCompare(b.id));
  }
  async save(actorId: string, id: string | null, input: TestScenarioInput, expectedRevision: number) {
    await this.admin(actorId);
    if (id && !this.scenarios.has(id)) throw new TestingError("SCENARIO_NOT_FOUND", 404);
    if ((id ? this.scenarios.get(id)?.revision : 0) !== expectedRevision) throw new TestingError("TESTING_REVISION_CONFLICT");
    if (!id && this.scenarios.size >= 100) throw new TestingError("SCENARIO_CATALOG_LIMIT", 422);
    const result: TestScenario = { ...input, id: id ?? randomUUID(), revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
    this.scenarios.set(result.id, result); this.revisions.push(result);
    this.audit.push({ actorId, scenarioId: result.id, revision: result.revision, action: "scenario_saved" });
    return result;
  }
  async close() {}
}
