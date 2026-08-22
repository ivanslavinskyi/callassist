import type { User } from "@callassist/contracts";

export function authenticatedAppRedirect(
  user: User | null,
  locale: string
) {
  return user ? null : `/${locale}/login`;
}

export function adminAreaRedirect(user: User | null, locale: string) {
  if (!user) return `/${locale}/login`;
  return user.role === "admin" || user.role === "superadmin"
    ? null
    : `/${locale}/app`;
}
