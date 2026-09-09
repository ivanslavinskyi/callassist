import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { isUiLocale } from "@/lib/i18n/messages";
import {
  contentAdminRedirect,
  operationalAdminRedirect
} from "@/lib/route-access";
import {
  getServerCurrentUser,
  getServerOnboardingStatus
} from "@/lib/server-auth";

export async function AdminRouteBoundary({
  children,
  scope
}: {
  children: ReactNode;
  scope: "content" | "operations";
}) {
  const user = await getServerCurrentUser();
  const locale = user && isUiLocale(user.uiLocale) ? user.uiLocale : "en";
  const onboarding = user
    ? await getServerOnboardingStatus(locale)
    : null;
  const destination = scope === "content"
    ? contentAdminRedirect(user, onboarding, locale)
    : operationalAdminRedirect(user, onboarding, locale);
  if (destination) redirect(destination);
  return children;
}
