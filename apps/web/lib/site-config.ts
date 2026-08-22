import type { UiLocale } from "./i18n/messages";

export function normalizeSiteOrigin(value: string | undefined) {
  const parsed = new URL(value?.trim() || "http://localhost:3000");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be a plain public origin");
  }
  if (parsed.pathname !== "/") {
    throw new Error("NEXT_PUBLIC_SITE_URL must not contain a path");
  }
  return parsed.origin;
}

export const siteOrigin = normalizeSiteOrigin(
  process.env.NEXT_PUBLIC_SITE_URL
);

export const homeSeo: Record<UiLocale, {
  title: string;
  description: string;
}> = {
  en: {
    title: "CallAssist — AI phone assistance under your control",
    description: "Supervised AI phone calls for people with speech impairments or local-language barriers."
  },
  de: {
    title: "CallAssist — KI-Telefonassistenz unter Ihrer Kontrolle",
    description: "Begleitete KI-Telefonanrufe für Menschen mit Sprachbeeinträchtigung oder lokaler Sprachbarriere."
  }
};

export function absoluteSiteUrl(pathname: string) {
  return new URL(pathname, `${siteOrigin}/`).toString();
}
