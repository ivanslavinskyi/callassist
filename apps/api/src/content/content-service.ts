import type {
  ContentLocale,
  ContentDraftUpdateInput,
  ContentPageKey,
  EditorialCollectionKey,
  EditorialDraftUpdateInput,
  OnboardingAcceptanceInput
} from "@callassist/contracts";
import {
  ContentRepositoryError,
  legalKey,
  type ContentRepository
} from "./content-repository";
import {
  seededContentPages,
  seededEditorialCollections
} from "./seed-content";

export class ContentService {
  constructor(
    readonly repository: ContentRepository,
    readonly now: () => Date = () => new Date()
  ) {}

  async initialize() {
    await this.repository.initializeSeedContent(seededContentPages);
    await this.repository.initializeSeedEditorialCollections(
      seededEditorialCollections
    );
  }

  async getPublishedPage(locale: ContentLocale, slug: string) {
    return this.repository.getPublishedPage(locale, slug);
  }

  async listPublishedContentIndex() {
    return this.repository.listPublishedContentIndex();
  }

  async getPublishedFaq(locale: ContentLocale) {
    return this.repository.getPublishedFaq(locale);
  }

  async getPublishedNavigation(locale: ContentLocale) {
    return this.repository.getPublishedNavigation(locale);
  }

  async getOnboardingStatus(userId: string, locale: ContentLocale) {
    return this.repository.getOnboardingStatus(userId, locale);
  }

  async hasCurrentAcceptance(userId: string) {
    return this.repository.hasCurrentAcceptance(userId);
  }

  async acceptOnboarding(userId: string, input: OnboardingAcceptanceInput) {
    await this.repository.acceptOnboarding(
      userId,
      input,
      this.now().toISOString()
    );
    return this.repository.getOnboardingStatus(userId, input.locale);
  }

  async listAdminPages() {
    return this.repository.listAdminPages();
  }

  async getAdminPage(
    key: ContentPageKey,
    locale: ContentLocale
  ) {
    const [published, draft] = await Promise.all([
      this.repository.getAdminRevision(key, locale, { status: "published" }),
      this.repository.getAdminRevision(key, locale, { status: "draft" })
    ]);
    if (!published && !draft) {
      throw new ContentRepositoryError("CONTENT_PAGE_NOT_FOUND");
    }
    return { published, draft };
  }

  async getAdminPreview(key: ContentPageKey, locale: ContentLocale) {
    const draft = await this.repository.getAdminRevision(
      key,
      locale,
      { status: "draft" }
    );
    if (!draft) throw new ContentRepositoryError("CONTENT_DRAFT_NOT_FOUND");
    return draft;
  }

  async listAdminRevisions(key: ContentPageKey) {
    return this.repository.listAdminRevisions(key);
  }

  async createDraft(actorUserId: string, key: ContentPageKey) {
    return this.repository.createDraft(
      actorUserId,
      key,
      this.now().toISOString()
    );
  }

  async updateDraft(
    actorUserId: string,
    key: ContentPageKey,
    input: ContentDraftUpdateInput
  ) {
    if (!legalKey(key) && input.requiresReacceptance) {
      throw new ContentRepositoryError("CONTENT_REACCEPTANCE_INVALID");
    }
    return this.repository.updateDraft(
      actorUserId,
      key,
      input,
      this.now().toISOString()
    );
  }

  async publishDraft(actorUserId: string, key: ContentPageKey, reason: string) {
    return this.repository.publishDraft(
      actorUserId,
      key,
      reason,
      this.now().toISOString()
    );
  }

  async createRollbackDraft(
    actorUserId: string,
    key: ContentPageKey,
    sourceRevisionNumber: number,
    reason: string
  ) {
    return this.repository.createRollbackDraft(
      actorUserId,
      key,
      sourceRevisionNumber,
      reason,
      this.now().toISOString()
    );
  }

  async getAdminEditorialCollection(key: EditorialCollectionKey) {
    const collection = await this.repository.getAdminEditorialCollection(key);
    if (!collection.published && !collection.draft) {
      throw new ContentRepositoryError("EDITORIAL_COLLECTION_NOT_FOUND");
    }
    return collection;
  }

  async listAdminEditorialRevisions(key: EditorialCollectionKey) {
    return this.repository.listAdminEditorialRevisions(key);
  }

  async createEditorialDraft(
    actorUserId: string,
    key: EditorialCollectionKey
  ) {
    return this.repository.createEditorialDraft(
      actorUserId,
      key,
      this.now().toISOString()
    );
  }

  async updateEditorialDraft(
    actorUserId: string,
    key: EditorialCollectionKey,
    input: EditorialDraftUpdateInput
  ) {
    if (key !== input.key) {
      throw new ContentRepositoryError("EDITORIAL_COLLECTION_MISMATCH");
    }
    return this.repository.updateEditorialDraft(
      actorUserId,
      key,
      input,
      this.now().toISOString()
    );
  }

  async publishEditorialDraft(
    actorUserId: string,
    key: EditorialCollectionKey,
    reason: string
  ) {
    return this.repository.publishEditorialDraft(
      actorUserId,
      key,
      reason,
      this.now().toISOString()
    );
  }

  async createEditorialRollbackDraft(
    actorUserId: string,
    key: EditorialCollectionKey,
    sourceRevisionNumber: number,
    reason: string
  ) {
    return this.repository.createEditorialRollbackDraft(
      actorUserId,
      key,
      sourceRevisionNumber,
      reason,
      this.now().toISOString()
    );
  }

  async close() {
    await this.repository.close();
  }
}
