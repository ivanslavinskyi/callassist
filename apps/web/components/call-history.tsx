"use client";

import type { CallBrief } from "@callassist/contracts";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { listCallBriefs } from "@/lib/api";
import { formatCallTime } from "@/lib/call-time";
import { callStatusClass, callStatusLabel } from "@/lib/call-status";
import { getCallLanguageLabel } from "@/lib/i18n/call-language-labels";
import { useUiLocale } from "./ui-locale-provider";
import { AppShell } from "./app-shell";
const statuses: CallBrief["status"][] = ["review_required", "needs_clarification", "blocked", "ready", "dialing", "in_progress", "awaiting_approval", "completed", "stopped", "failed"];

export function CallHistoryPage() {
  return <AppShell><main className="call-history-page" id="main-content" tabIndex={-1}><CallHistory /></main></AppShell>;
}

export function CallHistory({ recent = false }: { recent?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { locale, localizeHref, messages } = useUiLocale();
  const copy = messages.dashboard;
  const search = recent ? "" : searchParams.get("search")?.trim() ?? "";
  const status = recent ? undefined : statuses.find((value) => value === searchParams.get("status"));
  const [input, setInput] = useState(search);
  const [items, setItems] = useState<CallBrief[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const Heading = recent ? "h2" : "h1";
  const load = useCallback(async (next?: string) => {
    const id = ++request.current;
    if (next) setLoadingMore(true); else setLoading(true);
    setError(false);
    try {
      const result = await listCallBriefs({ limit: recent ? 5 : 20, search: search || undefined, status, cursor: next });
      if (id !== request.current) return;
      setItems((previous) => next ? [...previous, ...result.items.filter((item) => !previous.some((old) => old.id === item.id))] : result.items);
      setCursor(result.nextCursor);
    } catch {
      if (id === request.current) setError(true);
    } finally {
      if (id === request.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [recent, search, status]);
  useEffect(() => { void load(); return () => { request.current += 1; }; }, [load]);
  useEffect(() => { setInput(search); }, [search]);
  useEffect(() => {
    if (recent) return;
    const timer = window.setTimeout(() => {
      if (input.trim() === search) return;
      const query = new URLSearchParams(searchParams.toString());
      if (input.trim()) query.set("search", input.trim()); else query.delete("search");
      router.replace(`${pathname}${query.size ? `?${query}` : ""}`, { scroll: false });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [recent, input, search, searchParams, pathname, router]);

  return <section className={`activity-panel ${recent ? "recent-call-history" : "full-call-history"}`} aria-label={messages.app.history}>
    <div className="panel-heading">
      <div><span className="eyebrow">{copy.historyEyebrow}</span><Heading>{recent ? copy.historyTitle : messages.app.history}</Heading></div>
      <Link className={recent ? "text-link" : "secondary-button"} href={localizeHref(recent ? "/app/history" : "/app")}>
        {recent ? messages.live.allCallBriefs : messages.app.newCall} <span aria-hidden="true">↗</span>
      </Link>
    </div>
    {!recent ? <div className="history-filters"><label><span className="sr-only">{copy.searchLabel}</span><input type="search" maxLength={100} value={input} onChange={(event) => setInput(event.target.value)} placeholder={copy.searchPlaceholder} /></label>
      <label><span className="sr-only">{locale === "de" ? "Technischer Zustand" : "Call state"}</span><select value={status ?? ""} onChange={(event) => {
        const query = new URLSearchParams(searchParams.toString());
        if (event.target.value) query.set("status", event.target.value); else query.delete("status");
        router.replace(`${pathname}${query.size ? `?${query}` : ""}`, { scroll: false });
      }}><option value="">{copy.allStatuses}</option>{statuses.map((value) => <option key={value} value={value}>{value === "failed" ? (locale === "de" ? "Nicht verbunden / fehlgeschlagen" : "Not connected / failed") : callStatusLabel({ status: value }, locale, copy.status)}</option>)}</select></label></div> : null}
    {loading ? <div className="history-skeleton" role="status"><span className="sr-only">{copy.loading}</span>{[0, 1, 2].map((key) => <span className="history-skeleton-row" key={key} aria-hidden="true" />)}</div> : <>
      {error ? <div className="history-error" role="alert"><strong>{copy.loadErrorTitle}</strong><p>{copy.loadErrorText}</p><button type="button" className="secondary-button" onClick={() => void load(items.length && cursor ? cursor : undefined)}>{copy.retry}</button></div> : null}
      {!error && items.length === 0 ? <div className="empty-state"><strong>{search || status ? copy.noMatchesTitle : copy.emptyTitle}</strong><p>{search || status ? copy.noMatchesText : copy.emptyText}</p></div> : null}
      <div className="brief-list">{items.map((brief) => {
        const time = formatCallTime(brief.createdAt, locale);
        return <Link className="brief-row" key={brief.id} href={localizeHref(`/app/calls/${brief.id}`)}>
          <span className="brief-avatar" aria-hidden="true">{brief.recipientName.slice(0, 1)}</span>
          <span className="brief-copy"><strong>{brief.recipientName}</strong><small>{getCallLanguageLabel(brief.locale, locale)}</small><small className={`history-status ${callStatusClass(brief)}`}>{callStatusLabel(brief, locale, copy.status)}</small><time dateTime={brief.createdAt} title={time.exact}>{time.relative}</time></span>
          <span aria-hidden="true">→</span>
        </Link>;
      })}</div>
      {!recent && cursor && !error ? <button className="load-more-button" type="button" disabled={loadingMore} onClick={() => void load(cursor)}>{loadingMore ? copy.loadingMore : copy.loadMore}</button> : null}
    </>}
    <div className="privacy-note"><p><strong>{copy.privacyTitle}</strong> {copy.privacyText}</p></div>
  </section>;
}
