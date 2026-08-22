"use client";

import type { CallBrief } from "@callassist/contracts";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "./app-shell";
import { CreateCallForm } from "./create-call-form";
import { listCallBriefs } from "@/lib/api";
import { useUiLocale } from "./ui-locale-provider";
import { formatCallTime } from "@/lib/call-time";

const callStatuses = [
  "review_required", "needs_clarification", "blocked", "ready", "dialing",
  "in_progress", "awaiting_approval", "completed", "stopped", "failed"
] as const satisfies readonly CallBrief["status"][];

export function Dashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { locale, localizeHref, messages } = useUiLocale();
  const copy = messages.dashboard;
  const searchQuery = searchParams.get("search")?.trim() ?? "";
  const rawStatus = searchParams.get("status");
  const statusQuery = callStatuses.find((status) => status === rawStatus);
  const [briefs, setBriefs] = useState<CallBrief[]>([]);
  const [searchInput, setSearchInput] = useState(searchQuery);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const requestId = useRef(0);

  const loadHistory = useCallback(async (cursor?: string) => {
    const currentRequest = ++requestId.current;
    if (cursor) setLoadingMore(true);
    else setHistoryLoading(true);
    setHistoryError(false);
    try {
      const result = await listCallBriefs({
        cursor, limit: 10, search: searchQuery || undefined, status: statusQuery
      });
      if (currentRequest !== requestId.current) return;
      setBriefs((current) => cursor ? [...current, ...result.items] : result.items);
      setNextCursor(result.nextCursor);
    } catch {
      if (currentRequest === requestId.current) setHistoryError(true);
    } finally {
      if (currentRequest === requestId.current) {
        setHistoryLoading(false);
        setLoadingMore(false);
      }
    }
  }, [searchQuery, statusQuery]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => setSearchInput(searchQuery), [searchQuery]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextSearch = searchInput.trim();
      if (nextSearch === searchQuery) return;
      const query = new URLSearchParams(searchParams.toString());
      if (nextSearch) query.set("search", nextSearch);
      else query.delete("search");
      const suffix = query.size ? `?${query}` : "";
      router.replace(`${pathname}${suffix}`, { scroll: false });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [pathname, router, searchInput, searchParams, searchQuery]);

  function setStatusFilter(status: string) {
    const query = new URLSearchParams(searchParams.toString());
    if (status) query.set("status", status);
    else query.delete("status");
    const suffix = query.size ? `?${query}` : "";
    router.replace(`${pathname}${suffix}`, { scroll: false });
  }

  function openBrief(brief: CallBrief) {
    router.push(localizeHref(`/app/calls/${brief.id}`));
  }

  return (
    <AppShell>
      <main className="dashboard-page" id="main-content" tabIndex={-1}>
        <section className="hero-block">
          <div>
            <span className="eyebrow">{copy.eyebrow}</span>
            <h1>
              {copy.titleStart}
              <span>{copy.titleAccent}</span>
            </h1>
            <p>
              {copy.lead}
            </p>
          </div>
        </section>

        <div className="dashboard-grid">
          <div id="new-call">
            <CreateCallForm onCreated={openBrief} />
          </div>

          <aside className="activity-panel" id="history">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">{copy.historyEyebrow}</span>
                <h2>{copy.historyTitle}</h2>
              </div>
              <span className="counter">{briefs.length}</span>
            </div>

            <div className="history-filters">
              <label>
                <span className="sr-only">{copy.searchLabel}</span>
                <input
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder={copy.searchPlaceholder}
                  type="search"
                  value={searchInput}
                />
              </label>
              <label>
                <span className="sr-only">{copy.statusLabel}</span>
                <select
                  aria-label={copy.statusLabel}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  value={statusQuery ?? ""}
                >
                  <option value="">{copy.allStatuses}</option>
                  {callStatuses.map((status) => (
                    <option key={status} value={status}>{copy.status[status]}</option>
                  ))}
                </select>
              </label>
            </div>

            {historyLoading ? (
              <div className="history-skeleton" aria-label={copy.loading} role="status">
                <span className="sr-only">{copy.loading}</span>
                {[0, 1, 2].map((item) => (
                  <span className="history-skeleton-row" key={item} aria-hidden="true" />
                ))}
              </div>
            ) : historyError ? (
              <div className="history-error" role="alert">
                <strong>{copy.loadErrorTitle}</strong>
                <p>{copy.loadErrorText}</p>
                <button className="secondary-button" onClick={() => void loadHistory()} type="button">
                  {copy.retry}
                </button>
              </div>
            ) : briefs.length === 0 && (searchQuery || statusQuery) ? (
              <div className="empty-state">
                <span aria-hidden="true">⌕</span>
                <strong>{copy.noMatchesTitle}</strong>
                <p>{copy.noMatchesText}</p>
              </div>
            ) : briefs.length === 0 ? (
              <div className="empty-state">
                <span aria-hidden="true">↗</span>
                <strong>{copy.emptyTitle}</strong>
                <p>{copy.emptyText}</p>
              </div>
            ) : (
              <div className="brief-list">
                {briefs.map((brief) => (
                  <button
                    className="brief-row"
                    aria-label={copy.openBrief(brief.recipientName)}
                    key={brief.id}
                    onClick={() => openBrief(brief)}
                    type="button"
                  >
                    <span className="brief-avatar">{brief.recipientName.slice(0, 1)}</span>
                    <span className="brief-copy">
                      <strong>{brief.recipientName}</strong>
                      <small>{brief.locale} · {copy.status[brief.status]}</small>
                      {(() => {
                        const time = formatCallTime(brief.createdAt, locale);
                        return <time dateTime={brief.createdAt} title={time.exact}>{time.relative}</time>;
                      })()}
                    </span>
                    <span aria-hidden="true">→</span>
                  </button>
                ))}
                {nextCursor ? (
                  <button
                    className="load-more-button"
                    disabled={loadingMore}
                    onClick={() => void loadHistory(nextCursor)}
                    type="button"
                  >
                    {loadingMore ? copy.loadingMore : copy.loadMore}
                  </button>
                ) : null}
              </div>
            )}

            <div className="privacy-note">
              <span aria-hidden="true">⌁</span>
              <p>
                <strong>{copy.privacyTitle}</strong> {copy.privacyText}
              </p>
            </div>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
