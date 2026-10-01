import { describe, expect, it } from "vitest";
import {
  parseLocalRecoverySource,
  validateCriticalTables,
  validateMigrationSnapshot
} from "./recovery-drill";

const catalog = [
  { name: "0001_initial.sql", checksumSha256: "a".repeat(64) },
  { name: "0002_users.sql", checksumSha256: "b".repeat(64) }
];

describe("database recovery drill", () => {
  it("accepts only a named local application database", () => {
    expect(parseLocalRecoverySource(
      "postgresql://callassist:private@localhost:55432/callassist"
    )).toMatchObject({
      databaseName: "callassist",
      userName: "callassist"
    });
    expect(() => parseLocalRecoverySource(
      "postgresql://callassist:private@database.example/callassist"
    )).toThrow("local application database");
    expect(() => parseLocalRecoverySource(
      "postgresql://callassist:private@localhost:55432/postgres"
    )).toThrow("local application database");
  });

  it("requires every canonical migration with its exact checksum", () => {
    expect(() => validateMigrationSnapshot([
      { name: "0001_initial.sql", checksumSha256: "a".repeat(64) },
      { name: "0002_users.sql", checksumSha256: "b".repeat(64) }
    ], catalog)).not.toThrow();
    expect(() => validateMigrationSnapshot([
      { name: "0001_initial.sql", checksumSha256: "a".repeat(64) }
    ], catalog)).toThrow("Restored migration is missing: 0002_users.sql");
    expect(() => validateMigrationSnapshot([
      { name: "0001_initial.sql", checksumSha256: "a".repeat(64) },
      { name: "0002_users.sql", checksumSha256: "c".repeat(64) }
    ], catalog)).toThrow("Restored migration checksum mismatch");
  });

  it("requires every critical application table", () => {
    // Independent recovery acceptance inventory; do not import the production list.
    const tables = [
      "beta_credit_policies",
      "beta_credit_enrollments",
      "beta_credit_periods",
      "plan_review_cases",
      "plan_review_audit",
      "admin_telemetry_export_recordings",
      "admin_telemetry_privacy_epoch",
      "admin_telemetry_exports",
      "admin_telemetry_export_parts",
      "admin_telemetry_export_events",
      "superadmin_notification_settings",
      "superadmin_notifications",
      "superadmin_notification_audit",
      "audit_events",
      "call_briefs",
      "call_voice_actions",
      "call_assessments",
      "call_assessment_revisions",
      "call_terminal_decisions",
      "call_compilations",
      "call_compilation_approvals",
      "call_compilation_review_policies",
      "call_events",
      "call_language_contexts",
      "call_preparation_language_contexts",
      "call_plan_review_receipts",
      "call_text_artifacts",
      "call_text_artifact_chunks",
      "credit_transactions",
      "durable_jobs",
      "final_transcript_revisions",
      "provider_operation_results",
      "provider_operations",
      "provider_cost_records",
      "provider_usage_records",
      "post_call_transcription_chunks",
      "sessions",
      "users"
    ];
    expect(tables).toHaveLength(38);
    expect(() => validateCriticalTables(tables)).not.toThrow();
    for (const table of tables) {
      expect(() => validateCriticalTables(tables.filter((name) => name !== table)))
        .toThrow(`Restored critical tables are missing: ${table}`);
    }
    expect(() => validateCriticalTables(["users"]))
      .toThrow("Restored critical tables are missing");
  });
});
