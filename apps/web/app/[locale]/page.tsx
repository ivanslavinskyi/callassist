import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicHome } from "@/components/public-home";
import { isUiLocale } from "@/lib/i18n/messages";
import { homeMetadata } from "@/lib/seo-metadata";
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
  const [landing, index] = await Promise.all([getPublishedLanding(locale), getPublishedContentIndex()]);
  return homeMetadata(locale, landing, index.landing);
}

export default async function HomePage({ params }: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isUiLocale(locale)) notFound();
  const [landing, faq] = await Promise.all([
    getPublishedLanding(locale),
    getPublishedFaq(locale)
  ]);
  if (!landing) notFound();
  return <PublicHome faq={faq} landing={landing} />;
}
