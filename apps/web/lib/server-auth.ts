import "server-only";

import type { ContentLocale, User } from "@callassist/contracts";
import { headers } from "next/headers";
import { cache } from "react";
import {
  fetchServerCurrentUser,
  fetchServerOnboardingStatus
} from "./server-current-user";

const internalApiUrl = (
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:4000"
).replace(/\/$/, "");

export const getServerCurrentUser = cache(async (): Promise<User | null> => {
  const requestHeaders = await headers();
  return fetchServerCurrentUser({
    apiUrl: internalApiUrl,
    cookie: requestHeaders.get("cookie") ?? ""
  });
});

export const getServerOnboardingStatus = cache(async (locale: ContentLocale) => {
  const requestHeaders = await headers();
  return fetchServerOnboardingStatus({
    apiUrl: internalApiUrl,
    cookie: requestHeaders.get("cookie") ?? "",
    locale
  });
});
