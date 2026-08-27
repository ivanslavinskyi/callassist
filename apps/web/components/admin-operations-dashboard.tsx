"use client";

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

const windows: AdminOperationsWindow[] = ["24h", "7d", "30d"];

export function AdminOperationsDashboard() {
  const locale = "en" as const;
  const copy = adminOperationsMessages[locale];
  const [selectedWindow, setSelectedWindow] = useState<AdminOperationsWindow>(
    "24h"
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
            <p>{copy.overviewIntro}</p>
            <small>{copy.privacyNote}</small>
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

            <OperationsSection title={copy.volumeTitle}>
              <div className="admin-metric-grid">
                {([
                  [copy.createdCalls, overview.volume.createdCalls],
                  [copy.attemptedCalls, overview.volume.attemptedCalls],
                  [copy.activeCalls, overview.volume.activeCalls],
                  [copy.terminalCalls, overview.volume.terminalCalls],
                  [copy.connectedCalls, overview.volume.connectedCalls],
                  [copy.consentGrantedCalls, overview.volume.consentGrantedCalls],
                  [copy.consentFailedCalls, overview.volume.consentFailedCalls],
                  [copy.technicalFailureCalls, overview.volume.technicalFailureCalls],
                  [copy.feedbackResponses, overview.volume.feedbackResponses]
                ] as const).map(([label, value]) => (
                  <MetricCard key={label} label={label} value={String(value)} />
                ))}
              </div>
            </OperationsSection>

            <OperationsSection title={copy.ratesTitle}>
              <div className="admin-metric-grid admin-rate-grid">
                <RatioCard copy={copy} label={copy.connectionRate} locale={locale} ratio={overview.rates.connection} />
                <RatioCard copy={copy} label={copy.consentRate} locale={locale} ratio={overview.rates.consent} />
                <RatioCard copy={copy} label={copy.technicalFailureRate} locale={locale} ratio={overview.rates.technicalFailure} />
                <RatioCard copy={copy} label={copy.feedbackRate} locale={locale} ratio={overview.rates.feedback} />
                <RatioCard copy={copy} label={copy.resolvedRate} locale={locale} ratio={overview.rates.resolved} />
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

            <OperationsSection title={copy.outcomesTitle}>
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

            <OperationsSection title={copy.costTitle}>
              <div className="admin-cost-heading">
                <div>
                  <span className="admin-cost-state" data-state={overview.cost.status}>
                    {copy.costStatuses[overview.cost.status]}
                  </span>
                  <strong>{copy.totalEstimate}: {formatUsd(overview.cost.estimatedUsdMicros, copy.notAvailable)}</strong>
                </div>
                <small>{copy.pricingVersion}: {overview.cost.pricingVersion ?? copy.notAvailable}</small>
              </div>
              <div className="admin-cost-grid">
                {Object.entries(overview.cost.components).map(([key, component]) => (
                  <article key={key}>
                    <h3>{copy.costComponents[key as keyof typeof copy.costComponents]}</h3>
                    <dl>
                      <Fact label={copy.usage} value={formatSeconds(component.usageSeconds)} />
                      <Fact label={copy.rate} value={formatUsd(component.rateUsdMicrosPerMinute, copy.notAvailable)} />
                      <Fact label={copy.totalEstimate} value={formatUsd(component.estimatedUsdMicros, copy.notAvailable)} />
                    </dl>
                  </article>
                ))}
              </div>
              <p className="admin-cost-caveat">{copy.costCaveat}</p>
            </OperationsSection>
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
  return new Intl.NumberFormat(locale === "de" ? "de-CH" : "en-GB", {
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

function formatUsd(value: number | null, fallback: string) {
  if (value === null) return fallback;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 6
  }).format(value / 1_000_000);
}

function formatDate(value: string, locale: "en" | "de") {
  return new Intl.DateTimeFormat(locale === "de" ? "de-CH" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}
