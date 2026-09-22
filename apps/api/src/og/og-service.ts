import { createHash, randomUUID } from "node:crypto";
import { uiLocales, type OgImageVersion, type OgUploadInput, type UiLocale } from "@callassist/contracts";
import { normalizeOgUpload, renderOgImage } from "../og-renderer";
import { MemoryOgRepository, OgError, type OgRepository } from "./og-repository";
import { PostgresOgRepository } from "./postgres-og-repository";

export class OgService {
  private running = 0;
  constructor(readonly repository: OgRepository) {}
  async list() { return Promise.all(uiLocales.map(locale => this.repository.state(locale))); }
  async published() {
    return this.repository.published();
  }
  async prepare(locale: UiLocale, actorId: string, expectedRevision: number, input: { slogan: string } | OgUploadInput) {
    if (this.running >= 2) throw new OgError("OG_BUSY", 429);
    this.running++;
    try {
      if ((await this.repository.state(locale)).revision !== expectedRevision) throw new OgError("OG_REVISION_CONFLICT", 409);
      const generated = "slogan" in input ? await renderOgImage(input.slogan) : null;
      const png = generated?.png ?? await normalizeOgUpload(input as OgUploadInput);
      const version: OgImageVersion = {
        id: randomUUID(), locale, hash: createHash("sha256").update(png).digest("hex"),
        source: generated ? "generated" : "uploaded", slogan: generated?.slogan ?? null,
        alt: generated ? `SHPROHLI — ${generated.slogan}` : (input as OgUploadInput).alt,
        templateVersion: generated?.templateVersion ?? null, createdAt: new Date().toISOString()
      };
      await this.repository.saveDraft(version, png, actorId, expectedRevision);
      return this.repository.state(locale);
    } finally { this.running--; }
  }
  async publish(locale: UiLocale, versionId: string, actorId: string, expectedRevision: number) {
    await this.repository.publish(locale, versionId, actorId, expectedRevision);
    return this.repository.state(locale);
  }
}
export function createOgServiceFromEnv() {
  const driver = process.env.STORAGE_DRIVER?.trim() || "memory";
  if (driver === "memory") return new OgService(new MemoryOgRepository());
  if (driver !== "postgres" || !process.env.DATABASE_URL) throw new Error("OG storage requires a supported STORAGE_DRIVER and DATABASE_URL for PostgreSQL");
  return new OgService(new PostgresOgRepository(process.env.DATABASE_URL));
}
