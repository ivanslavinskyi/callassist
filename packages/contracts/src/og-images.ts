import { z } from "zod";
import { uiLocales, type UiLocale } from "./ui-locales";

export const ogLocaleSchema = z.enum(uiLocales as [UiLocale, ...UiLocale[]]);
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
export const OG_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const ogSloganSchema = z.string().trim().min(1).max(100)
  .refine(value => !/[\r\n\t\u0000-\u001f]/u.test(value), "Use a single line of text");
export const ogGenerateInputSchema = z.object({
  slogan: ogSloganSchema,
  expectedRevision: z.number().int().nonnegative()
});
export const ogUploadInputSchema = z.object({
  image: z.string().min(1).max(Math.ceil(OG_UPLOAD_MAX_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  alt: z.string().trim().min(1).max(240),
  // Normalized coordinates in the EXIF-oriented original image.
  crop: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) })
    .refine(crop => crop.x + crop.width <= 1.000001 && crop.y + crop.height <= 1.000001),
  expectedRevision: z.number().int().nonnegative()
});
export const ogPublishInputSchema = z.object({
  versionId: z.uuid(),
  expectedRevision: z.number().int().nonnegative()
});
export type OgUploadInput = z.infer<typeof ogUploadInputSchema>;
export type OgImageVersion = {
  id: string; locale: UiLocale; hash: string; source: "generated" | "uploaded";
  slogan: string | null; alt: string; templateVersion: string | null; createdAt: string;
};
export type OgLocaleState = {
  locale: UiLocale; revision: number;
  published: OgImageVersion | null; previous: OgImageVersion | null; draft: OgImageVersion | null;
  history: OgImageVersion[];
};
export type PublishedOgImage = Pick<OgImageVersion, "locale" | "hash" | "alt">;
export function ogImagePath(image: PublishedOgImage) {
  return `/media/og/home/${image.locale}/${image.hash}.png`;
}
export function fallbackOgImagePath(locale: UiLocale) {
  return `/og/home/${locale}.png`;
}
