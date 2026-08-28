import {
  contentLocaleSchema,
  contentPageKeySchema
} from "@callassist/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentDraftPreview } from "@/components/content-draft-preview";
import { getServerContentPreview } from "@/lib/server-content-admin";

export const metadata: Metadata = {
  title: "SHPROHLI content preview",
  robots: { index: false, follow: false }
};

export default async function ContentPreviewPage({ params, searchParams }: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ contentLocale?: string }>;
}) {
  const [{ key }, query] = await Promise.all([params, searchParams]);
  const parsedKey = contentPageKeySchema.safeParse(key);
  const parsedLocale = contentLocaleSchema.safeParse(query.contentLocale);
  if (!parsedKey.success || !parsedLocale.success) notFound();
  const page = await getServerContentPreview(parsedKey.data, parsedLocale.data);
  if (!page) notFound();
  return <ContentDraftPreview interfaceLocale="en" page={page} />;
}
