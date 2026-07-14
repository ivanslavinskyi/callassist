"use client";

import {
  SUPPORTED_CALL_LANGUAGES,
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
  ready: "Готов к запуску",
  dialing: "Набираем номер",
  in_progress: "Разговор идёт",
  awaiting_approval: "Ожидает решения",
  completed: "Звонок завершён",
  stopped: "Звонок остановлен",
  failed: "Ошибка звонка"
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

  const refresh = useCallback(async () => {
    try {
      setSnapshot(await getCallSnapshot(callId));
      setError(null);
    } catch {
      setError("Задание не найдено или API недоступен.");
    } finally {
      setLoading(false);
    }
  }, [callId]);

  useEffect(() => {
    void refresh();
    const events = new EventSource(callEventsUrl(callId));
    events.onmessage = () => void refresh();
    events.onerror = () => setError("Live-канал переподключается…");
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
      setError("Команда не выполнена. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <main className="live-page"><div className="loading-card">Загружаем задание…</div></main>
      </AppShell>
    );
  }

  if (!snapshot) {
    return (
      <AppShell>
        <main className="live-page">
          <div className="loading-card">
            <strong>Задание недоступно</strong>
            <p>{error}</p>
            <Link href="/">Вернуться в пульт</Link>
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
          <Link className="back-link" href="/">← Все задания</Link>
          <span className={`status-pill status-${brief.status}`}>
            <span aria-hidden="true" /> {statusLabels[brief.status]}
          </span>
        </div>

        <section className="call-hero">
          <div>
            <span className="eyebrow">Активное задание</span>
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
                Запустить симуляцию
              </button>
            ) : null}
            {isActive ? (
              <button
                className="danger-button"
                disabled={busy}
                onClick={() => runAction(() => stopCall(callId))}
                type="button"
              >
                <span aria-hidden="true">■</span> Остановить
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
                <h2>Разговор</h2>
              </div>
              {isActive ? (
                <div className="live-indicator"><span /><span /><span /></div>
              ) : null}
            </div>

            <div className="transcript-list" aria-live="polite">
              {transcript.length === 0 ? (
                <div className="transcript-empty">
                  <span className="wave-placeholder" aria-hidden="true">
                    <i /><i /><i /><i /><i />
                  </span>
                  <strong>Транскрипт появится здесь</strong>
                  <p>Запустите симуляцию — mock-диалог начнётся через несколько секунд.</p>
                </div>
              ) : (
                transcript.map((segment) => (
                  <article className={`transcript-line role-${segment.role}`} key={segment.id}>
                    <div className="speaker-mark">
                      {segment.role === "assistant" ? "AI" : "GE"}
                    </div>
                    <div>
                      <div className="speaker-row">
                        <strong>
                          {segment.role === "assistant" ? "CallAssist" : brief.recipientName}
                        </strong>
                        <time>
                          {new Date(segment.createdAt).toLocaleTimeString("ru-RU", {
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
                ))
              )}
            </div>
          </section>

          <aside className="call-sidebar">
            {pendingApproval ? (
              <section className="approval-card">
                <div className="approval-icon" aria-hidden="true">!</div>
                <span className="eyebrow">Требуется решение</span>
                <h2>{pendingApproval.title}</h2>
                <p>{pendingApproval.reason}</p>
                <div className="speech-preview">
                  <span>Ассистент произнесёт</span>
                  <blockquote>«{pendingApproval.proposedSpeech}»</blockquote>
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
                    Разрешить
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
                    Не сообщать
                  </button>
                </div>
              </section>
            ) : (
              <section className="guard-card">
                <div className="guard-visual" aria-hidden="true">
                  <span>✓</span>
                </div>
                <h2>Контур безопасности активен</h2>
                <p>Личные данные не попадут в диалог без вашего решения.</p>
              </section>
            )}

            <section className="brief-card">
              <span className="eyebrow">Call brief</span>
              <h2>Цель разговора</h2>
              <p>{brief.objective}</p>
              <dl>
                <div><dt>Основной язык</dt><dd>{brief.locale}</dd></div>
                <div>
                  <dt>Смена языка</dt>
                  <dd>{brief.allowLanguageSwitch ? brief.fallbackLocale : "Запрещена"}</dd>
                </div>
                <div><dt>Режим</dt><dd>Симуляция</dd></div>
              </dl>
            </section>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
