import type { MetadataRoute } from "next";
import { getPublishedContentIndex } from "@/lib/server-content";
import { buildSitemap } from "@/lib/seo-sitemap";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const index = await getPublishedContentIndex();
  return buildSitemap(index);
}
