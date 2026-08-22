import {
  localizeLandingBlock,
  type AdminEditorialRevision,
  type ContentLocale,
  type PublishedLanding
} from "@callassist/contracts";

type LandingRevision = Extract<AdminEditorialRevision, { key: "landing" }>;

export function toPublishedLandingPreview(
  revision: LandingRevision,
  locale: ContentLocale
): PublishedLanding {
  const hero = revision.items.find(({ blockType }) => blockType === "hero");
  if (!hero || hero.blockType !== "hero") {
    throw new Error("Landing preview requires a hero block");
  }
  return {
    locale,
    revision: {
      id: revision.id,
      number: revision.number,
      publishedAt: revision.updatedAt
    },
    blocks: revision.items
      .filter(({ enabled }) => enabled)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((block) => localizeLandingBlock(block, locale)),
    seo: {
      title: hero.seoTitle[locale],
      description: hero.seoDescription[locale]
    }
  };
}
