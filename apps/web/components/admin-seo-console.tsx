"use client";

import type { ContentLocale } from "@callassist/contracts";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getPublishedContentIndex } from "@/lib/api";
import { seoAdminMessages } from "@/lib/i18n/seo-admin-messages";
import { buildSeoAudit, type SeoAuditRoute } from "@/lib/seo-audit";
import { absoluteSiteUrl } from "@/lib/site-config";

type StatusFilter = "all" | "warnings" | "stale";

export function AdminSeoConsole() {
  const locale = "en" as const;
  const copy = seoAdminMessages[locale];
  const [routes, setRoutes] = useState<SeoAuditRoute[]>([]);
  const [localeFilter, setLocaleFilter] = useState<"all" | ContentLocale>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getPublishedContentIndex()
      .then((index) => { if (active) setRoutes(buildSeoAudit(index)); })
      .catch(() => { if (active) setError(copy.loadError); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [copy.loadError]);

  const visibleRoutes = useMemo(() => routes.filter((route) => {
    if (localeFilter !== "all" && route.locale !== localeFilter) return false;
    if (statusFilter === "warnings" && route.issues.length === 0) return false;
    if (statusFilter === "stale" && !route.translationStale) return false;
    return true;
  }), [localeFilter, routes, statusFilter]);
  const warningCount = routes.filter(({ issues }) => issues.length > 0).length;
  const staleCount = routes.filter(({ translationStale }) => translationStale).length;

  return (
    <main className="admin-seo-page" id="main-content">
        <header className="admin-seo-heading">
          <div>
            <span className="eyebrow">{copy.eyebrow}</span>
            <h1>{copy.title}</h1>
            <p>{copy.intro}</p>
          </div>
          <div className="admin-seo-heading-actions">
            <a className="secondary-button" href={absoluteSiteUrl("/sitemap.xml")} target="_blank">{copy.sitemap}</a>
            <a className="secondary-button" href={absoluteSiteUrl("/robots.txt")} target="_blank">{copy.robots}</a>
          </div>
        </header>

        <dl className="admin-seo-summary">
          <Summary label={copy.routes} value={routes.length} />
          <Summary label={copy.warnings} value={warningCount} warning={warningCount > 0} />
          <Summary label={copy.staleTranslations} value={staleCount} warning={staleCount > 0} />
        </dl>

        <section className="admin-seo-filters">
          <label className="field">
            <span>{copy.locale}</span>
            <select onChange={(event) => setLocaleFilter(event.target.value as "all" | ContentLocale)} value={localeFilter}>
              <option value="all">{copy.allLocales}</option>
              <option value="en">EN</option>
              <option value="de">DE</option>
            </select>
          </label>
          <label className="field">
            <span>{copy.status}</span>
            <select onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} value={statusFilter}>
              <option value="all">{copy.all}</option>
              <option value="warnings">{copy.onlyWarnings}</option>
              <option value="stale">{copy.onlyStale}</option>
            </select>
          </label>
        </section>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {loading ? <p className="admin-content-loading" role="status">{copy.loading}</p> : null}
        {!loading && visibleRoutes.length === 0 ? <p className="admin-content-loading">{copy.noMatches}</p> : null}
        <div className="admin-seo-routes">
          {visibleRoutes.map((route) => (
            <article className="admin-seo-route" data-warning={route.issues.length > 0} key={route.url}>
              <header>
                <div>
                  <span className="eyebrow">{copy.pageName[route.key]} · {route.locale.toUpperCase()}</span>
                  <h2>{new URL(route.url).pathname}</h2>
                  <small>{copy.published}{route.revisionNumber ? ` · ${copy.revision(route.revisionNumber)}` : ""}</small>
                </div>
                <span className="admin-seo-state" data-warning={route.issues.length > 0}>
                  {route.issues.length > 0 ? copy.needsReview : copy.healthy}
                </span>
              </header>
              <div className="admin-seo-copy">
                <strong>{route.title}</strong>
                <p>{route.description}</p>
                <small>{copy.titleLength(route.title.length)} · {copy.descriptionLength(route.description.length)}</small>
              </div>
              {route.issues.length > 0 ? (
                <ul className="admin-seo-issues">
                  {route.issues.map((issue) => <li key={issue}>{copy.issue[issue]}</li>)}
                </ul>
              ) : null}
              <dl className="admin-seo-details">
                <div><dt>{copy.canonical}</dt><dd>{route.canonical}</dd></div>
                <div><dt>{copy.hreflang}</dt><dd>{Object.entries(route.alternates).map(([language, url]) => `${language}: ${url}`).join(" · ")}</dd></div>
                <div><dt>{copy.openGraphImage}</dt><dd>{route.ogImage}</dd></div>
              </dl>
              <Link className="secondary-button" href={route.url} target="_blank">{copy.open}</Link>
            </article>
          ))}
        </div>
    </main>
  );
}

function Summary({ label, value, warning = false }: {
  label: string;
  value: number;
  warning?: boolean;
}) {
  return <div data-warning={warning}><dt>{label}</dt><dd>{value}</dd></div>;
}
