import type {
  AdminContentLocalizedRevision,
  AdminContentPageSummary,
  AdminContentRevisionSummary,
  AdminEditorialRevision,
  ContentLocale,
  ContentDraftUpdateInput,
  ContentPageKey,
  EditorialCollectionKey,
  EditorialDraftUpdateInput,
  EditorialRevisionSummary,
  OnboardingAcceptanceInput,
  OnboardingAcceptanceRecord,
  OnboardingStatus,
  PublishedContentIndex,
  PublishedContentPage,
  PublishedFaq,
  PublishedLanding,
  PublishedNavigation
} from "@callassist/contracts";

export type SeedContentPage = PublishedContentPage & {
  pageId: string;
  localizationId: string;
  revisionLocalizationId: string;
};

export type SeedEditorialCollection = {
  collectionId: string;
  revision: AdminEditorialRevision;
};

export interface ContentRepository {
  readonly mode: "memory" | "postgres";
  initializeSeedContent(pages: SeedContentPage[]): Promise<void>;
  initializeSeedEditorialCollections(
    collections: SeedEditorialCollection[]
  ): Promise<void>;
  getPublishedPage(
    locale: ContentLocale,
    slug: string
  ): Promise<PublishedContentPage | null>;
  listPublishedContentIndex(): Promise<PublishedContentIndex>;
  getPublishedFaq(locale: ContentLocale): Promise<PublishedFaq | null>;
  getPublishedLanding(locale: ContentLocale): Promise<PublishedLanding | null>;
  getPublishedNavigation(
    locale: ContentLocale
  ): Promise<PublishedNavigation | null>;
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
  listOnboardingAcceptances(
    userId: string
  ): Promise<OnboardingAcceptanceRecord[]>;
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
  getAdminEditorialCollection(key: EditorialCollectionKey): Promise<{
    published: AdminEditorialRevision | null;
    draft: AdminEditorialRevision | null;
  }>;
  listAdminEditorialRevisions(
    key: EditorialCollectionKey
  ): Promise<EditorialRevisionSummary[]>;
  createEditorialDraft(
    actorUserId: string,
    key: EditorialCollectionKey,
    createdAt: string
  ): Promise<EditorialRevisionSummary>;
  updateEditorialDraft(
    actorUserId: string,
    key: EditorialCollectionKey,
    input: EditorialDraftUpdateInput,
    updatedAt: string
  ): Promise<AdminEditorialRevision>;
  publishEditorialDraft(
    actorUserId: string,
    key: EditorialCollectionKey,
    reason: string,
    publishedAt: string
  ): Promise<EditorialRevisionSummary>;
  createEditorialRollbackDraft(
    actorUserId: string,
    key: EditorialCollectionKey,
    sourceRevisionNumber: number,
    reason: string,
    createdAt: string
  ): Promise<EditorialRevisionSummary>;
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
      | "CONTENT_REACCEPTANCE_INVALID"
      | "EDITORIAL_COLLECTION_NOT_FOUND"
      | "EDITORIAL_DRAFT_EXISTS"
      | "EDITORIAL_DRAFT_NOT_FOUND"
      | "EDITORIAL_REVISION_NOT_FOUND"
      | "EDITORIAL_COLLECTION_MISMATCH"
      | "EDITORIAL_DESTINATION_UNAVAILABLE",
    options?: { cause?: unknown }
  ) {
    super(code, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ContentRepositoryError";
  }
}

export function legalKey(key: ContentPageKey) {
  return key === "terms" || key === "acceptable_use";
}
