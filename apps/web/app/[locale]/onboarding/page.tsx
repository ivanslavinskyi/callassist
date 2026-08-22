import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { OnboardingForm } from "@/components/onboarding-form";
import { isUiLocale } from "@/lib/i18n/messages";
import { onboardingPageRedirect } from "@/lib/route-access";
import {
  getServerCurrentUser,
  getServerOnboardingStatus
} from "@/lib/server-auth";

export const metadata: Metadata = {
  title: "CallAssist onboarding",
  robots: { index: false, follow: false }
};

export default async function OnboardingPage({ params }: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isUiLocale(locale)) notFound();
  const [user, onboarding] = await Promise.all([
    getServerCurrentUser(),
    getServerOnboardingStatus(locale)
  ]);
  const destination = onboardingPageRedirect(user, onboarding, locale);
  if (destination) redirect(destination);
  if (!onboarding) redirect(`/${locale}/login`);
  return <OnboardingForm initialStatus={onboarding} />;
}
