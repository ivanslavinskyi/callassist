import type {
  ContentLocale,
  ContentPageKey,
  OnboardingAcceptanceInput,
  OnboardingStatus,
  PublishedContentPage
} from "@callassist/contracts";

export type SeedContentPage = PublishedContentPage & {
  pageId: string;
  localizationId: string;
  revisionLocalizationId: string;
};

export interface ContentRepository {
  readonly mode: "memory" | "postgres";
  initializeSeedContent(pages: SeedContentPage[]): Promise<void>;
  getPublishedPage(
    locale: ContentLocale,
    slug: string
  ): Promise<PublishedContentPage | null>;
  getOnboardingStatus(
    userId: string,
    locale: ContentLocale
  ): Promise<OnboardingStatus>;
  hasCurrentAcceptance(userId: string): Promise<boolean>;
  acceptOnboarding(
    userId: string,
    input: OnboardingAcceptanceInput,
    acceptedAt: string
  ): Promise<void>;
  close(): Promise<void>;
}

export class ContentRepositoryError extends Error {
  constructor(
    readonly code:
      | "LEGAL_CONTENT_UNAVAILABLE"
      | "LEGAL_REVISION_CHANGED"
      | "USER_NOT_FOUND",
    options?: { cause?: unknown }
  ) {
    super(code, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ContentRepositoryError";
  }
}

export function legalKey(key: ContentPageKey) {
  return key === "terms" || key === "acceptable_use";
}
