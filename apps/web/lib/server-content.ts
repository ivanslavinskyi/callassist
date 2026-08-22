import "server-only";

import type {
  ContentLocale,
  PublishedContentPage
} from "@callassist/contracts";
import { cache } from "react";

const internalApiUrl = (
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000"
).replace(/\/$/, "");

export const getPublishedContentPage = cache(async (
  locale: ContentLocale,
  slug: string
): Promise<PublishedContentPage | null> => {
  const response = await fetch(
    `${internalApiUrl}/api/content/pages/${encodeURIComponent(slug)}?locale=${locale}`,
    { next: { revalidate: 60 } }
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Unable to load published content (HTTP ${response.status})`);
  }
  const payload = await response.json() as { page: PublishedContentPage };
  return payload.page;
});
