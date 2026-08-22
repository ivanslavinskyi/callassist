import type {
  AdminContentLocalizedRevision,
  ContentLocale,
  ContentPageKey
} from "@callassist/contracts";

export async function fetchServerContentPreview({
  apiUrl,
  cookie,
  key,
  locale,
  fetcher = fetch
}: {
  apiUrl: string;
  cookie: string;
  key: ContentPageKey;
  locale: ContentLocale;
  fetcher?: typeof fetch;
}): Promise<AdminContentLocalizedRevision | null> {
  const response = await fetcher(
    `${apiUrl.replace(/\/$/, "")}/api/admin/content/pages/${key}/preview?locale=${locale}`,
    {
      cache: "no-store",
      headers: cookie ? { cookie } : undefined
    }
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Unable to load content preview (HTTP ${response.status})`);
  }
  const payload = await response.json() as {
    page: AdminContentLocalizedRevision;
  };
  return payload.page;
}
