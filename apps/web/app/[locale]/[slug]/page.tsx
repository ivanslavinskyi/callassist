import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentPage } from "@/components/content-page";
import { isUiLocale } from "@/lib/i18n/messages";
import { contentPageMetadata } from "@/lib/seo-metadata";
import {
  getPublishedContentIndex,
  getPublishedContentPage,
  getPublishedFaq
} from "@/lib/server-content";

export async function generateMetadata({ params }: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isUiLocale(locale)) return {};
  const [page, index] = await Promise.all([
    getPublishedContentPage(locale, slug),
    getPublishedContentIndex()
  ]);
  if (!page) return {};
  return contentPageMetadata(
    page,
    index.pages.find(({ key }) => key === page.key)
  );
}

export default async function PublicContentPage({ params }: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isUiLocale(locale)) notFound();
  const page = await getPublishedContentPage(locale, slug);
  if (!page) notFound();
  const faq = page.key === "faq" ? await getPublishedFaq(locale) : null;
  return <ContentPage faq={faq} page={page} />;
}
