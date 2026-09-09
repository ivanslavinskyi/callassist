import { randomUUID } from "node:crypto";
import {
  accountLanguagePreferencesUpdateInputSchema,
  accountLanguagePreferencesUpdateResponseSchema,
  userSchema
} from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { AuthService } from "./auth-service";
import { resolveEmailLocale } from "./email-provider";
import { InMemoryAuthRepository } from "./in-memory-auth-repository";
import { MockVerificationProvider } from "./verification-provider";

async function createFixture() {
  const repository = new InMemoryAuthRepository();
  const user = await repository.createUser({
    email: `language-${randomUUID()}@example.com`,
    passwordHash: "unused-test-password-hash",
    phoneE164: "+41710000000",
    firstName: "Nina",
    lastName: "Keller",
    uiLocale: "de"
  });
  const service = new AuthService({
    repository,
    verificationProvider: new MockVerificationProvider("123456"),
    signupCreditGranter: { async grantSignupCredits() {} }
  });
  return { repository, user, service };
}

describe("account language preferences", () => {
  it("keeps automatic content selection independent from registration UI", async () => {
    const { user } = await createFixture();
    expect(user).toMatchObject({ uiLocale: "de", preferredContentLanguage: null });
    const { preferredContentLanguage: _preference, ...legacyUser } = user;
    expect(userSchema.parse(legacyUser).preferredContentLanguage).toBeNull();
    expect(userSchema.parse({
      ...legacyUser,
      uiLocale: "uk",
      preferredContentLanguage: "fr-CH"
    })).toMatchObject({ uiLocale: "uk", preferredContentLanguage: "fr-CH" });
  });

  it("updates only supplied preferences and explicitly restores automatic mode", async () => {
    const { repository, service, user } = await createFixture();
    const explicit = await service.updateLanguagePreferences(user.id, {
      preferredContentLanguage: "ru"
    });
    expect(accountLanguagePreferencesUpdateResponseSchema.parse(explicit))
      .toMatchObject({
        status: "language_preferences_updated",
        user: { uiLocale: "de", preferredContentLanguage: "ru" }
      });
    expect(explicit.user).not.toHaveProperty("passwordHash");
    await expect(service.updateLanguagePreferences(user.id, {
      uiLocale: "en"
    })).resolves.toMatchObject({
      user: { uiLocale: "en", preferredContentLanguage: "ru" }
    });
    await expect(service.updateLanguagePreferences(user.id, {
      preferredContentLanguage: null
    })).resolves.toMatchObject({
      user: { uiLocale: "en", preferredContentLanguage: null }
    });
    expect(await repository.findUserByEmail(user.email)).toMatchObject({
      uiLocale: "en",
      preferredContentLanguage: null
    });
  });

  it("does not lose either field when separate updates run together", async () => {
    const { repository, user } = await createFixture();
    await Promise.all([
      repository.updateLanguagePreferences(user.id, { uiLocale: "en" }),
      repository.updateLanguagePreferences(user.id, { preferredContentLanguage: "uk" })
    ]);
    expect(await repository.findUserByEmail(user.email)).toMatchObject({
      uiLocale: "en", preferredContentLanguage: "uk"
    });
  });

  it("rejects writes to missing, suspended, deleted or deletion-pending accounts", async () => {
    const { repository, service, user } = await createFixture();
    await expect(service.updateLanguagePreferences(randomUUID(), {
      uiLocale: "en"
    })).rejects.toMatchObject({ code: "PROFILE_UPDATE_NOT_AVAILABLE" });
    for (const status of ["suspended", "deleted"] as const) {
      await repository.setUserStatusForTest(user.id, status);
      await expect(service.updateLanguagePreferences(user.id, {
        uiLocale: "en"
      })).rejects.toMatchObject({ code: "PROFILE_UPDATE_NOT_AVAILABLE" });
    }
    await repository.setUserStatusForTest(user.id, "active");
    await repository.requestAccountDeletion({
      requestId: randomUUID(), userId: user.id,
      now: new Date().toISOString(), maxAttempts: 3
    });
    await expect(service.updateLanguagePreferences(user.id, {
      preferredContentLanguage: "ru"
    })).rejects.toMatchObject({ code: "PROFILE_UPDATE_NOT_AVAILABLE" });
    expect(await repository.findUserByEmail(user.email)).toMatchObject({
      uiLocale: "de", preferredContentLanguage: null
    });
  });

  it("accepts enabled writes only and rejects no-op or unrelated patches", () => {
    for (const invalid of [
      {}, { uiLocale: undefined }, { uiLocale: "uk" },
      { preferredContentLanguage: "xx" }, { uiLocale: null },
      { uiLocale: "en", userId: randomUUID() },
      { preferredContentLanguage: "en_US" }
    ]) {
      expect(accountLanguagePreferencesUpdateInputSchema.safeParse(invalid).success)
        .toBe(false);
    }
    expect(accountLanguagePreferencesUpdateInputSchema.parse({
      uiLocale: "de", preferredContentLanguage: "uk"
    })).toEqual({ uiLocale: "de", preferredContentLanguage: "uk" });
    expect(accountLanguagePreferencesUpdateInputSchema.parse({
      preferredContentLanguage: null
    })).toEqual({ preferredContentLanguage: null });
  });
});

describe("email template locale", () => {
  it.each([
    ["de", "de"], ["de-CH", "de"], ["DE-at", "de"],
    ["en-GB", "en"], ["uk", "en"], ["ru", "en"],
    ["invalid_locale", "en"], [null, "en"], [undefined, "en"]
  ] as const)("resolves %s to a ready %s template", (input, expected) => {
    expect(resolveEmailLocale(input)).toBe(expected);
  });
});
