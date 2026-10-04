import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { defaultVoiceConsentRuntimePolicy, voiceConsentRuntimePolicy, voiceConsentSettingsUpdateSchema,
  type VoiceConsentSettingsUpdate, type VoiceConsentSettingsView } from "@callassist/contracts";

export class VoiceConsentPolicyError extends Error {
  constructor(readonly code: "VOICE_CONSENT_REVISION_CONFLICT" | "VOICE_CONSENT_FORBIDDEN") { super(code); }
}
export const initialVoiceConsentSettings = (): VoiceConsentSettingsView => ({
  policy: { ...defaultVoiceConsentRuntimePolicy }, updatedAt: null, updatedByUserId: null, reason: null
});
type PolicyRow = { mode: "semantic_native" | "hybrid_deterministic_v1"; revision: number;
  updated_at: Date | null; updated_by_user_id: string | null; reason: string | null };
function view(row: PolicyRow): VoiceConsentSettingsView {
  return { policy: voiceConsentRuntimePolicy(row.mode, row.revision), updatedAt: row.updated_at?.toISOString() ?? null,
    updatedByUserId: row.updated_by_user_id, reason: row.reason };
}
/** Shared lock pins admission against a simultaneous admin update. */
export async function readVoiceConsentPolicy(tx: postgres.TransactionSql) {
  const [row] = await tx<PolicyRow[]>`SELECT * FROM voice_consent_settings WHERE id=true FOR SHARE`;
  if (!row) throw new Error("VOICE_CONSENT_SETTINGS_MISSING");
  return view(row).policy;
}
export class PostgresVoiceConsentPolicyStore {
  constructor(private readonly sql: postgres.Sql) {}
  async get(): Promise<VoiceConsentSettingsView> {
    const [row] = await this.sql<PolicyRow[]>`SELECT * FROM voice_consent_settings WHERE id=true`;
    if (!row) throw new Error("VOICE_CONSENT_SETTINGS_MISSING");
    return view(row);
  }
  async update(input: VoiceConsentSettingsUpdate, actorUserId: string): Promise<VoiceConsentSettingsView> {
    const parsed = voiceConsentSettingsUpdateSchema.parse(input);
    return this.sql.begin(async tx => {
      const actors = await tx`SELECT id FROM users WHERE id=${actorUserId} AND role='superadmin' AND status='active' FOR SHARE`;
      if (!actors.count) throw new VoiceConsentPolicyError("VOICE_CONSENT_FORBIDDEN");
      const [row] = await tx<PolicyRow[]>`SELECT * FROM voice_consent_settings WHERE id=true FOR UPDATE`;
      if (!row || row.revision !== parsed.expectedRevision) throw new VoiceConsentPolicyError("VOICE_CONSENT_REVISION_CONFLICT");
      const [next] = await tx<PolicyRow[]>`UPDATE voice_consent_settings SET mode=${parsed.mode},revision=revision+1,
        updated_at=now(),updated_by_user_id=${actorUserId},reason=${parsed.reason} WHERE id=true RETURNING *`;
      await tx`INSERT INTO voice_consent_settings_audit(id,actor_user_id,reason,previous_policy,next_policy)
        VALUES(${randomUUID()},${actorUserId},${parsed.reason},${tx.json(view(row).policy)},${tx.json(view(next!).policy)})`;
      return view(next!);
    });
  }
}
