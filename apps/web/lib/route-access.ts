import type { OnboardingStatus, User } from "@callassist/contracts";

export function authenticatedAppRedirect(
  user: User | null,
  onboarding: OnboardingStatus | null,
  locale: string
) {
  if (!user) return `/${locale}/login`;
  if (onboarding?.required !== false) return `/${locale}/onboarding`;
  return user.role === "content_editor"
    ? "/admin/content"
    : null;
}

export function adminAreaRedirect(
  user: User | null,
  onboarding: OnboardingStatus | null,
  locale: string
) {
  if (!user) return `/${locale}/login`;
  if (onboarding?.required !== false) return `/${locale}/onboarding`;
  return ["content_editor", "admin", "superadmin"].includes(user.role)
    ? null
    : `/${locale}/app`;
}

export function operationalAdminRedirect(
  user: User | null,
  onboarding: OnboardingStatus | null,
  locale: string
) {
  const sharedDestination = adminAreaRedirect(user, onboarding, locale);
  if (sharedDestination) return sharedDestination;
  return user?.role === "content_editor"
    ? "/admin/content"
    : null;
}

export function contentAdminRedirect(
  user: User | null,
  onboarding: OnboardingStatus | null,
  locale: string
) {
  return adminAreaRedirect(user, onboarding, locale);
}

export function onboardingPageRedirect(
  user: User | null,
  onboarding: OnboardingStatus | null,
  locale: string
) {
  if (!user) return `/${locale}/login`;
  if (onboarding?.required !== false) return null;
  return user.role === "content_editor"
    ? "/admin/content"
    : `/${locale}/app`;
}
