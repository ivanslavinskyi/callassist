import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { OnboardingForm } from "@/components/onboarding-form";
import { isUiLocale } from "@/lib/i18n/messages";
import { onboardingPageRedirect } from "@/lib/route-access";
import { callResultReturnPath } from "@/lib/auth-return-path";
import {
  getServerCurrentUser,
  getServerOnboardingStatus
} from "@/lib/server-auth";

export const metadata: Metadata = {
  title: "SHPROHLI onboarding",
  robots: { index: false, follow: false }
};

export default async function OnboardingPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { locale } = await params;
  if (!isUiLocale(locale)) notFound();
  const returnTo = callResultReturnPath((await searchParams).returnTo);
  const [user, onboarding] = await Promise.all([
    getServerCurrentUser(),
    getServerOnboardingStatus(locale)
  ]);
  const destination = onboardingPageRedirect(user, onboarding, locale);
  if (destination) redirect(returnTo && destination === `/${locale}/app` ? returnTo
    : returnTo && destination.endsWith("/login") ? `${destination}?returnTo=${encodeURIComponent(returnTo)}` : destination);
  if (!onboarding) redirect(`/${locale}/login`);
  return <OnboardingForm initialStatus={onboarding} returnTo={returnTo} />;
}
