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
    expect(() => validateCriticalTables([
      "audit_events",
      "call_briefs",
      "call_events",
      "credit_transactions",
      "durable_jobs",
      "sessions",
      "users"
    ])).not.toThrow();
    expect(() => validateCriticalTables(["users"]))
      .toThrow("Restored critical tables are missing");
  });
});
