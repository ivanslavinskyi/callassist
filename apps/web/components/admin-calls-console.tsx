"use client";

import { FilterDisclosure } from "./filter-disclosure";

import {
  SUPPORTED_CALL_LOCALES,
  type AdminCallListFilters,
  type AdminCallSummary,
  type CallBriefStatus,
  type CallFailureStage,
  type SemanticCallOutcome
} from "@callassist/contracts";
import Link from "next/link";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { listAdminCalls } from "@/lib/api";
import { adminCallMessages } from "@/lib/i18n/admin-call-messages";

const statuses: CallBriefStatus[] = [
  "review_required",
  "needs_clarification",
  "blocked",
  "ready",
  "dialing",
  "in_progress",
  "awaiting_approval",
  "completed",
  "stopped",
  "failed"
];
const outcomes: SemanticCallOutcome[] = [
  "resolved",
  "partially_resolved",
  "unresolved",
  "wrong_recipient",
  "voicemail",
  "declined",
  "technical_failure"
];
const failureStages: CallFailureStage[] = [
  "policy",
  "provider",
  "consent",
  "recording",
  "realtime",
  "transcription",
  "recovery"
];

export function AdminCallsConsole() {
  const locale = "en" as const;
  const copy = adminCallMessages[locale];
  const [items, setItems] = useState<AdminCallSummary[]>([]);
  const [filters, setFilters] = useState<AdminCallListFilters>({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void listAdminCalls({ limit: 20 })
      .then((result) => {
        if (active) {
          setItems(result.items);
          setNextCursor(result.nextCursor);
        }
      })
      .catch(() => {
        if (active) setError(copy.listError);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [copy.listError]);

  async function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next: AdminCallListFilters = {
      ...(formValue(form, "status")
        ? { status: formValue(form, "status") as CallBriefStatus }
        : {}),
      ...(formValue(form, "outcome")
        ? { outcome: formValue(form, "outcome") as SemanticCallOutcome }
        : {}),
      ...(formValue(form, "consent")
        ? {
            consent: formValue(form, "consent") as
              "not_recorded" | "granted" | "failed"
          }
        : {}),
      ...(formValue(form, "failureStage")
        ? {
            failureStage: formValue(form, "failureStage") as CallFailureStage
          }
        : {}),
      ...(formValue(form, "locale")
        ? {
            locale: formValue(form, "locale") as
              AdminCallListFilters["locale"]
          }
        : {}),
      ...(toIso(formValue(form, "dateFrom"))
        ? { dateFrom: toIso(formValue(form, "dateFrom"))! }
        : {}),
      ...(toIso(formValue(form, "dateTo"))
        ? { dateTo: toIso(formValue(form, "dateTo"))! }
        : {})
    };
    setFilters(next);
    await load(next, null, false);
  }

  async function load(
    nextFilters: AdminCallListFilters,
    cursor: string | null,
    append: boolean
  ) {
    append ? setLoadingMore(true) : setLoading(true);
    setError(null);
    try {
      const result = await listAdminCalls({
        ...nextFilters,
        limit: 20,
        ...(cursor ? { cursor } : {})
      });
      setItems((current) => append
        ? [...current, ...result.items]
        : result.items
      );
      setNextCursor(result.nextCursor);
    } catch {
      setError(copy.listError);
    } finally {
      append ? setLoadingMore(false) : setLoading(false);
    }
  }

  function clearFilters() {
    setFilters({});
    void load({}, null, false);
  }

  return (
    <main className="admin-calls-page" id="main-content">
        <header className="admin-calls-heading">
          <span className="eyebrow">{copy.eyebrow}</span>
          <h1>{copy.title}</h1>
          <p>{copy.intro}</p>
        </header>

        {loading && items.length === 0 ? <p role="status">{copy.loading}</p> : null}
            <FilterDisclosure label={copy.filters}>
            <form className="admin-call-filters" onSubmit={applyFilters}>
              <FilterSelect label={copy.status} name="status">
                <option value="">{copy.all}</option>
                {statuses.map((value) =>
                  <option key={value} value={value}>{copy.statuses[value]}</option>
                )}
              </FilterSelect>
              <FilterSelect label={copy.outcome} name="outcome">
                <option value="">{copy.all}</option>
                {outcomes.map((value) =>
                  <option key={value} value={value}>{copy.outcomes[value]}</option>
                )}
              </FilterSelect>
              <FilterSelect label={copy.consent} name="consent">
                <option value="">{copy.all}</option>
                {(["not_recorded", "granted", "failed"] as const).map((value) =>
                  <option key={value} value={value}>{copy.consents[value]}</option>
                )}
              </FilterSelect>
              <FilterSelect label={copy.failureStage} name="failureStage">
                <option value="">{copy.all}</option>
                {failureStages.map((value) =>
                  <option key={value} value={value}>{copy.failures[value]}</option>
                )}
              </FilterSelect>
              <FilterSelect label={copy.language} name="locale">
                <option value="">{copy.all}</option>
                {SUPPORTED_CALL_LOCALES.map((value) =>
                  <option key={value} value={value}>{copy.languages[value]}</option>
                )}
              </FilterSelect>
              <label className="field">
                <span>{copy.dateFrom}</span>
                <input name="dateFrom" type="datetime-local" />
              </label>
              <label className="field">
                <span>{copy.dateTo}</span>
                <input name="dateTo" type="datetime-local" />
              </label>
              <div className="admin-call-filter-actions">
                <button className="primary-button" disabled={loading} type="submit">
                  {loading ? copy.applying : copy.apply}
                </button>
                <button
                  className="secondary-button"
                  disabled={loading}
                  onClick={clearFilters}
                  type="reset"
                >
                  {copy.clear}
                </button>
              </div>
            </form>
            </FilterDisclosure>

            <section className="admin-call-results" aria-busy={loading}>
              <header><strong>{copy.loaded(items.length)}</strong></header>
              {error ? <p className="form-error" role="alert">{error}</p> : null}
              {!loading && items.length === 0 ? (
                <p className="admin-call-empty">{copy.noCalls}</p>
              ) : null}
              <div className="admin-table-container"><table className="admin-calls-table responsive-table"><thead><tr>
                <th scope="col">Call</th><th scope="col">{copy.status}</th><th scope="col">{copy.language}</th><th scope="col">{copy.created}</th><th scope="col">{copy.duration}</th><th scope="col">{copy.consent}</th><th scope="col">{copy.outcome}</th><th scope="col"><span className="sr-only">{copy.inspect}</span></th>
              </tr></thead><tbody>{items.map(call => <tr key={call.id}>
                <td data-label="Call"><details className="call-row-details"><summary><code>{call.id.slice(0,8)}</code></summary><dl>
                  <Fact label="Call ID" value={call.id} /><Fact label={copy.owner} value={call.ownerUserId ?? copy.notAvailable} />
                  <Fact label={copy.consent} value={copy.consents[call.technical.consent]} />
                  <Fact label={copy.failureStage} value={call.technical.failureStage ? copy.failures[call.technical.failureStage] : copy.notAvailable} />
                  <Fact label={copy.eventCount} value={String(call.eventCount)} />
                </dl></details></td>
                <td data-label={copy.status}><span className="status-chip" data-status={call.status}>{copy.statuses[call.status]}</span></td>
                <td data-label={copy.language}>{copy.languages[call.locale]}</td>
                <td data-label={copy.created}><time dateTime={call.createdAt}>{formatDate(call.createdAt, locale)}</time></td>
                <td data-label={copy.duration}>{formatDuration(call.durationSeconds)}</td>
                <td data-label={copy.consent}>{copy.consents[call.technical.consent]}</td>
                <td data-label={copy.outcome}>{call.semanticOutcome ? copy.outcomes[call.semanticOutcome] : copy.notAvailable}</td>
                <td data-label="Action"><Link href={`/admin/calls/${call.id}`} aria-label={`${copy.inspect} ${call.id.slice(0,8)}`}>{copy.inspect}</Link></td>
              </tr>)}</tbody></table></div>
              {nextCursor ? (
                <button
                  className="secondary-button admin-call-load-more"
                  disabled={loadingMore}
                  onClick={() => void load(filters, nextCursor, true)}
                  type="button"
                >
                  {loadingMore ? copy.loadingMore : copy.loadMore}
                </button>
              ) : null}
            </section>
            <p className="admin-access-note">{copy.privacyNote}</p>
    </main>
  );
}

function FilterSelect({
  children,
  label,
  name
}: {
  children: ReactNode;
  label: string;
  name: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select name={name}>{children}</select>
    </label>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function formValue(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function toIso(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function formatDate(value: string, locale: "en" | "de") {
  return new Intl.DateTimeFormat(locale === "de" ? "de-CH" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
