import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingDraftPreview } from "@/components/landing-draft-preview";
import { isUiLocale } from "@/lib/i18n/messages";
import { toPublishedLandingPreview } from "@/lib/landing-preview";
import { getPublishedFaq } from "@/lib/server-content";
import { getServerEditorialPreview } from "@/lib/server-content-admin";

export const metadata: Metadata = {
  title: "CallAssist Landing preview",
  robots: { index: false, follow: false }
};

export default async function LandingPreviewPage({ params }: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isUiLocale(locale)) notFound();
  const [revision, faq] = await Promise.all([
    getServerEditorialPreview("landing"),
    getPublishedFaq(locale)
  ]);
  if (!revision || revision.key !== "landing") notFound();
  return (
    <LandingDraftPreview
      faq={faq}
      interfaceLocale={locale}
      landing={toPublishedLandingPreview(revision, locale)}
    />
  );
}
