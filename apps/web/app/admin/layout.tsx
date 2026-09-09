import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminSessionProvider } from "@/components/admin-session-provider";
import { adminAreaRedirect } from "@/lib/route-access";
import { isUiLocale } from "@/lib/i18n/messages";
import {
  getServerCurrentUser,
  getServerOnboardingStatus
} from "@/lib/server-auth";

export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

export default async function AdminLayout({ children }: {
  children: ReactNode;
}) {
  const user = await getServerCurrentUser();
  if (!user) redirect("/en/login");
  const locale = isUiLocale(user.uiLocale) ? user.uiLocale : "en";
  const onboarding = await getServerOnboardingStatus(locale);
  const destination = adminAreaRedirect(user, onboarding, locale);
  if (destination) redirect(destination);
  return <AdminSessionProvider user={user}>{children}</AdminSessionProvider>;
}
