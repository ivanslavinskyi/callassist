import type { ContentPageKey } from "@callassist/contracts";
import type { SeoAuditIssue } from "../seo-audit";
import type { UiLocale } from "./messages";

type SeoMessages = {
  eyebrow: string;
  title: string;
  intro: string;
  loading: string;
  loadError: string;
  routes: string;
  warnings: string;
  staleTranslations: string;
  sitemap: string;
  robots: string;
  locale: string;
  status: string;
  all: string;
  onlyWarnings: string;
  onlyStale: string;
  allLocales: string;
  published: string;
  healthy: string;
  needsReview: string;
  canonical: string;
  hreflang: string;
  openGraphImage: string;
  revision: (number: number) => string;
  titleLength: (length: number) => string;
  descriptionLength: (length: number) => string;
  open: string;
  logout: string;
  noMatches: string;
  pageName: Record<"home" | ContentPageKey, string>;
  issue: Record<SeoAuditIssue, string>;
};

const en: SeoMessages = {
  eyebrow: "Search visibility",
  title: "SEO audit",
  intro: "Canonical URLs, language alternates, social metadata, and translation freshness for every published public route.",
  loading: "Building the published SEO report…",
  loadError: "The published SEO index could not be loaded.",
  routes: "Published routes",
  warnings: "Warnings",
  staleTranslations: "Stale translations",
  sitemap: "Open sitemap",
  robots: "Open robots.txt",
  locale: "Locale",
  status: "Status",
  all: "All",
  onlyWarnings: "Warnings only",
  onlyStale: "Stale only",
  allLocales: "All locales",
  published: "Published · index/follow",
  healthy: "Ready",
  needsReview: "Review",
  canonical: "Canonical",
  hreflang: "Language alternates",
  openGraphImage: "Open Graph image",
  revision: (number) => `Revision ${number}`,
  titleLength: (length) => `Title ${length} characters`,
  descriptionLength: (length) => `Description ${length} characters`,
  open: "Open public page",
  logout: "Sign out",
  noMatches: "No published routes match these filters.",
  pageName: { home: "Landing", privacy: "Privacy", terms: "Terms", acceptable_use: "Acceptable Use", support: "Support", faq: "FAQ" },
  issue: {
    translation_stale: "Translation trails the source revision",
    title_short: "Title is shorter than 20 characters",
    title_long: "Title exceeds 60 characters",
    description_short: "Description is shorter than 50 characters",
    description_long: "Description exceeds 160 characters"
  }
};

const de: SeoMessages = {
  eyebrow: "Sichtbarkeit in Suchmaschinen",
  title: "SEO-Audit",
  intro: "Kanonische URLs, Sprachalternativen, Social-Metadaten und Übersetzungsstand für jede veröffentlichte Route.",
  loading: "Veröffentlichter SEO-Bericht wird erstellt…",
  loadError: "Der veröffentlichte SEO-Index konnte nicht geladen werden.",
  routes: "Veröffentlichte Routen",
  warnings: "Warnungen",
  staleTranslations: "Veraltete Übersetzungen",
  sitemap: "Sitemap öffnen",
  robots: "robots.txt öffnen",
  locale: "Sprache",
  status: "Status",
  all: "Alle",
  onlyWarnings: "Nur Warnungen",
  onlyStale: "Nur veraltete",
  allLocales: "Alle Sprachen",
  published: "Veröffentlicht · index/follow",
  healthy: "Bereit",
  needsReview: "Prüfen",
  canonical: "Kanonisch",
  hreflang: "Sprachalternativen",
  openGraphImage: "Open-Graph-Bild",
  revision: (number) => `Revision ${number}`,
  titleLength: (length) => `Titel: ${length} Zeichen`,
  descriptionLength: (length) => `Beschreibung: ${length} Zeichen`,
  open: "Öffentliche Seite öffnen",
  logout: "Abmelden",
  noMatches: "Keine veröffentlichte Route entspricht diesen Filtern.",
  pageName: { home: "Landingpage", privacy: "Datenschutz", terms: "Bedingungen", acceptable_use: "Nutzungsregeln", support: "Support", faq: "FAQ" },
  issue: {
    translation_stale: "Übersetzung liegt hinter der Quellrevision",
    title_short: "Titel ist kürzer als 20 Zeichen",
    title_long: "Titel überschreitet 60 Zeichen",
    description_short: "Beschreibung ist kürzer als 50 Zeichen",
    description_long: "Beschreibung überschreitet 160 Zeichen"
  }
};

export const seoAdminMessages: Record<UiLocale, SeoMessages> = { en, de };
