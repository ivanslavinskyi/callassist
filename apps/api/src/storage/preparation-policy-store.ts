import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { defaultPreparationCapacity, defaultPreparationRuntimePolicy, preparationProfileAdmissionSchema,
  preparationProfileKey, preparationSettingsUpdateSchema, preparationSettingsViewSchema,
  type PreparationProfileAdmission, type PreparationSettingsUpdate, type PreparationSettingsView } from "@callassist/contracts";

export class PreparationPolicyError extends Error {
  constructor(readonly code: "PREPARATION_REVISION_CONFLICT" | "PREPARATION_FORBIDDEN" | "PREPARATION_PROFILE_NOT_APPROVED" |
    "PREPARATION_QUEUE_FULL" | "PREPARATION_USER_QUEUE_FULL" | "PREPARATION_PROVIDER_BUSY", readonly retryAfterMs = 1000) { super(code); }
}
export const initialPreparationSettings = (): PreparationSettingsView => structuredClone({
  policy: defaultPreparationRuntimePolicy, capacity: defaultPreparationCapacity,
  approvedProfiles: ["gpt-5.6:default"], updatedAt: null, updatedByUserId: null, reason: null, history: []
});
type Row = { policy: PreparationSettingsView["policy"]; capacity: PreparationSettingsView["capacity"];
  approved_profiles: string[]; updated_at: Date | null; updated_by_user_id: string | null; reason: string | null };
const view = (row: Row): PreparationSettingsView => preparationSettingsViewSchema.parse({ policy: row.policy,
  capacity: row.capacity, approvedProfiles: row.approved_profiles, updatedAt: row.updated_at?.toISOString() ?? null,
  updatedByUserId: row.updated_by_user_id, reason: row.reason, history: [] });
export class PostgresPreparationPolicyStore {
  constructor(private readonly sql: postgres.Sql) {}
  async get(): Promise<PreparationSettingsView> {
    return this.sql.begin(async tx => {
      const [row] = await tx<Row[]>`SELECT * FROM preparation_settings WHERE id=true FOR SHARE`;
      if (!row) throw new Error("PREPARATION_SETTINGS_MISSING");
      const history = await tx`SELECT next_settings,actor_user_id,reason,report_sha256,created_at
        FROM preparation_settings_audit ORDER BY created_at DESC,id DESC LIMIT 50`;
      return { ...view(row), history: history.map(entry => ({ revision: entry.next_settings.policy.revision,
        createdAt: entry.created_at.toISOString(), actorUserId: entry.actor_user_id, reason: entry.reason,
        generation: entry.next_settings.policy.generation, capacity: entry.next_settings.capacity, reportSha256: entry.report_sha256,
        localTest: entry.next_settings.localTesting === true && entry.report_sha256 === null })) };
    });
  }
  async update(input: PreparationSettingsUpdate, actorUserId: string) {
    return this.#mutate(preparationSettingsUpdateSchema.parse(input), actorUserId);
  }
  async admit(input: PreparationProfileAdmission, actorUserId: string) {
    return this.#mutate(preparationProfileAdmissionSchema.parse(input), actorUserId);
  }
  async #mutate(input: PreparationSettingsUpdate | PreparationProfileAdmission, actorUserId: string) {
    await this.sql.begin(async tx => {
      const [row] = await tx<Row[]>`SELECT * FROM preparation_settings WHERE id=true FOR UPDATE`;
      const actors = await tx`SELECT id FROM users WHERE id=${actorUserId} AND role='superadmin' AND status='active' FOR SHARE`;
      if (!actors.count) throw new PreparationPolicyError("PREPARATION_FORBIDDEN");
      if (!row || row.policy.revision !== input.expectedRevision) throw new PreparationPolicyError("PREPARATION_REVISION_CONFLICT");
      const previous = view(row);
      const next = structuredClone(previous);
      if ("generation" in input) {
        next.policy.generation = input.generation;
        next.capacity = input.capacity;
      } else {
        next.approvedProfiles = [...new Set([...next.approvedProfiles, preparationProfileKey(input.profile)])];
      }
      next.policy.revision++;
      await tx`UPDATE preparation_settings SET policy=${tx.json(next.policy)},capacity=${tx.json(next.capacity)},
        approved_profiles=${tx.json(next.approvedProfiles)},updated_at=clock_timestamp(),updated_by_user_id=${actorUserId},reason=${input.reason} WHERE id=true`;
      await tx`INSERT INTO preparation_settings_audit(id,actor_user_id,reason,previous_settings,next_settings,report_sha256)
        VALUES(${randomUUID()},${actorUserId},${input.reason},${tx.json(previous)},${tx.json(next)},${"reportSha256" in input ? input.reportSha256 : null})`;
    });
    return this.get();
  }
}
