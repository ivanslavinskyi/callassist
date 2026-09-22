import "server-only";
import { cache } from "react";
import type { PublishedOgImage } from "@callassist/contracts";

export const ogInternalApiUrl = (process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
// Published pointers are read fresh. Image bytes are immutable and cached separately.
export const getPublishedOgImages = cache(async (): Promise<PublishedOgImage[]> => {
  try {
    const response = await fetch(`${ogInternalApiUrl}/api/content/og`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!response.ok) return [];
    return ((await response.json()) as { images: PublishedOgImage[] }).images;
  } catch { return []; }
});
