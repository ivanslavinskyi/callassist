import { contentLocaleSchema } from "@callassist/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingDraftPreview } from "@/components/landing-draft-preview";
import { toPublishedLandingPreview } from "@/lib/landing-preview";
import { getPublishedFaq } from "@/lib/server-content";
import { getServerEditorialPreview } from "@/lib/server-content-admin";

export const metadata: Metadata = {
  title: "SHPROHLI Landing preview",
  robots: { index: false, follow: false }
};

export default async function LandingPreviewPage({ searchParams }: {
  searchParams: Promise<{ contentLocale?: string }>;
}) {
  const query = await searchParams;
  const parsedLocale = contentLocaleSchema.safeParse(query.contentLocale ?? "en");
  if (!parsedLocale.success) notFound();
  const contentLocale = parsedLocale.data;
  const [revision, faq] = await Promise.all([
    getServerEditorialPreview("landing"),
    getPublishedFaq(contentLocale)
  ]);
  if (!revision || revision.key !== "landing") notFound();
  return (
    <LandingDraftPreview
      faq={faq}
      interfaceLocale="en"
      landing={toPublishedLandingPreview(revision, contentLocale)}
    />
  );
}
