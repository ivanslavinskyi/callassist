"use client";

import {
  SUPPORTED_CALL_LANGUAGES,
  type CallEvent,
  type CallBriefStatus,
  type CallSnapshot
} from "@callassist/contracts";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "./app-shell";
import {
  callEventsUrl,
  decideApproval,
  getCallSnapshot,
  startCall,
  stopCall
} from "@/lib/api";

const statusLabels: Record<CallBriefStatus, string> = {
  ready: "Ready to start",
  dialing: "Dialing",
  in_progress: "Call in progress",
  awaiting_approval: "Awaiting decision",
  completed: "Call completed",
  stopped: "Call stopped",
  failed: "Call failed"
};

const activeStatuses = new Set<CallBriefStatus>([
  "dialing",
  "in_progress",
  "awaiting_approval"
]);

export function LiveCall({ callId }: { callId: string }) {
  const [snapshot, setSnapshot] = useState<CallSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partialTranscript, setPartialTranscript] = useState<
    Record<
      string,
      { role: "assistant" | "recipient"; text: string; locale: string }
    >
  >({});

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await getCallSnapshot(callId));
      setError(null);
    } catch {
      setError("The call brief was not found or the API is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [callId]);

  useEffect(() => {
    void refresh();
    const events = new EventSource(callEventsUrl(callId));
    events.onmessage = (message) => {
      let event: CallEvent;
      try {
        event = JSON.parse(message.data) as CallEvent;
      } catch {
        return;
      }

      if (event.type === "transcript.delta") {
        setPartialTranscript((current) => ({
          ...current,
          [event.key]: {
            role: event.role,
            locale: event.locale,
            text: `${current[event.key]?.text ?? ""}${event.delta}`
          }
        }));
        return;
      }

      if (event.type === "transcript.added") {
        setPartialTranscript((current) =>
          Object.fromEntries(
            Object.entries(current).filter(
              ([, partial]) => partial.role !== event.segment.role
            )
          )
        );
      }
      void refresh();
    };
    events.onerror = () => setError("The live connection is reconnecting…");
    return () => events.close();
  }, [callId, refresh]);

  const language = useMemo(
    () =>
      SUPPORTED_CALL_LANGUAGES.find(
        ({ locale }) => locale === snapshot?.brief.locale
      ),
    [snapshot?.brief.locale]
  );

  async function runAction(action: () => Promise<CallSnapshot>) {
    setBusy(true);
    setError(null);
    try {
      setSnapshot(await action());
    } catch {
      setError("The action could not be completed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <main className="live-page"><div className="loading-card">Loading call brief…</div></main>
      </AppShell>
    );
  }

  if (!snapshot) {
    return (
      <AppShell>
        <main className="live-page">
          <div className="loading-card">
            <strong>Call brief unavailable</strong>
            <p>{error}</p>
            <Link href="/">Return to dashboard</Link>
          </div>
        </main>
      </AppShell>
    );
  }

  const { brief, transcript, pendingApproval } = snapshot;
  const isActive = activeStatuses.has(brief.status);

  return (
    <AppShell>
      <main className="live-page">
        <div className="live-nav">
          <Link className="back-link" href="/">← All call briefs</Link>
          <span className={`status-pill status-${brief.status}`}>
            <span aria-hidden="true" /> {statusLabels[brief.status]}
          </span>
        </div>

        <section className="call-hero">
          <div>
            <span className="eyebrow">Active call brief</span>
            <h1>{brief.recipientName}</h1>
            <div className="call-meta">
              <span>{brief.phoneNumber}</span>
              <span className="meta-divider" />
              <span>{language?.label ?? brief.locale}</span>
            </div>
          </div>

          <div className="call-actions">
            {brief.status === "ready" ? (
              <button
                className="primary-button compact-button"
                disabled={busy}
                onClick={() => runAction(() => startCall(callId))}
                type="button"
              >
                <span className="button-signal" aria-hidden="true">◖</span>
                Start call
              </button>
            ) : null}
            {isActive ? (
              <button
                className="danger-button"
                disabled={busy}
                onClick={() => runAction(() => stopCall(callId))}
                type="button"
              >
                <span aria-hidden="true">■</span> Stop call
              </button>
            ) : null}
          </div>
        </section>

        {error ? <div className="inline-notice">{error}</div> : null}

        <div className="live-grid">
          <section className="transcript-card">
            <div className="transcript-heading">
              <div>
                <span className="eyebrow">Live transcript</span>
                <h2>Conversation</h2>
              </div>
              {isActive ? (
                <div className="live-indicator"><span /><span /><span /></div>
              ) : null}
            </div>

            <div className="transcript-list" aria-live="polite">
              {transcript.length === 0 &&
              Object.keys(partialTranscript).length === 0 ? (
                <div className="transcript-empty">
                  <span className="wave-placeholder" aria-hidden="true">
                    <i /><i /><i /><i /><i />
                  </span>
                  <strong>The transcript will appear here</strong>
                  <p>After the recipient consents, each turn will appear here in real time.</p>
                </div>
              ) : (
                <>
                  {transcript.map((segment) => (
                  <article className={`transcript-line role-${segment.role}`} key={segment.id}>
                    <div className="speaker-mark">
                      {segment.role === "assistant" ? "AI" : "RE"}
                    </div>
                    <div>
                      <div className="speaker-row">
                        <strong>
                          {segment.role === "assistant" ? "CallAssist" : brief.recipientName}
                        </strong>
                        <time>
                          {new Date(segment.createdAt).toLocaleTimeString("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit"
                          })}
                        </time>
                      </div>
                      <p>{segment.text}</p>
                      <span className="locale-tag">{segment.locale}</span>
                    </div>
                  </article>
                  ))}
                  {Object.entries(partialTranscript).map(([key, segment]) => (
                    <article
                      className={`transcript-line role-${segment.role}`}
                      key={key}
                    >
                      <div className="speaker-mark">
                        {segment.role === "assistant" ? "AI" : "RE"}
                      </div>
                      <div>
                        <div className="speaker-row">
                          <strong>
                            {segment.role === "assistant"
                              ? brief.agentName
                              : brief.recipientName}
                          </strong>
                          <time>live</time>
                        </div>
                        <p>{segment.text}…</p>
                        <span className="locale-tag">{segment.locale}</span>
                      </div>
                    </article>
                  ))}
                </>
              )}
            </div>
          </section>

          <aside className="call-sidebar">
            {pendingApproval ? (
              <section className="approval-card">
                <div className="approval-icon" aria-hidden="true">!</div>
                <span className="eyebrow">Decision required</span>
                <h2>{pendingApproval.title}</h2>
                <p>{pendingApproval.reason}</p>
                <div className="speech-preview">
                  <span>The assistant will say</span>
                  <blockquote>“{pendingApproval.proposedSpeech}”</blockquote>
                </div>
                <div className="approval-actions">
                  <button
                    className="approve-button"
                    disabled={busy}
                    onClick={() =>
                      runAction(() =>
                        decideApproval(callId, pendingApproval.id, "approved")
                      )
                    }
                    type="button"
                  >
                    Approve
                  </button>
                  <button
                    className="decline-button"
                    disabled={busy}
                    onClick={() =>
                      runAction(() =>
                        decideApproval(callId, pendingApproval.id, "declined")
                      )
                    }
                    type="button"
                  >
                    Do not disclose
                  </button>
                </div>
              </section>
            ) : (
              <section className="guard-card">
                <div className="guard-visual" aria-hidden="true">
                  <span>✓</span>
                </div>
                <h2>Safety gate active</h2>
                <p>Private data cannot enter the conversation without your approval.</p>
              </section>
            )}

            <section className="brief-card">
              <span className="eyebrow">Call brief</span>
              <h2>Call objective</h2>
              <p>{brief.objective}</p>
              <dl>
                <div><dt>Primary language</dt><dd>{brief.locale}</dd></div>
                <div>
                  <dt>Language switching</dt>
                  <dd>{brief.allowLanguageSwitch ? brief.fallbackLocale : "Disabled"}</dd>
                </div>
                <div>
                  <dt>Voice</dt>
                  <dd>{brief.voiceGender === "female" ? "Female" : "Male"}</dd>
                </div>
                <div><dt>Assistant</dt><dd>{brief.agentName}</dd></div>
              </dl>
            </section>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
