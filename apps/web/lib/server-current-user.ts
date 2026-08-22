import type { User } from "@callassist/contracts";

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
