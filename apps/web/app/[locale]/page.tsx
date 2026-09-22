import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicHome } from "@/components/public-home";
import { isUiLocale } from "@/lib/i18n/messages";
import { homeMetadata } from "@/lib/seo-metadata";
import { getPublishedOgImages } from "@/lib/server-og-images";
import { getServerSessionSnapshot } from "@/lib/server-auth";
import {
  getPublishedFaq,
  getPublishedLanding,
  getPublishedContentIndex
} from "@/lib/server-content";

export async function generateMetadata({ params }: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isUiLocale(locale)) return {};
  const [landing, index, images] = await Promise.all([getPublishedLanding(locale), getPublishedContentIndex(), getPublishedOgImages()]);
  return homeMetadata(locale, landing, index.landing, images.find(image => image.locale === locale));
}

export default async function HomePage({ params }: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isUiLocale(locale)) notFound();
  const [landing, faq, initialSession] = await Promise.all([
    getPublishedLanding(locale),
    getPublishedFaq(locale),
    getServerSessionSnapshot()
  ]);
  if (!landing) notFound();
  const matchingFaq = faq?.locale === landing.locale ? faq : await getPublishedFaq(landing.locale);
  return <PublicHome faq={matchingFaq?.locale === landing.locale ? matchingFaq : null} landing={landing} initialSession={initialSession} />;
}
