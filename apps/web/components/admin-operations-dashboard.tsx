"use client";
import { formatLocale } from "@callassist/contracts";

import { AdminCostBreakdown } from "./admin-cost-breakdown";
import { AdminGoalAssessments } from "./admin-goal-assessments";
import { callResultCopy } from "@/lib/call-status";
import { answeringMessages } from "@/lib/i18n/answering-messages";
import type { AnsweringState } from "@callassist/contracts";
import type { CallResult } from "@callassist/contracts";

import type {
  AdminMetricRatio,
  AdminOperationsOverview,
  AdminOperationsWindow
} from "@callassist/contracts";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { getAdminOperationsOverview } from "@/lib/api";
import {
  adminOperationsMessages,
  type AdminOperationsCopy
} from "@/lib/i18n/admin-operations-messages";

const windows: AdminOperationsWindow[] = ["month", "previous_month", "24h", "7d", "30d"];

export function AdminOperationsDashboard() {
  const locale = "en" as const;
  const copy = adminOperationsMessages[locale];
  const [selectedWindow, setSelectedWindow] = useState<AdminOperationsWindow>(
    "month"
  );
  const [overview, setOverview] = useState<AdminOperationsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void getAdminOperationsOverview(selectedWindow)
      .then((result) => {
        if (active) setOverview(result);
      })
      .catch(() => {
        if (active) setError(copy.loadError);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [copy.loadError, reloadKey, selectedWindow]);

  return (
    <main className="admin-operations-page" id="main-content">
        <header className="admin-operations-heading">
          <div>
            <span className="eyebrow">{copy.overviewEyebrow}</span>
            <h1>{copy.overviewTitle}</h1>
            <p>Privacy-safe operational cohorts. Missing data remains explicit.</p>
            <details className="metrics-explanation"><summary>About these metrics</summary><p>{copy.overviewIntro}</p><p>{copy.privacyNote}</p></details>
          </div>
          <Link className="secondary-button" href="/admin/system">
            {copy.systemLink}
          </Link>
        </header>

        <nav className="admin-window-picker" aria-label={copy.overviewTitle}>
          {windows.map((value) => (
            <button
              aria-pressed={selectedWindow === value}
              className="secondary-button"
              key={value}
              onClick={() => setSelectedWindow(value)}
              type="button"
            >
              {copy.windows[value]}
            </button>
          ))}
        </nav>

        {loading && !overview ? <p role="status">{copy.loading}</p> : null}
        {error ? (
          <div className="admin-access-card" role="alert">
            <p>{error}</p>
            <button
              className="secondary-button"
              onClick={() => setReloadKey((current) => current + 1)}
              type="button"
            >
              {copy.retry}
            </button>
          </div>
        ) : null}

        {overview ? (
          <div aria-busy={loading} className="admin-operations-content">
            <p className="admin-generated-at">
              {copy.updated}: {formatDate(overview.generatedAt, locale)}
            </p>

            <div className="admin-summary-metrics" aria-label={copy.volumeTitle}>
              {([
                [copy.createdCalls, overview.volume.createdCalls],
                [copy.attemptedCalls, overview.volume.attemptedCalls],
                [copy.activeCalls, overview.volume.activeCalls],
                [copy.terminalCalls, overview.volume.terminalCalls]
              ] as const).map(([label, value]) => <MetricCard key={label} label={label} value={String(value)} />)}
            </div>
            <OperationsSection title={copy.volumeTitle}>
              <table className="admin-volume-table"><thead><tr><th scope="col">Stage</th><th scope="col">Count</th><th scope="col">Definition</th></tr></thead><tbody>
                {([
                  [copy.connectedCalls, overview.volume.connectedCalls, "Latest attempt connected; may include voicemail or an automated system"],
                  [copy.consentGrantedCalls, overview.volume.consentGrantedCalls, "Recipient agreed to continue"],
                  [copy.consentFailedCalls, overview.volume.consentFailedCalls, "Latest attempt: declined or consent not confirmed; distinct from no answer"],
                  [copy.technicalFailureCalls, overview.volume.technicalFailureCalls, "Terminal technical failure"],
                  [copy.feedbackResponses, overview.volume.feedbackResponses, "User-provided feedback"]
                ] as const).map(([label, value, definition]) => <tr key={label}><th scope="row">{label}</th><td>{value}</td><td>{definition}</td></tr>)}
              </tbody></table>
            </OperationsSection>

            {overview.lifecycle ? <OperationsSection title="Call results · latest attempt">
              <p>One result per ended call, using the same evidence as call history. A conversation requires consent and a substantive answer. Goal achievement is measured separately from user feedback.</p>
              <table className="admin-volume-table"><thead><tr><th scope="col">Result</th><th scope="col">Calls</th><th scope="col">Definition</th></tr></thead><tbody>
                {Object.entries(overview.lifecycle.results).map(([result, count]) => <tr key={result}><th scope="row">{callResultCopy[locale][result as CallResult][0]}</th><td>{count}</td><td>{callResultCopy[locale][result as CallResult][1]}</td></tr>)}
              </tbody></table>
            </OperationsSection> : null}
            <AdminGoalAssessments overview={overview} locale={locale} />
            {overview.lifecycle?.messages ? <OperationsSection title="Voicemail playback · latest attempt">
              <p>{answeringMessages[locale].uncertainty}</p>
              <table className="admin-volume-table"><thead><tr><th scope="col">Message state</th><th scope="col">Calls</th></tr></thead><tbody>
                {Object.entries(overview.lifecycle.messages).map(([state, count]) => <tr key={state}><th scope="row">{answeringMessages[locale].message[state as AnsweringState["message"]]}</th><td>{count}</td></tr>)}
              </tbody></table>
            </OperationsSection> : null}
            <OperationsSection title={copy.ratesTitle}>
              <div className="admin-metric-grid admin-rate-grid">
                <RatioCard copy={copy} label={copy.connectionRate} locale={locale} ratio={overview.rates.connection} />
                <RatioCard copy={copy} label={copy.consentRate} locale={locale} ratio={overview.rates.consent} />
                <RatioCard copy={copy} label={copy.technicalFailureRate} locale={locale} ratio={overview.rates.technicalFailure} />
                <RatioCard copy={copy} label={copy.feedbackRate} locale={locale} ratio={overview.rates.feedback} />
                <RatioCard copy={copy} label={"Resolved per user/staff review"} locale={locale} ratio={overview.rates.resolved} />
              </div>
            </OperationsSection>

            <div className="admin-operations-split">
              <OperationsSection title={copy.signalsTitle}>
                <div className="admin-signal-grid">
                  <SignalCard
                    average={overview.recordedDurationSeconds.average}
                    copy={copy}
                    formatter={formatSeconds}
                    label={copy.recordedDuration}
                    p95={overview.recordedDurationSeconds.p95}
                    samples={overview.recordedDurationSeconds.samples}
                  />
                  <SignalCard
                    average={overview.firstAudioLatencyMs.average}
                    copy={copy}
                    formatter={formatMilliseconds}
                    label={copy.firstAudioLatency}
                    p95={overview.firstAudioLatencyMs.p95}
                    samples={overview.firstAudioLatencyMs.samples}
                  />
                </div>
              </OperationsSection>

              <OperationsSection title={copy.reliabilityTitle}>
                <dl className="admin-operations-list">
                  <Fact label={copy.transcriptionRetries} value={String(overview.reliability.transcriptionRetries)} />
                  <Fact label={copy.realtimeDisconnects} value={String(overview.reliability.realtimeDisconnects)} />
                  <Fact label={copy.recoveries} value={String(overview.reliability.recoveries)} />
                  <Fact label={copy.realtimeReconnects} value={copy.notSupported} />
                </dl>
              </OperationsSection>
            </div>

            <OperationsSection title={"Manual classification · user/staff"}>
              <div className="admin-outcome-grid">
                {Object.entries(overview.semanticOutcomes).map(([key, value]) => (
                  <MetricCard
                    key={key}
                    label={copy.outcomes[key as keyof typeof copy.outcomes]}
                    value={String(value)}
                  />
                ))}
              </div>
            </OperationsSection>

            <AdminCostBreakdown cost={overview.cost} locale={locale} scope="period" />
          </div>
        ) : null}
    </main>
  );
}

function OperationsSection({ children, title }: {
  children: ReactNode;
  title: string;
}) {
  return <section className="admin-operations-panel"><h2>{title}</h2>{children}</section>;
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return <article className="admin-metric-card"><span>{label}</span><strong>{value}</strong></article>;
}

function RatioCard({ copy, label, locale, ratio }: {
  copy: AdminOperationsCopy;
  label: string;
  locale: "en" | "de";
  ratio: AdminMetricRatio;
}) {
  return (
    <article className="admin-metric-card admin-rate-card">
      <span>{label}</span>
      <strong>{ratio.value === null
        ? "—"
        : formatPercent(ratio.value, locale)}</strong>
      <small>{ratio.denominator === 0
        ? copy.noDenominator
        : `${ratio.numerator} / ${ratio.denominator}`}</small>
    </article>
  );
}

function SignalCard({ average, copy, formatter, label, p95, samples }: {
  average: number | null;
  copy: AdminOperationsCopy;
  formatter: (value: number) => string;
  label: string;
  p95: number | null;
  samples: number;
}) {
  return (
    <article className="admin-signal-card">
      <h3>{label}</h3>
      {samples === 0 ? <p>{copy.noSamples}</p> : (
        <dl>
          <Fact label={copy.average} value={formatter(average!)} />
          <Fact label={copy.p95} value={formatter(p95!)} />
          <Fact label={copy.samples} value={String(samples)} />
        </dl>
      )}
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function formatPercent(value: number, locale: "en" | "de") {
  return new Intl.NumberFormat(formatLocale(locale), {
    style: "percent",
    maximumFractionDigits: 1
  }).format(value);
}

function formatSeconds(value: number) {
  if (value < 60) return `${Math.round(value)}s`;
  return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
}

function formatMilliseconds(value: number) {
  return value >= 1_000 ? `${(value / 1_000).toFixed(2)}s` : `${Math.round(value)}ms`;
}

function formatDate(value: string, locale: "en" | "de") {
  return new Intl.DateTimeFormat(formatLocale(locale), {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC"
  }).format(new Date(value));
}
