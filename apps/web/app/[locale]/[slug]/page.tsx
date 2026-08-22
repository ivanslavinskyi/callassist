import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentPage } from "@/components/content-page";
import { isUiLocale } from "@/lib/i18n/messages";
import { getPublishedContentPage } from "@/lib/server-content";

export async function generateMetadata({ params }: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isUiLocale(locale)) return {};
  const page = await getPublishedContentPage(locale, slug);
  if (!page) return {};
  return {
    title: page.seoTitle,
    description: page.seoDescription
  };
}

export default async function PublicContentPage({ params }: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isUiLocale(locale)) notFound();
  const page = await getPublishedContentPage(locale, slug);
  if (!page) notFound();
  return <ContentPage page={page} />;
}
