import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readMigrationCatalog,
  validateAppliedMigrationNames,
  validateMigrationSequence
} from "./migrate";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "callassist-migrations-"));
  directories.push(directory);
  return directory;
}

describe("migration catalog", () => {
  it("loads a contiguous catalog with stable SHA-256 checksums", async () => {
    const directory = await temporaryDirectory();
    await writeFile(join(directory, "0001_initial.sql"), "SELECT 1;\n");
    await writeFile(join(directory, "0002_users.sql"), "SELECT 2;\n");

    const catalog = await readMigrationCatalog(directory);

    expect(catalog.map(({ name, sequence }) => ({ name, sequence }))).toEqual([
      { name: "0001_initial.sql", sequence: 1 },
      { name: "0002_users.sql", sequence: 2 }
    ]);
    expect(catalog[0]?.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(catalog[0]?.checksumSha256).not.toBe(catalog[1]?.checksumSha256);
  });

  it("normalizes line endings before hashing and applying migrations", async () => {
    const lfDirectory = await temporaryDirectory();
    const crlfDirectory = await temporaryDirectory();
    await writeFile(join(lfDirectory, "0001_initial.sql"), "SELECT 1;\nSELECT 2;\n");
    await writeFile(
      join(crlfDirectory, "0001_initial.sql"),
      "SELECT 1;\r\nSELECT 2;\r\n"
    );

    const [lfCatalog, crlfCatalog] = await Promise.all([
      readMigrationCatalog(lfDirectory),
      readMigrationCatalog(crlfDirectory)
    ]);

    expect(crlfCatalog[0]?.sql).toBe(lfCatalog[0]?.sql);
    expect(crlfCatalog[0]?.checksumSha256)
      .toBe(lfCatalog[0]?.checksumSha256);
    expect(crlfCatalog[0]?.legacyCrlfChecksumSha256)
      .toBe(lfCatalog[0]?.legacyCrlfChecksumSha256);
    expect(lfCatalog[0]?.legacyCrlfChecksumSha256)
      .not.toBe(lfCatalog[0]?.checksumSha256);
  });

  it("rejects gaps, duplicate sequence numbers, bad names and empty SQL", async () => {
    expect(() => validateMigrationSequence([
      { name: "0001_initial.sql", sequence: 1 },
      { name: "0003_gap.sql", sequence: 3 }
    ])).toThrow("expected 0002");
    expect(() => validateMigrationSequence([
      { name: "0001_initial.sql", sequence: 1 },
      { name: "0001_duplicate.sql", sequence: 1 }
    ])).toThrow("expected 0002");

    const badNameDirectory = await temporaryDirectory();
    await writeFile(join(badNameDirectory, "migration.sql"), "SELECT 1;");
    await expect(readMigrationCatalog(badNameDirectory))
      .rejects.toThrow("Invalid migration filename");

    const emptyDirectory = await temporaryDirectory();
    await writeFile(join(emptyDirectory, "0001_empty.sql"), "  \n");
    await expect(readMigrationCatalog(emptyDirectory))
      .rejects.toThrow("Migration is empty");

    const missingDirectory = await temporaryDirectory();
    await expect(readMigrationCatalog(missingDirectory))
      .rejects.toThrow("Migration catalog must not be empty");
  });

  it("rejects applied migrations that disappeared from the catalog", () => {
    expect(() => validateAppliedMigrationNames(
      ["0001_initial.sql", "0002_removed.sql"],
      [{ name: "0001_initial.sql" }]
    )).toThrow("Applied migration is missing from catalog: 0002_removed.sql");
    expect(() => validateAppliedMigrationNames(
      ["0013_final_transcript_quality.sql"],
      [{ name: "0001_initial.sql" }]
    )).not.toThrow();
  });
});
