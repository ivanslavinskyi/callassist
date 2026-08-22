import type {
  AdminContentLocalizedRevision,
  AdminContentPageSummary,
  AdminContentRevisionSummary,
  ContentLocale,
  ContentDraftUpdateInput,
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
  listAdminPages(): Promise<AdminContentPageSummary[]>;
  getAdminRevision(
    key: ContentPageKey,
    locale: ContentLocale,
    selector: { status: "draft" | "published" } | { revisionNumber: number }
  ): Promise<AdminContentLocalizedRevision | null>;
  listAdminRevisions(key: ContentPageKey): Promise<AdminContentRevisionSummary[]>;
  createDraft(
    actorUserId: string,
    key: ContentPageKey,
    createdAt: string
  ): Promise<AdminContentRevisionSummary>;
  updateDraft(
    actorUserId: string,
    key: ContentPageKey,
    input: ContentDraftUpdateInput,
    updatedAt: string
  ): Promise<AdminContentLocalizedRevision>;
  publishDraft(
    actorUserId: string,
    key: ContentPageKey,
    reason: string,
    publishedAt: string
  ): Promise<AdminContentRevisionSummary>;
  createRollbackDraft(
    actorUserId: string,
    key: ContentPageKey,
    sourceRevisionNumber: number,
    reason: string,
    createdAt: string
  ): Promise<AdminContentRevisionSummary>;
  close(): Promise<void>;
}

export class ContentRepositoryError extends Error {
  constructor(
    readonly code:
      | "LEGAL_CONTENT_UNAVAILABLE"
      | "LEGAL_REVISION_CHANGED"
      | "USER_NOT_FOUND"
      | "CONTENT_PAGE_NOT_FOUND"
      | "CONTENT_DRAFT_EXISTS"
      | "CONTENT_DRAFT_NOT_FOUND"
      | "CONTENT_REVISION_NOT_FOUND"
      | "CONTENT_REACCEPTANCE_INVALID",
    options?: { cause?: unknown }
  ) {
    super(code, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ContentRepositoryError";
  }
}

export function legalKey(key: ContentPageKey) {
  return key === "terms" || key === "acceptable_use";
}
