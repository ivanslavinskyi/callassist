import type { OnboardingStatus, User } from "@callassist/contracts";

export function authenticatedAppRedirect(
  user: User | null,
  onboarding: OnboardingStatus | null,
  locale: string
) {
  if (!user) return `/${locale}/login`;
  return onboarding?.required === false ? null : `/${locale}/onboarding`;
}

export function adminAreaRedirect(
  user: User | null,
  onboarding: OnboardingStatus | null,
  locale: string
) {
  if (!user) return `/${locale}/login`;
  if (onboarding?.required !== false) return `/${locale}/onboarding`;
  return user.role === "admin" || user.role === "superadmin"
    ? null
    : `/${locale}/app`;
}

export function onboardingPageRedirect(
  user: User | null,
  onboarding: OnboardingStatus | null,
  locale: string
) {
  if (!user) return `/${locale}/login`;
  return onboarding?.required === false ? `/${locale}/app` : null;
}
