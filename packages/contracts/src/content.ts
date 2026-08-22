import { z } from "zod";

export const contentLocaleSchema = z.enum(["en", "de"]);
export type ContentLocale = z.infer<typeof contentLocaleSchema>;

export const contentPageKeySchema = z.enum([
  "privacy",
  "terms",
  "acceptable_use",
  "support",
  "faq"
]);
export type ContentPageKey = z.infer<typeof contentPageKeySchema>;

export const contentPageTypeSchema = z.enum(["page", "landing"]);

export const contentSectionSchema = z.object({
  heading: z.string().trim().min(1).max(180),
  paragraphs: z.array(z.string().trim().min(1).max(4000)).max(12),
  bullets: z.array(z.string().trim().min(1).max(1000)).max(24)
});
export type ContentSection = z.infer<typeof contentSectionSchema>;

export const publishedContentPageSchema = z.object({
  key: contentPageKeySchema,
  pageType: contentPageTypeSchema,
  sourceLocale: contentLocaleSchema,
  locale: contentLocaleSchema,
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1).max(180),
  summary: z.string().trim().min(1).max(1000),
  sections: z.array(contentSectionSchema).min(1).max(40),
  seoTitle: z.string().trim().min(1).max(180),
  seoDescription: z.string().trim().min(1).max(500),
  revision: z.object({
    id: z.uuid(),
    number: z.number().int().positive(),
    requiresReacceptance: z.boolean(),
    sourceRevisionNumber: z.number().int().positive(),
    publishedAt: z.iso.datetime()
  })
});
export type PublishedContentPage = z.infer<
  typeof publishedContentPageSchema
>;

export const legalRevisionReferenceSchema = z.object({
  id: z.uuid(),
  key: z.enum(["terms", "acceptable_use"]),
  revisionNumber: z.number().int().positive(),
  locale: contentLocaleSchema,
  slug: z.string(),
  title: z.string(),
  publishedAt: z.iso.datetime()
});
export type LegalRevisionReference = z.infer<
  typeof legalRevisionReferenceSchema
>;

export const onboardingStatusSchema = z.object({
  required: z.boolean(),
  current: z.object({
    terms: legalRevisionReferenceSchema,
    acceptableUse: legalRevisionReferenceSchema
  }),
  accepted: z.object({
    termsRevisionId: z.uuid(),
    acceptableUseRevisionId: z.uuid(),
    acceptedAt: z.iso.datetime()
  }).nullable()
});
export type OnboardingStatus = z.infer<typeof onboardingStatusSchema>;

export const onboardingAcceptanceInputSchema = z.object({
  locale: contentLocaleSchema,
  termsRevisionId: z.uuid(),
  acceptableUseRevisionId: z.uuid(),
  acceptTerms: z.literal(true),
  acceptAcceptableUse: z.literal(true),
  acknowledgeConsent: z.literal(true),
  acknowledgeRetention: z.literal(true),
  acknowledgeUseLimits: z.literal(true),
  acknowledgeCredits: z.literal(true)
});
export type OnboardingAcceptanceInput = z.infer<
  typeof onboardingAcceptanceInputSchema
>;
