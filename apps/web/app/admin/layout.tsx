import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminSessionProvider } from "@/components/admin-session-provider";
import { adminAreaRedirect } from "@/lib/route-access";
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
  const onboarding = await getServerOnboardingStatus(user.uiLocale);
  const destination = adminAreaRedirect(user, onboarding, user.uiLocale);
  if (destination) redirect(destination);
  return <AdminSessionProvider user={user}>{children}</AdminSessionProvider>;
}
