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

export async function AdminRouteBoundary({
  children,
  scope
}: {
  children: ReactNode;
  scope: "content" | "operations";
}) {
  const user = await getServerCurrentUser();
  const onboarding = user
    ? await getServerOnboardingStatus(user.uiLocale)
    : null;
  const locale = user?.uiLocale ?? "en";
  const destination = scope === "content"
    ? contentAdminRedirect(user, onboarding, locale)
    : operationalAdminRedirect(user, onboarding, locale);
  if (destination) redirect(destination);
  return children;
}
