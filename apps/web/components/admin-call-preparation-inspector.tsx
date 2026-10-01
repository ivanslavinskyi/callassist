"use client";
import { formatLocale } from "@callassist/contracts";

import type { AdminCallPreparationInspector as InspectorData } from "@callassist/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getAdminCallPreparationInspector } from "@/lib/api";
import { adminCallMessages } from "@/lib/i18n/admin-call-messages";
import { AdminCostBreakdown } from "./admin-cost-breakdown";

export function AdminCallPreparationInspector({
  preparationId
}: {
  preparationId: string;
}) {
  const locale = "en" as const;
  const copy = adminCallMessages[locale];
  const [inspector, setInspector] = useState<InspectorData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getAdminCallPreparationInspector(preparationId)
      .then((result) => {
        if (active) setInspector(result);
      })
      .catch(() => {
        if (active) setError(copy.inspectorError);
      });
    return () => {
      active = false;
    };
  }, [copy.inspectorError, preparationId]);

  return (
    <main className="admin-calls-page" id="main-content">
      <header className="admin-calls-heading">
        <span className="eyebrow">{copy.preparationEyebrow}</span>
        <h1>{copy.preparationTitle}</h1>
        <p>{copy.preparationHelp}</p>
        <Link href="/admin/system">{copy.preparationBack}</Link>
      </header>

      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {!inspector && !error ? <p role="status">{copy.loading}</p> : null}
      {inspector ? (
        <>
          <section className="admin-inspector-summary">
            <h2>{copy.technical}</h2>
            <dl>
              <Fact label={copy.preparationId} value={inspector.preparation.id} />
              <Fact
                label={copy.status}
                value={copy.preparationStatuses[inspector.preparation.status]}
              />
              <Fact
                label={copy.preparationAttempts}
                value={String(inspector.preparation.attemptCount)}
              />
              <Fact
                label={copy.preparationFailure}
                value={inspector.preparation.failureCode ?? copy.notAvailable}
              />
              <Fact
                label={copy.created}
                value={formatDate(inspector.preparation.createdAt, locale)}
              />
              <Fact
                label={copy.preparationCompleted}
                value={inspector.preparation.completedAt
                  ? formatDate(inspector.preparation.completedAt, locale)
                  : copy.notAvailable}
              />
            </dl>
            {inspector.preparation.callBriefId ? (
              <Link
                className="secondary-button"
                href={`/admin/calls/${inspector.preparation.callBriefId}`}
              >
                {copy.preparationLinkedCall}
              </Link>
            ) : null}
          </section>
          <section className="admin-inspector-summary" aria-labelledby="preparation-timing-title">
            <h2 id="preparation-timing-title">Preparation timing</h2>
            <p>Times cover preparation requests. Review translation may finish afterward. Historical requests may not identify language audits or repairs.</p>
            <dl>
              <Fact label="Initial queue wait" value={inspector.initialQueueMs == null ? "Unknown" : seconds(inspector.initialQueueMs)} />
              <Fact label="Preparation elapsed" value={seconds(Date.parse(inspector.preparation.completedAt ?? inspector.generatedAt) - Date.parse(inspector.preparation.createdAt))} />
            </dl>
            {inspector.timeline?.length ? <div style={{ overflowX: "auto" }}><table>
              <caption>Provider requests in execution order</caption>
              <thead><tr><th>Stage / model</th><th>Started after</th><th>Duration</th><th>Outcome</th><th>Attempt / repair</th></tr></thead>
              <tbody>{inspector.timeline.map(request => <tr key={request.id}>
                <td>{request.stage.replaceAll("_", " ")}<br /><small>{request.model}</small></td>
                <td>{seconds(Date.parse(request.startedAt) - Date.parse(inspector.preparation.createdAt))}</td>
                <td>{request.durationMs === null ? "Pending / unknown" : seconds(request.durationMs)}</td>
                <td>{request.outcome ?? "No final response"}{request.errorCode ? <><br /><code>{request.errorCode}</code></> : null}</td>
                <td>{request.metadata ? `${request.metadata.transportAttempt} / ${request.metadata.repairKind} ${request.metadata.repairNumber}` : "Not recorded"}</td>
              </tr>)}</tbody>
            </table></div> : <p>No provider timing records retained.</p>}
          </section>
          <AdminCostBreakdown cost={inspector.cost} locale={locale} />
        </>
      ) : null}
    </main>
  );
}

function seconds(milliseconds: number) { return `${(Math.max(0, milliseconds) / 1000).toFixed(2)} s`; }

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function formatDate(value: string, locale: "en" | "de") {
  return new Intl.DateTimeFormat(formatLocale(locale), {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}
