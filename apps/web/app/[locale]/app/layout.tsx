import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { authenticatedAppRedirect } from "@/lib/route-access";
import {
  getServerCurrentUser,
  getServerOnboardingStatus
} from "@/lib/server-auth";
import { isUiLocale } from "@/lib/i18n/messages";

export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

export default async function AuthenticatedAppLayout({ children, params }: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isUiLocale(locale)) notFound();
  const [user, onboarding] = await Promise.all([
    getServerCurrentUser(),
    getServerOnboardingStatus(locale)
  ]);
  const destination = authenticatedAppRedirect(user, onboarding, locale);
  if (destination) redirect(destination);
  return children;
}
