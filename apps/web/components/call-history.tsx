"use client";

import { emptyCallStageCounts, type CallHistoryItem } from "@callassist/contracts";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { listCallBriefs } from "@/lib/api";
import { formatCallDuration, formatCallTime } from "@/lib/call-time";
import { callStatusClass, callStatusLabel, callResultLabel, isTerminalCallStatus } from "@/lib/call-status";
import { historyFilterOptions, readCallHistoryFilter, showHistoryFilter } from "@/lib/call-history-filter";
import { callPresentationCopy, legacyCallStatusLabel } from "@/lib/i18n/call-presentation";
import { registrationCallMessages } from "@/lib/i18n/registration-call-messages";
import { CallAssessments } from "./call-assessments";
import { getCallLanguageLabel } from "@/lib/i18n/call-language-labels";
import { useUiLocale } from "./ui-locale-provider";
import { AppShell } from "./app-shell";

export function CallHistoryPage() {
  return <AppShell><main className="call-history-page" id="main-content" tabIndex={-1}><CallHistory /></main></AppShell>;
}

export function CallHistory({ recent = false }: { recent?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { locale, localizeHref, messages } = useUiLocale();
  const copy = messages.dashboard;
  const presentationCopy = callPresentationCopy[locale];
  const search = recent ? "" : searchParams.get("search")?.trim() ?? "";
  const { stage, status } = recent ? { stage: undefined, status: undefined } : readCallHistoryFilter(searchParams);
  const [input, setInput] = useState(search);
  const [items, setItems] = useState<CallHistoryItem[]>([]);
  const [stageCounts, setStageCounts] = useState(emptyCallStageCounts);
  const [legacyStatusCount, setLegacyStatusCount] = useState<number | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const loadedCount = useRef(0);
  const Heading = recent ? "h2" : "h1";
  const load = useCallback(async (next?: string, quiet = false) => {
    if (quiet && inFlight.current) return;
    const id = ++request.current;
    inFlight.current = true;
    if (!quiet) {
      if (next) setLoadingMore(true); else { setLoading(true); setLoadingMore(false); }
      setError(false);
    }
    try {
      const targetCount = quiet ? Math.max(recent ? 5 : 20, loadedCount.current) : recent ? 5 : 20;
      const collected: CallHistoryItem[] = [];
      let pageCursor = next;
      let result;
      do {
        result = await listCallBriefs({ limit: Math.min(50, targetCount - collected.length), search: search || undefined, stage, status, cursor: pageCursor });
        if (id !== request.current) return;
        collected.push(...result.items);
        pageCursor = result.nextCursor ?? undefined;
      } while (quiet && pageCursor && collected.length < targetCount);
      setItems(previous => {
        const updated = next ? [...previous, ...collected.filter(item => !previous.some(old => old.id === item.id))] : collected;
        loadedCount.current = updated.length;
        return updated;
      });
      setStageCounts(result.stageCounts);
      setLegacyStatusCount(result.legacyStatusCount);
      setCursor(result.nextCursor);
      setError(false);
    } catch {
      if (id === request.current) setError(true);
    } finally {
      if (id === request.current) { setLoading(false); setLoadingMore(false); inFlight.current = false; }
    }
  }, [recent, search, stage, status]);
  useEffect(() => { void load(); return () => { request.current += 1; }; }, [load]);
  useEffect(() => { setInput(search); }, [search]);
  const hasPending = stageCounts.dialing + stageCounts.in_progress + stageCounts.awaiting_approval > 0 || items.some(brief => ["dialing", "in_progress", "awaiting_approval"].includes(brief.status) ||
    brief.lifecycle?.assessment?.status === "pending" || (isTerminalCallStatus(brief.status) && brief.lifecycle?.credit === "reserved"));
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void load(undefined, true); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("call-feedback-updated", refresh);
    const timer = hasPending ? window.setInterval(refresh, 5000) : undefined;
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("call-feedback-updated", refresh);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [load, hasPending]);
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

  const filterVisible = showHistoryFilter(stageCounts, Boolean(stage || status));
  const options = historyFilterOptions(stageCounts, stage);
  const total = Object.values(stageCounts).reduce((sum, count) => sum + count, 0);

  return <section className={`activity-panel ${recent ? "recent-call-history" : "full-call-history"}`} aria-label={messages.app.history}>
    <div className="panel-heading">
      <div><span className="eyebrow">{copy.historyEyebrow}</span><Heading>{recent ? copy.historyTitle : messages.app.history}</Heading></div>
      <Link className={recent ? "text-link" : "secondary-button"} href={localizeHref(recent ? "/app/history" : "/app")}>
        {recent ? messages.live.allCallBriefs : messages.app.newCall} <span aria-hidden="true">↗</span>
      </Link>
    </div>
    {!recent ? <div className={`history-filters${filterVisible ? "" : " history-search-only"}`}><label><span className="history-filter-label">{copy.searchLabel}</span><input ref={searchInput} type="search" maxLength={100} value={input} onChange={(event) => setInput(event.target.value)} placeholder={copy.searchPlaceholder} /></label>
      {filterVisible ? <label><span className="history-filter-label">{presentationCopy.state}</span><select value={stage ?? (status ? `legacy:${status}` : "")} onChange={(event) => {
        const query = new URLSearchParams(searchParams.toString());
        query.delete("status"); query.delete("cursor");
        if (event.target.value) query.set("stage", event.target.value); else query.delete("stage");
        if (!event.target.value && !showHistoryFilter(stageCounts, false)) searchInput.current?.focus();
        router.replace(`${pathname}${query.size ? `?${query}` : ""}`, { scroll: false });
      }}><option value="">{presentationCopy.all} · {total}</option>{status ? <option value={`legacy:${status}`} hidden>{presentationCopy.legacy}: {legacyCallStatusLabel(status, locale)} · {legacyStatusCount ?? 0}</option> : null}{options.map(value => <option key={value} value={value}>{presentationCopy.stages[value]} · {stageCounts[value]}</option>)}</select></label> : null}</div> : null}
    {loading ? <div className="history-skeleton" role="status"><span className="sr-only">{copy.loading}</span>{[0, 1, 2].map((key) => <span className="history-skeleton-row" key={key} aria-hidden="true" />)}</div> : <>
      {error ? <div className="history-error" role="alert"><strong>{copy.loadErrorTitle}</strong><p>{copy.loadErrorText}</p><button type="button" className="secondary-button" onClick={() => void load(items.length && cursor ? cursor : undefined)}>{copy.retry}</button></div> : null}
      {!error && items.length === 0 ? <div className="empty-state"><strong>{search || stage || status ? copy.noMatchesTitle : copy.emptyTitle}</strong><p>{search || stage || status ? copy.noMatchesText : copy.emptyText}</p></div> : null}
      <ul className="brief-list">{items.map((brief) => {
        const time = formatCallTime(brief.createdAt, locale);
        const duration = formatCallDuration(brief);
        const initials = brief.recipientName.trim().split(/\s+/).slice(0, 2).map((word) => [...word][0]).join("").toLocaleUpperCase(locale);
        return <li key={brief.id}><Link className="brief-row" href={localizeHref(`/app/calls/${brief.id}`)}>
          <span className="brief-avatar" aria-hidden="true">{initials}</span>
          <span className="brief-copy"><strong>{brief.recipientName}</strong>{brief.displayObjective ? <span className="brief-objective" lang={brief.objectiveLanguage && brief.objectiveLanguage !== "und" ? brief.objectiveLanguage : undefined} title={brief.displayObjective}><span className="sr-only">{registrationCallMessages[locale].objective}: </span>{brief.displayObjective}</span> : null}<small>{getCallLanguageLabel(brief.locale, locale)}</small></span>
          <span className="brief-arrow" aria-hidden="true">↗</span>
          <span className={`history-status ${callStatusClass(brief)}`}>{callStatusLabel(brief, locale)}</span>
          {isTerminalCallStatus(brief.status) ? <span className="history-outcome"><span className="sr-only">{presentationCopy.result}: </span>{callResultLabel(brief, locale)}</span> : null}
          <CallAssessments brief={brief} feedback={brief.feedback} locale={locale} />
          <span className="brief-meta">
            <time dateTime={brief.createdAt} title={time.exact}>{time.relative}</time>
            <span className="brief-duration" title={duration ? copy.duration : copy.durationUnavailable}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" /></svg>
              <span className="sr-only">{duration ? `${copy.duration}: ` : copy.durationUnavailable}</span>
              <span aria-hidden={!duration || undefined}>{duration ?? "—"}</span>
            </span>
          </span>
        </Link></li>;
      })}</ul>
      {!recent && cursor && !error ? <button className="load-more-button" type="button" disabled={loadingMore} onClick={() => void load(cursor)}>{loadingMore ? copy.loadingMore : copy.loadMore}</button> : null}
    </>}
    <div className="privacy-note"><p><strong>{copy.privacyTitle}</strong> {copy.privacyText}</p></div>
  </section>;
}
