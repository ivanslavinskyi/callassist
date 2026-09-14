// Contact matches the published Support page (reviewed 2026-09-14).
export const emailIdentity = {
  supportAddress: "support@shprohli.ch"
} as const;

export type EmailBranding = { siteUrl: string };

export function emailBrandingFromEnv(environment: NodeJS.ProcessEnv = process.env): EmailBranding {
  const raw = environment.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw && environment.NODE_ENV === "production") throw new Error("NEXT_PUBLIC_SITE_URL is required for email footer links");
  const url = new URL(raw || "http://localhost:3000");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && local && environment.NODE_ENV !== "production")) ||
    (environment.NODE_ENV === "production" && local)) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be a public HTTPS origin (local HTTP is allowed in development)");
  }
  return { siteUrl: url.origin };
}
