"use client";

import type { AdminSystemStatus, UserRole } from "@callassist/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  getAdminSystemStatus,
  getCurrentUser,
  retryAdminDurableJob,
  setAdminOutboundCalls
} from "@/lib/api";
import {
  adminOperationsMessages,
  type AdminOperationsCopy
} from "@/lib/i18n/admin-operations-messages";
import { AppShell } from "./app-shell";
import { useUiLocale } from "./ui-locale-provider";

export function AdminSystemConsole() {
  const { locale, localizeHref } = useUiLocale();
  const copy = adminOperationsMessages[locale];
  const [role, setRole] = useState<UserRole | null>(null);
  const [status, setStatus] = useState<AdminSystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [controlLoading, setControlLoading] = useState(false);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ user }, system] = await Promise.all([
        getCurrentUser(),
        getAdminSystemStatus()
      ]);
      setRole(user.role);
      setStatus(system);
    } catch {
      setError(copy.systemError);
    } finally {
      setLoading(false);
    }
  }, [copy.systemError]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function changeControl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!status) return;
    const enabled = !status.outboundCalls.enabled;
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "")
      .trim();
    if (reason.length < 3) {
      setControlError(copy.controlError);
      return;
    }
    const confirmed = window.confirm(
      enabled ? copy.confirmEnable : copy.confirmDisable
    );
    if (!confirmed) return;
    setControlLoading(true);
    setControlError(null);
    try {
      setStatus(await setAdminOutboundCalls({ enabled, reason }));
      event.currentTarget.reset();
    } catch {
      setControlError(copy.controlError);
    } finally {
      setControlLoading(false);
    }
  }

  async function retryJob(
    event: FormEvent<HTMLFormElement>,
    jobId: string
  ) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "")
      .trim();
    if (reason.length < 3 || !window.confirm(copy.retryJobConfirm)) return;
    setRetryingJobId(jobId);
    setJobError(null);
    try {
      setStatus(await retryAdminDurableJob(jobId, { reason }));
      event.currentTarget.reset();
    } catch {
      setJobError(copy.retryJobError);
    } finally {
      setRetryingJobId(null);
    }
  }

  return (
    <AppShell>
      <main className="admin-system-page" id="main-content">
        <Link className="auth-inline-link" href={localizeHref("/admin")}>
          ← {copy.systemBack}
        </Link>
        <header className="admin-system-heading">
          <div>
            <span className="eyebrow">{copy.systemEyebrow}</span>
            <h1>{copy.systemTitle}</h1>
            <p>{copy.systemIntro}</p>
          </div>
          <button className="secondary-button" disabled={loading} onClick={() => void refresh()} type="button">
            {loading ? copy.refreshing : copy.refresh}
          </button>
        </header>
        {loading && !status ? <p role="status">{copy.loading}</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}

        {status ? (
          <div className="admin-system-content" aria-busy={loading}>
            <p className="admin-generated-at">{copy.generatedAt}: {formatDate(status.generatedAt, locale)}</p>

            <section className="admin-system-panel">
              <h2>{copy.componentsTitle}</h2>
              <div className="admin-component-grid">
                <ComponentCard label={copy.components.api} state={status.components.api.state} copy={copy} />
                <ComponentCard label={copy.components.database} state={status.components.database.state} copy={copy} />
                <ComponentCard label={`${copy.components.telephony} · ${status.components.telephony.mode}`} state={status.components.telephony.state} copy={copy} upstream />
                <ComponentCard label={copy.components.realtime} state={status.components.realtime.state} copy={copy} upstream />
                <ComponentCard label={copy.components.transcription} state={status.components.transcription.state} copy={copy} upstream />
              </div>
            </section>

            <div className="admin-system-grid">
              <section className="admin-system-panel">
                <h2>{copy.workloadTitle}</h2>
                <dl className="admin-operations-list">
                  {Object.entries(status.workload).map(([key, value]) => (
                    <Fact key={key} label={copy.workload[key as keyof typeof copy.workload]} value={String(value)} />
                  ))}
                  <Fact label={copy.workload.backgroundTasks} value={String(status.runtime.backgroundTasks)} />
                  <Fact label={copy.workload.processingRecordings} value={String(status.runtime.processingRecordings)} />
                </dl>
              </section>

              <section className="admin-system-panel">
                <h2>{copy.runtimeTitle}</h2>
                <dl className="admin-operations-list">
                  <Fact label={copy.uptime} value={formatSeconds(status.runtime.uptimeSeconds)} />
                  <Fact label={copy.durableWorker} value={status.runtime.durableWorkerEnabled ? copy.enabled : copy.disabled} />
                  <Fact label={copy.warnings} value={String(status.recentTelemetry.warnings)} />
                  <Fact label={copy.errors} value={String(status.recentTelemetry.errors)} />
                </dl>
                <small>{copy.recentTelemetryTitle} · {formatDate(status.recentTelemetry.since, locale)}</small>
              </section>
            </div>

            <section className="admin-system-panel admin-jobs-panel">
              <h2>{copy.jobsTitle}</h2>
              <p>{copy.jobsIntro}</p>
              <div className="admin-metric-grid">
                <Metric label={copy.jobsQueued} value={status.jobs.queued} />
                <Metric label={copy.jobsRunning} value={status.jobs.running} />
                <Metric label={copy.jobsRetryQueued} value={status.jobs.retryQueued} />
                <Metric label={copy.jobsDeadLetter} value={status.jobs.deadLetter} />
                <Metric label={copy.jobsSucceeded} value={status.jobs.succeeded} />
                <Metric label={copy.jobsTranscription} value={status.jobs.transcriptionQueued} />
                <Metric label={copy.jobsRetention} value={status.jobs.retentionQueued} />
                <Metric
                  label={copy.jobsOldestDue}
                  value={status.jobs.oldestDueAt
                    ? formatDate(status.jobs.oldestDueAt, locale)
                    : copy.notAvailable}
                />
              </div>
              <h3>{copy.jobsRecent}</h3>
              {status.jobs.recent.length === 0 ? <p>{copy.jobsEmpty}</p> : null}
              <div className="admin-job-list">
                {status.jobs.recent.map((job) => (
                  <article className="admin-job-card" data-status={job.status} key={job.id}>
                    <header>
                      <div>
                        <strong>{copy.jobTypes[job.type]}</strong>
                        <span>{copy.jobStatuses[job.status]}</span>
                      </div>
                      <Link href={localizeHref(`/admin/calls/${job.callId}`)}>
                        {copy.jobCall}
                      </Link>
                    </header>
                    <dl className="admin-operations-list">
                      <Fact label={copy.jobAttempt} value={`${job.attemptCount} / ${job.maxAttempts}`} />
                      <Fact label={copy.jobRunAfter} value={formatDate(job.runAfter, locale)} />
                      <Fact label={copy.jobLeaseUntil} value={job.leaseExpiresAt ? formatDate(job.leaseExpiresAt, locale) : copy.notAvailable} />
                      <Fact label={copy.jobError} value={job.lastErrorCode ?? copy.notAvailable} />
                    </dl>
                    {job.status === "dead_letter" ? (
                      <form onSubmit={(event) => void retryJob(event, job.id)}>
                        <label className="field">
                          <span>{copy.retryJobReason}</span>
                          <input
                            disabled={role !== "superadmin" || retryingJobId === job.id}
                            maxLength={500}
                            minLength={3}
                            name="reason"
                            placeholder={copy.retryJobPlaceholder}
                            required
                          />
                        </label>
                        <button
                          className="secondary-button"
                          disabled={role !== "superadmin" || retryingJobId === job.id}
                          type="submit"
                        >
                          {copy.retryJob}
                        </button>
                        {role !== "superadmin" ? <small>{copy.retryJobRestricted}</small> : null}
                      </form>
                    ) : null}
                  </article>
                ))}
              </div>
              {jobError ? <p className="form-error" role="alert">{jobError}</p> : null}
            </section>

            <section className="admin-outbound-control" data-enabled={status.outboundCalls.enabled}>
              <div>
                <span className="admin-control-state">
                  {status.outboundCalls.enabled ? copy.outboundEnabled : copy.outboundDisabled}
                </span>
                <h2>{copy.outboundTitle}</h2>
                <p>{copy.controlHelp}</p>
                <dl className="admin-operations-list">
                  <Fact label={copy.outboundReason} value={status.outboundCalls.reason} />
                  <Fact label={copy.outboundUpdated} value={status.outboundCalls.updatedAt ? formatDate(status.outboundCalls.updatedAt, locale) : copy.notAvailable} />
                </dl>
              </div>
              <form onSubmit={changeControl}>
                <label className="field">
                  <span>{copy.controlReason}</span>
                  <textarea maxLength={500} minLength={3} name="reason" placeholder={copy.controlReasonPlaceholder} required rows={3} />
                </label>
                <button
                  className={status.outboundCalls.enabled ? "danger-button" : "primary-button"}
                  disabled={controlLoading || (!status.outboundCalls.enabled && role !== "superadmin")}
                  type="submit"
                >
                  {controlLoading
                    ? copy.applyingControl
                    : status.outboundCalls.enabled
                      ? copy.disableCalls
                      : copy.enableCalls}
                </button>
                {!status.outboundCalls.enabled && role !== "superadmin" ? <small>{copy.enableRestricted}</small> : null}
                {controlError ? <p className="form-error" role="alert">{controlError}</p> : null}
              </form>
            </section>
          </div>
        ) : null}
      </main>
    </AppShell>
  );
}

function ComponentCard({ copy, label, state, upstream = false }: {
  copy: AdminOperationsCopy;
  label: string;
  state: "healthy" | "configured" | "development" | "disabled";
  upstream?: boolean;
}) {
  return (
    <article className="admin-component-card" data-state={state}>
      <span>{label}</span>
      <strong>{copy.componentStates[state]}</strong>
      {upstream ? <small>{copy.upstreamNotChecked}</small> : null}
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <article className="admin-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function formatSeconds(seconds: number) {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatDate(value: string, locale: "en" | "de") {
  return new Intl.DateTimeFormat(locale === "de" ? "de-CH" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}
