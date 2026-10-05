import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exportSources, mapExportRow } from "./sources";
import { encryptJson } from "../security/encryption";
import { voiceConsentRuntimePolicy } from "@callassist/contracts";

// Every persisted table needs an explicit export or exclusion decision. New
// migrations must update this inventory; existence-only SELECT tests miss gaps.
const excluded: Record<string, string[]> = {
  identity_and_authentication: ["users", "sessions", "user_onboarding_acceptances", "account_admin_events", "account_session_events",
    "phone_change_challenges", "phone_change_events", "password_recovery_challenges", "password_recovery_grants", "password_recovery_events", "email_change_challenges", "email_change_events"],
  public_content: ["content_pages", "content_page_localizations", "content_page_revisions", "content_page_revision_localizations", "content_admin_events",
    "content_editorial_collections", "content_editorial_revisions", "content_editorial_admin_events", "home_og_assets", "home_og_versions", "home_og_locales", "home_og_audit"],
  account_operations_not_call_content: ["promo_codes", "promo_redemptions", "account_data_export_events", "account_deletion_requests", "account_deletion_attempts", "account_deletion_events", "beta_credit_enrollments"],
  global_security_and_configuration: ["recipient_suppressions", "system_controls", "safety_events", "recipient_contact_evidence", "recipient_contact_backfill", "recipient_opt_out_challenges",
    "rate_limit_buckets", "rate_limit_hourly_metrics", "provider_webhook_delivery_buckets", "durable_worker_heartbeats", "beta_controls", "beta_invitations", "beta_control_audit", "beta_recipient_starts",
    // Global operator history is not scoped to a selected call. Its attempt's
    // immutable policy is exported through call_attempts instead.
    "voice_consent_settings", "voice_consent_settings_audit", "preparation_settings", "preparation_settings_audit",
    "preparation_dispatch_users", "preparation_provider_permits", "preparation_provider_cooldown", "preparation_provider_admissions", "preparation_daily_metrics"],
  notification_content_and_delivery: ["superadmin_notification_settings", "superadmin_notifications", "superadmin_notification_audit"],
  export_storage_and_audit: ["admin_telemetry_privacy_epoch", "admin_telemetry_exports", "admin_telemetry_export_parts", "admin_telemetry_export_events", "admin_telemetry_export_recordings"]
};
const directory = new URL("../db/migrations/", import.meta.url);
describe("telemetry source inventory", () => {
  it("exports bounded preparation measurements without extra headers or request content", () => {
    const source = exportSources.find(source => source.table === "provider_operation_results")!;
    expect(source.fields).toContain("response_metadata");
    const data = { response_metadata: { ...preparationDiagnosticsFixture, headers: { authorization: "secret" }, body: "private plan" } };
    expect(mapExportRow(source, data, Buffer.alloc(32)).data).toEqual({ response_metadata: preparationDiagnosticsFixture });
    expect(mapExportRow(source, { response_metadata: null }, Buffer.alloc(32)).data).toEqual({ response_metadata: null });
  });
  it("requires an explicit scope decision for every persisted table", () => {
    const decisions = new Set([...exportSources.map(source => source.table), ...Object.values(excluded).flat()]);
    for (const name of readdirSync(directory).filter(name => name.endsWith(".sql"))) {
      const sql = readFileSync(new URL(name, directory), "utf8");
      for (const match of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([a-z_]+)/gi)) expect(decisions.has(match[1]!), `${name}: unreviewed table ${match[1]}`).toBe(true);
    }
  });
  it("requires all new columns in scoped sources to be exported or deliberately reviewed", () => {
    const byTable = new Map(exportSources.map(source => [source.table, new Set(source.fields)]));
    for (const name of readdirSync(directory).filter(name => /^\d{4}_.*\.sql$/.test(name) && Number(name.slice(0,4)) >= 90)) {
      const sql = readFileSync(new URL(name, directory), "utf8");
      for (const statement of sql.matchAll(/ALTER TABLE\s+([a-z_]+)([^;]+);/gi)) {
        const fields = byTable.get(statement[1]!); if (!fields) continue;
        for (const column of statement[2]!.matchAll(/ADD COLUMN\s+([a-z_]+)/gi)) expect(fields.has(column[1]!), `${name}: unreviewed source column ${statement[1]}.${column[1]}`).toBe(true);
      }
    }
  });
  it.each(["direct", "legacy_inferred", "unknown"])("preserves %s transcript provenance without reconstructing history", attribution => {
    const source = exportSources.find(source => source.table === "transcript_segments")!;
    const record = mapExportRow(source, { call_attempt_id: attribution === "unknown" ? null : "attempt", attempt_attribution: attribution }, Buffer.alloc(32));
    expect(record).toMatchObject({ schemaVersion: 2, attribution, attemptId: attribution === "unknown" ? null : "attempt" });
  });
  it("preserves retained application action evidence inside the authorized encrypted-source boundary", () => {
    const source = exportSources.find(source => source.table === "call_voice_actions")!;
    expect(source.fields).toContain("payload_ciphertext");
    const key = Buffer.alloc(32), payload = { delivered: true, evidence: ["application playback acknowledged"] };
    expect(mapExportRow(source, { payload_ciphertext: encryptJson(payload, key) }, key).data).toEqual({ payload });
    expect(mapExportRow(source, { payload_ciphertext: null }, key).data).toEqual({ payload: null });
  });
  it("exports only pinned consent policy fields and preserves missing historical policy", () => {
    const source = exportSources.find(source => source.table === "call_attempts")!;
    const policy = voiceConsentRuntimePolicy("hybrid_deterministic_v1", 3);
    expect(source.fields).toContain("consent_runtime_policy");
    const exported = mapExportRow(source, { consent_runtime_policy: { ...policy, reason: "Private operator note", actorId: "private-actor", recipientText: "private reply" } }, Buffer.alloc(32));
    expect(exported.data).toEqual({ consent_runtime_policy: policy });
    expect(mapExportRow(source, { consent_runtime_policy: null }, Buffer.alloc(32)).data).toEqual({ consent_runtime_policy: null });
    expect(exportSources.some(source => source.table.startsWith("voice_consent_settings"))).toBe(false);
  });
});
import { preparationDiagnosticsFixture } from "../brief-compiler/request-diagnostics.fixture";
