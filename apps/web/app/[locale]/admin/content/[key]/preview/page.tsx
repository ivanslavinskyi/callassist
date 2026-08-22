import {
  contentLocaleSchema,
  contentPageKeySchema
} from "@callassist/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentDraftPreview } from "@/components/content-draft-preview";
import { isUiLocale } from "@/lib/i18n/messages";
import { getServerContentPreview } from "@/lib/server-content-admin";

export const metadata: Metadata = {
  title: "CallAssist content preview",
  robots: { index: false, follow: false }
};

export default async function ContentPreviewPage({ params, searchParams }: {
  params: Promise<{ locale: string; key: string }>;
  searchParams: Promise<{ contentLocale?: string }>;
}) {
  const [{ locale, key }, query] = await Promise.all([params, searchParams]);
  if (!isUiLocale(locale)) notFound();
  const parsedKey = contentPageKeySchema.safeParse(key);
  const parsedLocale = contentLocaleSchema.safeParse(query.contentLocale);
  if (!parsedKey.success || !parsedLocale.success) notFound();
  const page = await getServerContentPreview(parsedKey.data, parsedLocale.data);
  if (!page) notFound();
  return <ContentDraftPreview interfaceLocale={locale} page={page} />;
}
