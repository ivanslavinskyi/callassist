"use client";

import type { CallBrief } from "@callassist/contracts";
import { useEffect, useState } from "react";
import { AppShell } from "./app-shell";
import { CreateCallForm } from "./create-call-form";
import { listCallBriefs } from "@/lib/api";

const statusLabels: Record<CallBrief["status"], string> = {
  ready: "Ready",
  dialing: "Dialing",
  in_progress: "In progress",
  awaiting_approval: "Decision required",
  completed: "Completed",
  stopped: "Stopped",
  failed: "Failed"
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
            <span className="eyebrow">Personal voice agent</span>
            <h1>
              Every call under
              <span> your control.</span>
            </h1>
            <p>
              Set the objective and language. CallAssist handles the conversation,
              streams a live draft, and creates a more accurate transcript after
              the call.
            </p>
          </div>
          <div className="trust-card">
            <span className="trust-icon" aria-hidden="true">◎</span>
            <div>
              <strong>Default deny</strong>
              <span>No approval, no disclosure</span>
            </div>
          </div>
        </section>

        <div className="dashboard-grid">
          <CreateCallForm onCreated={openBrief} />

          <aside className="activity-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">History</span>
                <h2>Recent call briefs</h2>
              </div>
              <span className="counter">{briefs.length}</span>
            </div>

            {briefs.length === 0 ? (
              <div className="empty-state">
                <span aria-hidden="true">↗</span>
                <strong>Your calls will appear here</strong>
                <p>The first brief is pre-filled. Choose a language and create it.</p>
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
                <strong>Consent first.</strong> Audio recording starts only after the
                recipient presses 1 and is deleted according to the selected
                retention period.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
