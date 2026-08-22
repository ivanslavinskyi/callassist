import "server-only";

import type { ContentLocale, ContentPageKey } from "@callassist/contracts";
import { headers } from "next/headers";
import { fetchServerContentPreview } from "./server-admin-content";

const internalApiUrl = (
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000"
).replace(/\/$/, "");

export async function getServerContentPreview(
  key: ContentPageKey,
  locale: ContentLocale
) {
  const requestHeaders = await headers();
  return fetchServerContentPreview({
    apiUrl: internalApiUrl,
    cookie: requestHeaders.get("cookie") ?? "",
    key,
    locale
  });
}
