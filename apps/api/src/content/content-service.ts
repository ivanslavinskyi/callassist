import type {
  ContentLocale,
  OnboardingAcceptanceInput
} from "@callassist/contracts";
import type { ContentRepository } from "./content-repository";
import { seededContentPages } from "./seed-content";

export class ContentService {
  constructor(
    readonly repository: ContentRepository,
    readonly now: () => Date = () => new Date()
  ) {}

  async initialize() {
    await this.repository.initializeSeedContent(seededContentPages);
  }

  async getPublishedPage(locale: ContentLocale, slug: string) {
    return this.repository.getPublishedPage(locale, slug);
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

  async close() {
    await this.repository.close();
  }
}
