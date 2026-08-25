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

export const editorialCollectionKeySchema = z.enum([
  "faq",
  "navigation",
  "landing"
]);
export type EditorialCollectionKey = z.infer<
  typeof editorialCollectionKeySchema
>;

export const navigationDestinationSchema = z.enum([
  "home",
  "privacy",
  "terms",
  "acceptable_use",
  "support",
  "faq",
  "opt_out"
]);
export type NavigationDestination = z.infer<
  typeof navigationDestinationSchema
>;

const localizedEditorialTextSchema = z.object({
  en: z.string().trim().min(1).max(4000),
  de: z.string().trim().min(1).max(4000)
});

export const faqItemSchema = z.object({
  id: z.uuid(),
  sortOrder: z.number().int().nonnegative().max(999),
  enabled: z.boolean(),
  question: localizedEditorialTextSchema,
  answer: localizedEditorialTextSchema
});
export type FaqItem = z.infer<typeof faqItemSchema>;

export const navigationItemSchema = z.object({
  id: z.uuid(),
  sortOrder: z.number().int().nonnegative().max(999),
  enabled: z.boolean(),
  location: z.enum(["header", "footer"]),
  destination: navigationDestinationSchema,
  label: z.object({
    en: z.string().trim().min(1).max(80),
    de: z.string().trim().min(1).max(80)
  })
});
export type NavigationItem = z.infer<typeof navigationItemSchema>;

const localizedLandingShortTextSchema = z.object({
  en: z.string().trim().min(1).max(180),
  de: z.string().trim().min(1).max(180)
});

const localizedLandingLongTextSchema = z.object({
  en: z.string().trim().min(1).max(1200),
  de: z.string().trim().min(1).max(1200)
});

const localizedLandingListSchema = z.object({
  en: z.array(z.string().trim().min(1).max(240)).min(1).max(12),
  de: z.array(z.string().trim().min(1).max(240)).min(1).max(12)
});

const landingContentItemSchema = z.object({
  id: z.uuid(),
  title: localizedLandingShortTextSchema,
  text: localizedLandingLongTextSchema
});

const landingContentItemsSchema = z.array(landingContentItemSchema).min(1).max(12);

const landingBlockBaseSchema = z.object({
  id: z.uuid(),
  sortOrder: z.number().int().nonnegative().max(99),
  enabled: z.boolean()
});

export const landingBlockSchema = z.discriminatedUnion("blockType", [
  landingBlockBaseSchema.extend({
    blockType: z.literal("hero"),
    eyebrow: localizedLandingShortTextSchema,
    title: localizedLandingShortTextSchema,
    supportingTitle: localizedLandingShortTextSchema.optional(),
    lead: localizedLandingLongTextSchema,
    secondaryText: localizedLandingLongTextSchema.optional(),
    badges: localizedLandingListSchema,
    primaryCtaLabel: localizedLandingShortTextSchema,
    secondaryCtaLabel: localizedLandingShortTextSchema,
    seoTitle: localizedLandingShortTextSchema,
    seoDescription: localizedLandingLongTextSchema
  }),
  landingBlockBaseSchema.extend({
    blockType: z.literal("problem"),
    eyebrow: localizedLandingShortTextSchema,
    title: localizedLandingShortTextSchema,
    items: landingContentItemsSchema
  }),
  landingBlockBaseSchema.extend({
    blockType: z.literal("how_it_works"),
    eyebrow: localizedLandingShortTextSchema,
    title: localizedLandingShortTextSchema,
    steps: z.array(z.object({
      id: z.uuid(),
      title: localizedLandingShortTextSchema,
      text: localizedLandingLongTextSchema
    })).min(1).max(8)
  }),
  landingBlockBaseSchema.extend({
    blockType: z.literal("use_cases"),
    eyebrow: localizedLandingShortTextSchema,
    title: localizedLandingShortTextSchema,
    text: localizedLandingLongTextSchema,
    items: z.union([localizedLandingListSchema, landingContentItemsSchema])
  }),
  landingBlockBaseSchema.extend({
    blockType: z.literal("example"),
    title: localizedLandingShortTextSchema,
    items: landingContentItemsSchema
  }),
  landingBlockBaseSchema.extend({
    blockType: z.literal("safety_privacy"),
    eyebrow: localizedLandingShortTextSchema,
    title: localizedLandingShortTextSchema,
    text: localizedLandingLongTextSchema,
    limitsTitle: localizedLandingShortTextSchema,
    limits: localizedLandingListSchema
  }),
  landingBlockBaseSchema.extend({
    blockType: z.literal("languages"),
    title: localizedLandingShortTextSchema,
    text: localizedLandingLongTextSchema
  }),
  landingBlockBaseSchema.extend({
    blockType: z.literal("faq"),
    eyebrow: localizedLandingShortTextSchema,
    title: localizedLandingShortTextSchema,
    itemLimit: z.number().int().min(1).max(12)
  }),
  landingBlockBaseSchema.extend({
    blockType: z.literal("cta"),
    title: localizedLandingShortTextSchema,
    text: localizedLandingLongTextSchema,
    primaryCtaLabel: localizedLandingShortTextSchema
  })
]);
export type LandingBlock = z.infer<typeof landingBlockSchema>;

const requiredLandingBlockTypes = [
  "hero",
  "how_it_works",
  "use_cases",
  "safety_privacy",
  "languages",
  "faq",
  "cta"
] as const;

const optionalLandingBlockTypes = ["problem", "example"] as const;

export const landingBlocksSchema = z.array(landingBlockSchema)
  .min(requiredLandingBlockTypes.length)
  .max(requiredLandingBlockTypes.length + optionalLandingBlockTypes.length)
  .superRefine((blocks, context) => {
    const types = new Set(blocks.map(({ blockType }) => blockType));
    const ids = new Set(blocks.map(({ id }) => id));
    if (requiredLandingBlockTypes.some((blockType) => !types.has(blockType))
      || types.size !== blocks.length) {
      context.addIssue({
        code: "custom",
        message: "Landing requires one block of every core type and no duplicate types"
      });
    }
    if (ids.size !== blocks.length) {
      context.addIssue({ code: "custom", message: "Landing block IDs must be unique" });
    }
  });

export const editorialRevisionSummarySchema = z.object({
  id: z.uuid(),
  number: z.number().int().positive(),
  status: z.enum(["draft", "published"]),
  createdByUserId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().nullable()
});
export type EditorialRevisionSummary = z.infer<
  typeof editorialRevisionSummarySchema
>;

const editorialRevisionBaseSchema = editorialRevisionSummarySchema.extend({
  key: editorialCollectionKeySchema
});

export const adminEditorialRevisionSchema = z.discriminatedUnion("key", [
  editorialRevisionBaseSchema.extend({
    key: z.literal("faq"),
    items: z.array(faqItemSchema).max(80)
  }),
  editorialRevisionBaseSchema.extend({
    key: z.literal("navigation"),
    items: z.array(navigationItemSchema).max(40)
  }),
  editorialRevisionBaseSchema.extend({
    key: z.literal("landing"),
    items: landingBlocksSchema
  })
]);
export type AdminEditorialRevision = z.infer<
  typeof adminEditorialRevisionSchema
>;

export const editorialDraftUpdateInputSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("faq"), items: z.array(faqItemSchema).max(80) }),
  z.object({
    key: z.literal("navigation"),
    items: z.array(navigationItemSchema).max(40)
  }),
  z.object({
    key: z.literal("landing"),
    items: landingBlocksSchema
  })
]);
export type EditorialDraftUpdateInput = z.infer<
  typeof editorialDraftUpdateInputSchema
>;

export const publishedFaqSchema = z.object({
  revision: editorialRevisionSummarySchema.pick({
    id: true,
    number: true,
    publishedAt: true
  }).extend({ publishedAt: z.iso.datetime() }),
  locale: contentLocaleSchema,
  items: z.array(z.object({
    id: z.uuid(),
    question: z.string().trim().min(1).max(4000),
    answer: z.string().trim().min(1).max(4000)
  }))
});
export type PublishedFaq = z.infer<typeof publishedFaqSchema>;

export const publishedNavigationSchema = z.object({
  revision: editorialRevisionSummarySchema.pick({
    id: true,
    number: true,
    publishedAt: true
  }).extend({ publishedAt: z.iso.datetime() }),
  locale: contentLocaleSchema,
  items: z.array(z.object({
    id: z.uuid(),
    location: z.enum(["header", "footer"]),
    destination: navigationDestinationSchema,
    label: z.string().trim().min(1).max(80),
    href: z.string().startsWith("/")
  }))
});
export type PublishedNavigation = z.infer<typeof publishedNavigationSchema>;

export const publishedLandingBlockSchema = z.discriminatedUnion("blockType", [
  landingBlockBaseSchema.extend({
    blockType: z.literal("hero"),
    eyebrow: z.string(),
    title: z.string(),
    supportingTitle: z.string().optional(),
    lead: z.string(),
    secondaryText: z.string().optional(),
    badges: z.array(z.string()),
    primaryCtaLabel: z.string(),
    secondaryCtaLabel: z.string(),
    seoTitle: z.string(),
    seoDescription: z.string()
  }),
  landingBlockBaseSchema.extend({
    blockType: z.literal("problem"),
    eyebrow: z.string(),
    title: z.string(),
    items: z.array(z.object({ title: z.string(), text: z.string() }))
  }),
  landingBlockBaseSchema.extend({
    blockType: z.literal("how_it_works"),
    eyebrow: z.string(),
    title: z.string(),
    steps: z.array(z.object({ id: z.uuid(), title: z.string(), text: z.string() }))
  }),
  landingBlockBaseSchema.extend({
    blockType: z.literal("use_cases"),
    eyebrow: z.string(),
    title: z.string(),
    text: z.string(),
    items: z.array(z.object({ title: z.string(), text: z.string() }))
  }),
  landingBlockBaseSchema.extend({
    blockType: z.literal("example"),
    title: z.string(),
    items: z.array(z.object({ title: z.string(), text: z.string() }))
  }),
  landingBlockBaseSchema.extend({
    blockType: z.literal("safety_privacy"),
    eyebrow: z.string(),
    title: z.string(),
    text: z.string(),
    limitsTitle: z.string(),
    limits: z.array(z.string())
  }),
  landingBlockBaseSchema.extend({
    blockType: z.literal("languages"),
    title: z.string(),
    text: z.string()
  }),
  landingBlockBaseSchema.extend({
    blockType: z.literal("faq"),
    eyebrow: z.string(),
    title: z.string(),
    itemLimit: z.number().int().min(1).max(12)
  }),
  landingBlockBaseSchema.extend({
    blockType: z.literal("cta"),
    title: z.string(),
    text: z.string(),
    primaryCtaLabel: z.string()
  })
]);
export type PublishedLandingBlock = z.infer<
  typeof publishedLandingBlockSchema
>;

export function localizeLandingBlock(
  block: LandingBlock,
  locale: ContentLocale
): PublishedLandingBlock {
  const base = {
    id: block.id,
    sortOrder: block.sortOrder,
    enabled: block.enabled
  };
  switch (block.blockType) {
    case "hero":
      return {
        ...base,
        blockType: block.blockType,
        eyebrow: block.eyebrow[locale],
        title: block.title[locale],
        supportingTitle: block.supportingTitle?.[locale],
        lead: block.lead[locale],
        secondaryText: block.secondaryText?.[locale],
        badges: block.badges[locale],
        primaryCtaLabel: block.primaryCtaLabel[locale],
        secondaryCtaLabel: block.secondaryCtaLabel[locale],
        seoTitle: block.seoTitle[locale],
        seoDescription: block.seoDescription[locale]
      };
    case "problem":
      return {
        ...base,
        blockType: block.blockType,
        eyebrow: block.eyebrow[locale],
        title: block.title[locale],
        items: block.items.map((item) => ({
          title: item.title[locale],
          text: item.text[locale]
        }))
      };
    case "how_it_works":
      return {
        ...base,
        blockType: block.blockType,
        eyebrow: block.eyebrow[locale],
        title: block.title[locale],
        steps: block.steps.map((step) => ({
          id: step.id,
          title: step.title[locale],
          text: step.text[locale]
        }))
      };
    case "use_cases":
      return {
        ...base,
        blockType: block.blockType,
        eyebrow: block.eyebrow[locale],
        title: block.title[locale],
        text: block.text[locale],
        items: Array.isArray(block.items)
          ? block.items.map((item) => ({
              title: item.title[locale],
              text: item.text[locale]
            }))
          : block.items[locale].map((title) => ({ title, text: "" }))
      };
    case "example":
      return {
        ...base,
        blockType: block.blockType,
        title: block.title[locale],
        items: block.items.map((item) => ({
          title: item.title[locale],
          text: item.text[locale]
        }))
      };
    case "safety_privacy":
      return {
        ...base,
        blockType: block.blockType,
        eyebrow: block.eyebrow[locale],
        title: block.title[locale],
        text: block.text[locale],
        limitsTitle: block.limitsTitle[locale],
        limits: block.limits[locale]
      };
    case "languages":
      return {
        ...base,
        blockType: block.blockType,
        title: block.title[locale],
        text: block.text[locale]
      };
    case "faq":
      return {
        ...base,
        blockType: block.blockType,
        eyebrow: block.eyebrow[locale],
        title: block.title[locale],
        itemLimit: block.itemLimit
      };
    case "cta":
      return {
        ...base,
        blockType: block.blockType,
        title: block.title[locale],
        text: block.text[locale],
        primaryCtaLabel: block.primaryCtaLabel[locale]
      };
  }
}

export const publishedLandingSchema = z.object({
  revision: editorialRevisionSummarySchema.pick({
    id: true,
    number: true,
    publishedAt: true
  }).extend({ publishedAt: z.iso.datetime() }),
  locale: contentLocaleSchema,
  blocks: z.array(publishedLandingBlockSchema).max(9),
  seo: z.object({
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().min(1).max(1200)
  })
});
export type PublishedLanding = z.infer<typeof publishedLandingSchema>;

export const publishedLandingIndexSchema = z.object({
  revision: z.object({
    id: z.uuid(),
    number: z.number().int().positive(),
    publishedAt: z.iso.datetime()
  }),
  sourceLocale: contentLocaleSchema,
  localizations: z.array(z.object({
    locale: contentLocaleSchema,
    seoTitle: z.string().trim().min(1).max(180),
    seoDescription: z.string().trim().min(1).max(1200),
    translationStale: z.boolean()
  })).length(2)
});
export type PublishedLandingIndex = z.infer<
  typeof publishedLandingIndexSchema
>;

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

export const publishedContentIndexLocalizationSchema = z.object({
  locale: contentLocaleSchema,
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1).max(180),
  seoTitle: z.string().trim().min(1).max(180),
  seoDescription: z.string().trim().min(1).max(500),
  sourceRevisionNumber: z.number().int().positive(),
  translationStale: z.boolean()
});
export type PublishedContentIndexLocalization = z.infer<
  typeof publishedContentIndexLocalizationSchema
>;

export const publishedContentIndexPageSchema = z.object({
  key: contentPageKeySchema,
  pageType: contentPageTypeSchema,
  sourceLocale: contentLocaleSchema,
  revision: z.object({
    id: z.uuid(),
    number: z.number().int().positive(),
    publishedAt: z.iso.datetime()
  }),
  localizations: z.array(publishedContentIndexLocalizationSchema).min(1).max(2)
});
export type PublishedContentIndexPage = z.infer<
  typeof publishedContentIndexPageSchema
>;

export const publishedContentIndexSchema = z.object({
  pages: z.array(publishedContentIndexPageSchema),
  landing: publishedLandingIndexSchema.nullable()
});
export type PublishedContentIndex = z.infer<
  typeof publishedContentIndexSchema
>;

export const contentRevisionStatusSchema = z.enum(["draft", "published"]);
export type ContentRevisionStatus = z.infer<typeof contentRevisionStatusSchema>;

export const adminContentRevisionSummarySchema = z.object({
  id: z.uuid(),
  number: z.number().int().positive(),
  status: contentRevisionStatusSchema,
  requiresReacceptance: z.boolean(),
  createdByUserId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().nullable(),
  locales: z.array(contentLocaleSchema).min(1).max(2)
});
export type AdminContentRevisionSummary = z.infer<
  typeof adminContentRevisionSummarySchema
>;

export const adminContentPageSummarySchema = z.object({
  key: contentPageKeySchema,
  pageType: contentPageTypeSchema,
  sourceLocale: contentLocaleSchema,
  localizations: z.array(z.object({
    locale: contentLocaleSchema,
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  })).min(1).max(2),
  publishedRevision: adminContentRevisionSummarySchema.nullable(),
  draftRevision: adminContentRevisionSummarySchema.nullable()
});
export type AdminContentPageSummary = z.infer<
  typeof adminContentPageSummarySchema
>;

export const adminContentLocalizedRevisionSchema = z.object({
  key: contentPageKeySchema,
  pageType: contentPageTypeSchema,
  sourceLocale: contentLocaleSchema,
  locale: contentLocaleSchema,
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string().trim().min(1).max(180),
  summary: z.string().trim().min(1).max(1000),
  sections: z.array(contentSectionSchema).min(1).max(40),
  seoTitle: z.string().trim().min(1).max(180),
  seoDescription: z.string().trim().min(1).max(500),
  revision: adminContentRevisionSummarySchema.omit({ locales: true }).extend({
    sourceRevisionNumber: z.number().int().positive()
  })
});
export type AdminContentLocalizedRevision = z.infer<
  typeof adminContentLocalizedRevisionSchema
>;

export const contentDraftUpdateInputSchema = z.object({
  locale: contentLocaleSchema,
  title: z.string().trim().min(1).max(180),
  summary: z.string().trim().min(1).max(1000),
  sections: z.array(contentSectionSchema).min(1).max(40),
  seoTitle: z.string().trim().min(1).max(180),
  seoDescription: z.string().trim().min(1).max(500),
  sourceRevisionNumber: z.number().int().positive(),
  requiresReacceptance: z.boolean()
});
export type ContentDraftUpdateInput = z.infer<
  typeof contentDraftUpdateInputSchema
>;

export const contentAdminActionInputSchema = z.object({
  reason: z.string().trim().min(3).max(500)
});
export type ContentAdminActionInput = z.infer<
  typeof contentAdminActionInputSchema
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
