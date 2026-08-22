"use client";

import type {
  AdminCallInspector as AdminCallInspectorData,
  AdminCallSensitiveContent,
  UserRole
} from "@callassist/contracts";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { AppShell } from "./app-shell";
import { useUiLocale } from "./ui-locale-provider";
import {
  accessAdminCallSensitiveContent,
  getAdminCallInspector,
  getCurrentUser
} from "@/lib/api";
import { adminCallMessages } from "@/lib/i18n/admin-call-messages";

export function AdminCallInspector({ callId }: { callId: string }) {
  const { locale, localizeHref } = useUiLocale();
  const copy = adminCallMessages[locale];
  const [role, setRole] = useState<UserRole | null>(null);
  const [inspector, setInspector] = useState<AdminCallInspectorData | null>(null);
  const [sensitive, setSensitive] = useState<AdminCallSensitiveContent | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [sensitiveLoading, setSensitiveLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sensitiveError, setSensitiveError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([getCurrentUser(), getAdminCallInspector(callId)])
      .then(([{ user }, data]) => {
        if (!active) return;
        setRole(user.role);
        setInspector(data);
      })
      .catch(() => {
        if (active) setError(copy.inspectorError);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [callId, copy.inspectorError]);

  async function loadSensitive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "")
      .trim();
    if (reason.length < 3) {
      setSensitiveError(copy.sensitiveError);
      return;
    }
    setSensitiveLoading(true);
    setSensitiveError(null);
    try {
      setSensitive(await accessAdminCallSensitiveContent(callId, reason));
    } catch {
      setSensitiveError(copy.sensitiveError);
    } finally {
      setSensitiveLoading(false);
    }
  }

  const summary = inspector?.summary;
  return (
    <AppShell>
      <main className="admin-inspector-page" id="main-content">
        <Link className="auth-inline-link" href={localizeHref("/admin/calls")}>
          ← {copy.back}
        </Link>
        <header className="admin-inspector-heading">
          <span className="eyebrow">{copy.inspectorEyebrow}</span>
          <h1>{copy.inspectorTitle}</h1>
          <code>{callId}</code>
        </header>

        {loading ? <p role="status">{copy.loading}</p> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}

        {summary && inspector ? (
          <>
            <section className="admin-inspector-summary">
              <h2>{copy.technical}</h2>
              <dl>
                <Fact label={copy.status} value={copy.statuses[summary.status]} />
                <Fact label={copy.owner} value={summary.ownerUserId ?? copy.notAvailable} />
                <Fact label={copy.language} value={copy.languages[summary.locale]} />
                <Fact label={copy.connection} value={copy.connections[summary.technical.connection]} />
                <Fact label={copy.consent} value={copy.consents[summary.technical.consent]} />
                <Fact label={copy.recording} value={copy.processStates[summary.technical.recording]} />
                <Fact label={copy.transcription} value={copy.processStates[summary.technical.transcription]} />
                <Fact
                  label={copy.outcome}
                  value={summary.semanticOutcome
                    ? copy.outcomes[summary.semanticOutcome]
                    : copy.notAvailable}
                />
                <Fact
                  label={copy.failureStage}
                  value={summary.technical.failureStage
                    ? copy.failures[summary.technical.failureStage]
                    : copy.notAvailable}
                />
                <Fact label={copy.failureCode} value={summary.technical.failureCode ?? copy.notAvailable} />
                <Fact label={copy.duration} value={formatDuration(summary.durationSeconds)} />
                <Fact label={copy.eventCount} value={String(summary.eventCount)} />
              </dl>
            </section>

            <div className="admin-inspector-grid">
              <section className="admin-inspector-panel">
                <h2>{copy.timeline}</h2>
                {inspector.timeline.length === 0 ? <p>{copy.noTimeline}</p> : (
                  <ol className="admin-call-timeline">
                    {inspector.timeline.map((event) => (
                      <li data-severity={event.severity} key={event.id}>
                        <div>
                          <strong>{event.payload.name}</strong>
                          <time>{formatDate(event.occurredAt, locale)}</time>
                        </div>
                        <small>
                          #{event.sequence} · {event.source} · {event.stage} · {event.severity}
                        </small>
                        {Object.keys(event.payload.metadata).length > 0 ? (
                          <pre>{JSON.stringify(event.payload.metadata, null, 2)}</pre>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section className="admin-inspector-panel">
                <h2>{copy.outcomeHistory}</h2>
                {inspector.outcomeHistory.length === 0 ? (
                  <p>{copy.noOutcomeHistory}</p>
                ) : (
                  <ol className="admin-outcome-history">
                    {inspector.outcomeHistory.map((outcome) => (
                      <li key={outcome.id}>
                        <strong>
                          {copy.revision} {outcome.revision} · {copy.provenance[outcome.provenance]}
                        </strong>
                        <span>
                          {outcome.outcome
                            ? copy.outcomes[outcome.outcome]
                            : copy.technical}
                        </span>
                        <time>{formatDate(outcome.createdAt, locale)}</time>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>

            <section className="admin-sensitive-panel">
              <h2>{copy.sensitiveTitle}</h2>
              <p>{copy.sensitiveHelp}</p>
              {role !== "superadmin" ? (
                <p className="admin-sensitive-forbidden">{copy.sensitiveForbidden}</p>
              ) : sensitive ? (
                <SensitiveContent content={sensitive} locale={locale} />
              ) : (
                <form onSubmit={loadSensitive}>
                  <label className="field">
                    <span>{copy.sensitiveReason}</span>
                    <textarea
                      maxLength={500}
                      minLength={3}
                      name="reason"
                      placeholder={copy.sensitiveReasonPlaceholder}
                      required
                      rows={3}
                    />
                  </label>
                  <button
                    className="danger-button"
                    disabled={sensitiveLoading}
                    type="submit"
                  >
                    {sensitiveLoading
                      ? copy.sensitiveLoading
                      : copy.sensitiveAction}
                  </button>
                </form>
              )}
              {sensitiveError ? (
                <p className="form-error" role="alert">{sensitiveError}</p>
              ) : null}
            </section>
          </>
        ) : null}
      </main>
    </AppShell>
  );
}

function SensitiveContent({
  content,
  locale
}: {
  content: AdminCallSensitiveContent;
  locale: "en" | "de";
}) {
  const copy = adminCallMessages[locale];
  return (
    <div className="admin-sensitive-content">
      <p className="inline-notice">{copy.sensitiveWarning}</p>
      <dl>
        <Fact label={copy.recipient} value={content.recipientName} />
        <Fact label={copy.phone} value={content.phoneNumber} />
        <Fact label={copy.representedPerson} value={content.representedPerson} />
      </dl>
      <SensitiveText label={copy.objective} text={content.objective} />
      <SensitiveText label={copy.context} text={content.context || copy.empty} />
      <SensitiveText
        label={copy.allowedFacts}
        text={content.allowedFacts.length > 0
          ? content.allowedFacts.map((fact) => `• ${fact}`).join("\n")
          : copy.empty}
      />
      <section>
        <h3>{copy.liveTranscript}</h3>
        {content.transcript.length > 0 ? (
          <ol className="admin-sensitive-transcript">
            {content.transcript.map((segment) => (
              <li key={segment.id}>
                <strong>{segment.role}</strong>
                <p>{segment.text}</p>
              </li>
            ))}
          </ol>
        ) : <p>{copy.empty}</p>}
      </section>
      <SensitiveText
        label={copy.finalTranscript}
        text={content.finalTranscript?.text ?? copy.empty}
      />
      <SensitiveText
        label={copy.feedbackComment}
        text={content.feedbackComment ?? copy.empty}
      />
    </div>
  );
}

function SensitiveText({ label, text }: { label: string; text: string }) {
  return <section><h3>{label}</h3><pre>{text}</pre></section>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function formatDate(value: string, locale: "en" | "de") {
  return new Intl.DateTimeFormat(locale === "de" ? "de-CH" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
