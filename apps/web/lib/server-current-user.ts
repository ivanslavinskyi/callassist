import type {
  ContentLocale,
  OnboardingStatus,
  User
} from "@callassist/contracts";

export async function fetchServerCurrentUser({
  apiUrl,
  cookie,
  fetcher = fetch
}: {
  apiUrl: string;
  cookie: string;
  fetcher?: typeof fetch;
}): Promise<User | null> {
  const response = await fetcher(`${apiUrl.replace(/\/$/, "")}/api/auth/me`, {
    cache: "no-store",
    headers: cookie ? { cookie } : undefined
  });

  if (response.status === 401) return null;
  if (!response.ok) {
    throw new Error(`Unable to verify the current session (HTTP ${response.status})`);
  }

  const payload = await response.json() as { user: User };
  return payload.user;
}

export async function fetchServerOnboardingStatus({
  apiUrl,
  cookie,
  locale,
  fetcher = fetch
}: {
  apiUrl: string;
  cookie: string;
  locale: ContentLocale;
  fetcher?: typeof fetch;
}): Promise<OnboardingStatus | null> {
  const response = await fetcher(
    `${apiUrl.replace(/\/$/, "")}/api/onboarding/status?locale=${locale}`,
    {
      cache: "no-store",
      headers: cookie ? { cookie } : undefined
    }
  );

  if (response.status === 401) return null;
  if (!response.ok) {
    throw new Error(`Unable to verify onboarding status (HTTP ${response.status})`);
  }
  return response.json() as Promise<OnboardingStatus>;
}
