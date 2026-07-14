"use client";

import type { CallBrief } from "@callassist/contracts";
import { useEffect, useState } from "react";
import { AppShell } from "./app-shell";
import { CreateCallForm } from "./create-call-form";
import { listCallBriefs } from "@/lib/api";

const statusLabels: Record<CallBrief["status"], string> = {
  ready: "Готов",
  dialing: "Набор номера",
  in_progress: "Разговор",
  awaiting_approval: "Нужно решение",
  completed: "Завершён",
  stopped: "Остановлен",
  failed: "Ошибка"
};

export function Dashboard() {
  const [briefs, setBriefs] = useState<CallBrief[]>([]);

  useEffect(() => {
    listCallBriefs()
      .then(({ items }) => setBriefs(items))
      .catch(() => undefined);
  }, []);

  function openBrief(brief: CallBrief) {
    window.location.assign(`/calls/${brief.id}`);
  }

  return (
    <AppShell>
      <main className="dashboard-page">
        <section className="hero-block">
          <div>
            <span className="eyebrow">Личный голосовой агент</span>
            <h1>
              Звонок под вашим
              <span> контролем.</span>
            </h1>
            <p>
              Задайте цель и язык. CallAssist проведёт разговор, покажет транскрипт
              и остановится перед раскрытием личных данных.
            </p>
          </div>
          <div className="trust-card">
            <span className="trust-icon" aria-hidden="true">◎</span>
            <div>
              <strong>Default deny</strong>
              <span>Нет подтверждения — нет раскрытия</span>
            </div>
          </div>
        </section>

        <div className="dashboard-grid">
          <CreateCallForm onCreated={openBrief} />

          <aside className="activity-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">История</span>
                <h2>Последние задания</h2>
              </div>
              <span className="counter">{briefs.length}</span>
            </div>

            {briefs.length === 0 ? (
              <div className="empty-state">
                <span aria-hidden="true">↗</span>
                <strong>Здесь появятся звонки</strong>
                <p>Первое задание уже заполнено — выберите язык и создайте его.</p>
              </div>
            ) : (
              <div className="brief-list">
                {briefs.map((brief) => (
                  <button
                    className="brief-row"
                    key={brief.id}
                    onClick={() => openBrief(brief)}
                    type="button"
                  >
                    <span className="brief-avatar">{brief.recipientName.slice(0, 1)}</span>
                    <span className="brief-copy">
                      <strong>{brief.recipientName}</strong>
                      <small>{brief.locale} · {statusLabels[brief.status]}</small>
                    </span>
                    <span aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
            )}

            <div className="privacy-note">
              <span aria-hidden="true">⌁</span>
              <p>
                <strong>Аудиозапись выключена.</strong> Сейчас работает только локальная
                mock-сессия без Twilio и OpenAI.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
