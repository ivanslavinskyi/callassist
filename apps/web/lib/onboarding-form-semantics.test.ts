import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { onboardingMessages } from "./i18n/onboarding-messages";

const onboardingForm = readFileSync(fileURLToPath(
  new URL("../components/onboarding-form.tsx", import.meta.url)
), "utf8");

describe("onboarding copy and form semantics", () => {
  it("presents one explicit legal agreement", () => {
    expect(onboardingForm.match(/type="checkbox"/gu)).toHaveLength(1);
    expect(onboardingForm).toContain('name="legalAgreement"');
    expect(onboardingMessages.en.agreement).toBe(
      "I agree to the Terms of Use and Acceptable Use Policy."
    );
    expect(onboardingMessages.de.agreement).toBe(
      "Ich stimme den Nutzungsbedingungen und den Regeln zur akzeptablen Nutzung zu."
    );
  });

  it("keeps privacy informational and legacy fields internal", () => {
    expect(onboardingForm).toContain('contentPath(locale, "privacy")');
    expect(onboardingForm).not.toContain('name="acknowledgeConsent"');
    expect(onboardingForm).not.toContain('name="acknowledgeRetention"');
    expect(onboardingForm).not.toContain('name="acknowledgeUseLimits"');
    expect(onboardingForm).not.toContain('name="acknowledgeCredits"');
    expect(onboardingMessages.en.information).toHaveLength(3);
    expect(onboardingMessages.de.information).toHaveLength(3);
  });
});
