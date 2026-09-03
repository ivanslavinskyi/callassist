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
    title: "SHPROHLI — AI-assisted phone calls",
    description: "SHPROHLI helps people make everyday phone calls when speaking or the local language is a barrier."
  },
  de: {
    title: "SHPROHLI — KI-unterstützte Telefonanrufe",
    description: "SHPROHLI hilft bei alltäglichen Telefonanrufen, wenn das Sprechen oder die lokale Sprache eine Hürde ist."
  }
};

export function absoluteSiteUrl(pathname: string) {
  return new URL(pathname, `${siteOrigin}/`).toString();
}
