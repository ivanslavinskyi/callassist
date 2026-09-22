import { ogLocaleSchema } from "@callassist/contracts";
import { ogInternalApiUrl } from "@/lib/server-og-images";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ locale: string; file: string }> }) {
  const { locale, file } = await params;
  if (!ogLocaleSchema.safeParse(locale).success || !/^[a-f0-9]{64}\.png$/.test(file)) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const response = await fetch(`${ogInternalApiUrl}/api/content/og/${locale}/images/${file}`, {
      cache: "no-store", signal: AbortSignal.timeout(5000),
      headers: request.headers.has("if-none-match") ? { "If-None-Match": request.headers.get("if-none-match")! } : undefined
    });
    if (response.status !== 200 && response.status !== 304) return new Response(null, {
      status: response.status === 404 ? 404 : 503, headers: { "Cache-Control": "no-store" }
    });
    return new Response(response.status === 304 ? null : response.body, {
      status: response.status,
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable",
        "ETag": `"${file.slice(0, -4)}"`, "X-Content-Type-Options": "nosniff" }
    });
  } catch { return new Response(null, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } }); }
}
