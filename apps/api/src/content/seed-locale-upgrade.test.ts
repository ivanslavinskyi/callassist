import { describe, expect, it } from "vitest";
import { uiLocales, type AdminEditorialRevision } from "@callassist/contracts";
import { seededEditorialCollections } from "./seed-content";
import { canUpgradeSeedLocales } from "./seed-locale-upgrade";
import { editorialAvailableLocales } from "./content-locales";

function legacy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(legacy);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(record).filter(([key]) => !["fr","it","rm","ru","uk"].includes(key)).map(([key, item]) => [key, legacy(item)]));
}
describe("bundled content upgrades", () => {
  for (const { revision } of seededEditorialCollections) {
    it(`upgrades only unchanged legacy ${revision.key}, preserving edited publications`, () => {
      expect(editorialAvailableLocales(revision)).toEqual([...uiLocales].sort());
      expect(canUpgradeSeedLocales(revision, revision)).toBe(false);
      const old = legacy(revision) as AdminEditorialRevision;
      expect(canUpgradeSeedLocales(old, revision)).toBe(true);
      const manuallyTranslated = structuredClone(old);
      function addPartialTranslation(value: unknown): boolean {
        if (!value || typeof value !== "object") return false;
        const record = value as Record<string, unknown>;
        if ("en" in record && "de" in record) { record.fr = "An editor's existing translation"; return true; }
        return Object.values(record).some(addPartialTranslation);
      }
      expect(addPartialTranslation(manuallyTranslated.items)).toBe(true);
      expect(canUpgradeSeedLocales(manuallyTranslated, revision)).toBe(false);
      old.items[0]!.enabled = !old.items[0]!.enabled;
      expect(canUpgradeSeedLocales(old, revision)).toBe(false);
    });
  }
});
