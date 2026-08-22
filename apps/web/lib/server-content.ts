import "server-only";

import type {
  ContentLocale,
  PublishedContentIndex,
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

export const getPublishedContentIndex = cache(async (): Promise<
  PublishedContentIndex
> => {
  const response = await fetch(`${internalApiUrl}/api/content/index`, {
    next: { revalidate: 60 }
  });
  if (!response.ok) {
    throw new Error(`Unable to load published content index (HTTP ${response.status})`);
  }
  return response.json() as Promise<PublishedContentIndex>;
});
