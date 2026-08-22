import type {
  AdminEditorialRevision,
  AdminContentLocalizedRevision,
  ContentLocale,
  ContentPageKey,
  EditorialCollectionKey
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
  if ([401, 403, 404].includes(response.status)) return null;
  if (!response.ok) {
    throw new Error(`Unable to load content preview (HTTP ${response.status})`);
  }
  const payload = await response.json() as {
    page: AdminContentLocalizedRevision;
  };
  return payload.page;
}

export async function fetchServerEditorialPreview({
  apiUrl,
  cookie,
  key,
  fetcher = fetch
}: {
  apiUrl: string;
  cookie: string;
  key: EditorialCollectionKey;
  fetcher?: typeof fetch;
}): Promise<AdminEditorialRevision | null> {
  const response = await fetcher(
    `${apiUrl.replace(/\/$/, "")}/api/admin/content/editorial/${key}/preview`,
    {
      cache: "no-store",
      headers: cookie ? { cookie } : undefined
    }
  );
  if ([401, 403, 404].includes(response.status)) return null;
  if (!response.ok) {
    throw new Error(`Unable to load editorial preview (HTTP ${response.status})`);
  }
  const payload = await response.json() as {
    draft: AdminEditorialRevision;
  };
  return payload.draft;
}
