import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import {
  contentAdminRedirect,
  operationalAdminRedirect
} from "@/lib/route-access";
import {
  getServerCurrentUser,
  getServerOnboardingStatus
} from "@/lib/server-auth";
import type { UiLocale } from "@/lib/i18n/messages";

export async function AdminRouteBoundary({
  children,
  locale,
  scope
}: {
  children: ReactNode;
  locale: UiLocale;
  scope: "content" | "operations";
}) {
  const [user, onboarding] = await Promise.all([
    getServerCurrentUser(),
    getServerOnboardingStatus(locale)
  ]);
  const destination = scope === "content"
    ? contentAdminRedirect(user, onboarding, locale)
    : operationalAdminRedirect(user, onboarding, locale);
  if (destination) redirect(destination);
  return children;
}
