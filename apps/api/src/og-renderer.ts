import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ImageResponse } from "@vercel/og";
import { create, type Font } from "fontkit";
import sharp from "sharp";
import { OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT, OG_UPLOAD_MAX_BYTES, ogSloganSchema, type OgUploadInput } from "@callassist/contracts";
import { OgError } from "./og/og-repository";

let assets: Promise<{ font: Buffer; logo: string; metrics: Font; templateVersion: string }> | undefined;
function loadAssets() {
  return assets ??= Promise.all([
    readFile(new URL("./og/assets/Roboto-Medium.ttf", import.meta.url)),
    readFile(new URL("./og/assets/logo-light.svg", import.meta.url))
  ]).then(async ([font, logo]) => ({
    font, metrics: create(font) as Font,
    logo: `data:image/png;base64,${(await sharp(logo).resize(880).png().toBuffer()).toString("base64")}`,
    templateVersion: `home-v2-${createHash("sha256").update(font).update(logo).digest("hex").slice(0, 12)}`
  })).catch(error => { assets = undefined; throw error; });
}

export async function sloganLayout(input: string) {
  const parsed = ogSloganSchema.safeParse(input);
  if (!parsed.success) throw new OgError("OG_INVALID_SLOGAN");
  const slogan = parsed.data.normalize("NFC").replace(/\s+/gu, " ");
  const { metrics } = await loadAssets();
  // Reject unsupported glyphs instead of fetching fallback fonts or emoji remotely.
  if (/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3]/u.test(slogan)
    || [...slogan].some(char => !metrics.hasGlyphForCodePoint(char.codePointAt(0)!))) {
    throw new OgError("OG_UNSUPPORTED_CHARACTERS");
  }
  for (const fontSize of [56, 52, 48]) {
    const width = (text: string) => metrics.layout(text).advanceWidth * fontSize / metrics.unitsPerEm;
    const lines: string[] = [];
    let line = "";
    let fits = true;
    for (const word of slogan.split(" ")) {
      if (width(word) > 1000) { fits = false; break; }
      if (line && width(`${line} ${word}`) > 1000) { lines.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
    if (fits && lines.length <= 2) return { slogan, lines, fontSize };
  }
  throw new OgError("OG_SLOGAN_TOO_LONG");
}

export async function renderOgImage(input: string) {
  const { slogan, lines, fontSize } = await sloganLayout(input);
  const { font, logo, templateVersion } = await loadAssets();
  const element = { type: "div", key: null, props: {
    style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      width: "100%", height: "100%", background: "#f4f7f5", color: "#14231f", padding: "70px", fontFamily: "Roboto", fontWeight: 500 },
    children: [
      { type: "img", key: "logo", props: { src: logo, width: 880, height: 148 } },
      { type: "div", key: "slogan", props: {
        style: { display: "flex", flexDirection: "column", alignItems: "center", marginTop: 48, fontSize, lineHeight: 1.2, color: "#138553" },
        children: lines.map((line, i) => ({ type: "div", key: String(i), props: { style: { display: "flex" }, children: line } }))
      } }
    ]
  } };
  const response = new ImageResponse(element, {
    width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT,
    fonts: [{ name: "Roboto", data: Uint8Array.from(font).buffer, weight: 500, style: "normal" }]
  });
  const png = await sharp(Buffer.from(await response.arrayBuffer())).png().toBuffer();
  return { png, slogan, templateVersion };
}

export async function normalizeOgUpload(input: OgUploadInput) {
  const bytes = Buffer.from(input.image, "base64");
  if (!bytes.length || bytes.length > OG_UPLOAD_MAX_BYTES) throw new OgError("OG_IMAGE_TOO_LARGE", 413);
  try {
    const options = { limitInputPixels: 24_000_000, failOn: "warning" as const, animated: false };
    const meta = await sharp(bytes, options).metadata();
    if (!["png", "jpeg", "webp"].includes(meta.format ?? "") || (meta.pages ?? 1) !== 1) throw new OgError("OG_UNSUPPORTED_IMAGE");
    const oriented = await sharp(bytes, options).rotate().toBuffer({ resolveWithObject: true });
    const { width, height } = oriented.info;
    const left = Math.round(input.crop.x * width), top = Math.round(input.crop.y * height);
    const cropWidth = Math.min(width - left, Math.round(input.crop.width * width));
    const cropHeight = Math.min(height - top, Math.round(input.crop.height * height));
    if (cropWidth < 600 || cropHeight < 315 || Math.abs(cropWidth / cropHeight - 1200 / 630) > 0.02) {
      throw new OgError("OG_INVALID_CROP");
    }
    const png = await sharp(oriented.data, options).extract({ left, top, width: cropWidth, height: cropHeight })
      .resize(OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT).flatten({ background: "#f4f7f5" }).toColourspace("srgb").png().toBuffer();
    if (png.length > OG_UPLOAD_MAX_BYTES) throw new OgError("OG_IMAGE_TOO_LARGE", 413);
    return png;
  } catch (error) {
    if (error instanceof OgError) throw error;
    throw new OgError("OG_INVALID_IMAGE");
  }
}
