import { fallbackOgImagePath, ogImagePath, ogLocaleSchema } from "@callassist/contracts";
import { getPublishedOgImages } from "@/lib/server-og-images";

// Preserve previously shared URLs without Next's file-based metadata override.
export async function GET(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const locale = ogLocaleSchema.safeParse((await params).locale);
  if (!locale.success) return new Response(null, { status: 404 });
  const image = (await getPublishedOgImages()).find(image => image.locale === locale.data);
  return new Response(null, { status: 307, headers: {
    Location: new URL(image ? ogImagePath(image) : fallbackOgImagePath(locale.data), request.url).href,
    "Cache-Control": "no-store"
  } });
}
