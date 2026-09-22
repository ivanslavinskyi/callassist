import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uiLocales, uiLocaleRegistry } from "@callassist/contracts";
import sharp from "sharp";
import { renderOgImage, normalizeOgUpload, sloganLayout } from "../og-renderer";
import { MemoryOgRepository } from "./og-repository";
import { OgService } from "./og-service";

describe("home OG images", () => {
  let repository: MemoryOgRepository, service: OgService;
  beforeEach(() => { repository = new MemoryOgRepository(); service = new OgService(repository); });
  afterEach(() => vi.unstubAllGlobals());
  it("renders all seven locales with supported glyphs and readable text", async () => {
    const network = vi.fn(() => { throw new Error("Unexpected network request during OG rendering"); });
    vi.stubGlobal("fetch", network);
    for (const locale of uiLocales) {
      const layout = await sloganLayout(uiLocaleRegistry[locale].slogan);
      expect(layout.lines.length).toBeLessThanOrEqual(2);
      expect(layout.fontSize).toBeGreaterThanOrEqual(48);
      const { png } = await renderOgImage(uiLocaleRegistry[locale].slogan);
      expect(await sharp(png).metadata()).toMatchObject({ width: 1200, height: 630, format: "png" });
    }
    expect((await renderOgImage("No need to talk.")).png).toEqual((await renderOgImage("No need to talk.")).png);
    expect(network).not.toHaveBeenCalled();
  });
  it("rejects overflow and unsupported glyphs instead of clipping or downloading fonts", async () => {
    await expect(sloganLayout("W".repeat(100))).rejects.toMatchObject({ code: "OG_SLOGAN_TOO_LONG" });
    await expect(sloganLayout("Hello 🦄")).rejects.toMatchObject({ code: "OG_UNSUPPORTED_CHARACTERS" });
    await expect(sloganLayout("SHPROHLI ©")).rejects.toMatchObject({ code: "OG_UNSUPPORTED_CHARACTERS" });
  });
  it("keeps drafts private, preserves old URLs, and restores a published version", async () => {
    const first = await service.prepare("ru", "actor", 0, { slogan: "Говорить не обязательно." });
    expect(first.published).toBeNull();
    expect(await service.published()).toEqual([]);
    expect(await repository.image("ru", first.draft!.hash)).toBeNull();
    expect(await repository.image("ru", first.draft!.hash, true)).toBeInstanceOf(Buffer);
    const published = await service.publish("ru", first.draft!.id, "actor", first.revision);
    const second = await service.prepare("ru", "actor", published.revision, { slogan: "Другой слоган." });
    expect(second.published!.hash).toBe(first.draft!.hash);
    const replaced = await service.publish("ru", second.draft!.id, "actor", second.revision);
    expect(replaced.previous!.id).toBe(first.draft!.id);
    expect(await repository.image("ru", first.draft!.hash)).toBeInstanceOf(Buffer);
    expect(await repository.image("en", first.draft!.hash, true)).toBeNull();
    const restored = await service.publish("ru", first.draft!.id, "actor", replaced.revision);
    expect(restored.published!.hash).toBe(first.draft!.hash);
    await expect(service.publish("en", first.draft!.id, "actor", 0)).rejects.toMatchObject({ code: "OG_VERSION_NOT_FOUND" });
    await expect(service.prepare("ru", "actor", 0, { slogan: "Stale" })).rejects.toMatchObject({ code: "OG_REVISION_CONFLICT" });
  });
  it("allows only one competing draft to win and retains publication on failed render", async () => {
    const outcomes = await Promise.allSettled([
      service.prepare("de", "actor", 0, { slogan: "One" }), service.prepare("de", "actor", 0, { slogan: "Two" })
    ]);
    expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(item => item.status === "rejected")).toHaveLength(1);
    const state = await repository.state("de");
    await service.publish("de", state.draft!.id, "actor", state.revision);
    await expect(service.prepare("de", "actor", 2, { slogan: "W".repeat(100) })).rejects.toThrow();
    expect((await repository.state("de")).published!.id).toBe(state.draft!.id);
  });
  it("normalizes manual crops and rejects SVG, invalid bytes, and too-small crops", async () => {
    const image = (await sharp({ create: { width: 1600, height: 1200, channels: 3, background: "#aa3344" } }).jpeg().toBuffer()).toString("base64");
    const input = { image, alt: "Manual image", expectedRevision: 0, crop: { x: 0, y: 0.15, width: 1, height: 0.7 } };
    const result = await service.prepare("fr", "actor", 0, input);
    expect(result.draft).toMatchObject({ source: "uploaded", slogan: null, alt: "Manual image" });
    const png = await repository.image("fr", result.draft!.hash, true);
    expect(await sharp(png!).metadata()).toMatchObject({ format: "png", width: 1200, height: 630, space: "srgb" });
    await expect(normalizeOgUpload({ ...input, image: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"/>').toString("base64") })).rejects.toMatchObject({ code: "OG_UNSUPPORTED_IMAGE" });
    await expect(normalizeOgUpload({ ...input, image: "bm90LWFuLWltYWdl" })).rejects.toMatchObject({ code: "OG_INVALID_IMAGE" });
    await expect(normalizeOgUpload({ ...input, crop: { x: 0, y: 0, width: 0.1, height: 0.07 } })).rejects.toMatchObject({ code: "OG_INVALID_CROP" });
  });
  it("applies EXIF orientation before crop coordinates", async () => {
    const image = (await sharp({ create: { width: 800, height: 1200, channels: 3, background: "blue" } })
      .jpeg().withMetadata({ orientation: 6 }).toBuffer()).toString("base64");
    const png = await normalizeOgUpload({ image, alt: "Rotated photo", expectedRevision: 0, crop: { x: 0, y: 0, width: 1, height: 630 / 800 } });
    expect(await sharp(png).metadata()).toMatchObject({ width: 1200, height: 630 });
    expect((await sharp(png).metadata()).orientation).toBeUndefined();
  });
});
