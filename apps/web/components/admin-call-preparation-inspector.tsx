"use client";
import { formatLocale } from "@callassist/contracts";

import type { AdminCallPreparationInspector as InspectorData } from "@callassist/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getAdminCallPreparationInspector, getPreparationValidationEvidence } from "@/lib/api";
import { adminCallMessages } from "@/lib/i18n/admin-call-messages";
import { AdminCostBreakdown } from "./admin-cost-breakdown";
import { AdminPreparationTiming } from "./admin-preparation-timing";

export function AdminCallPreparationInspector({
  preparationId
}: {
  preparationId: string;
}) {
  const locale = "en" as const;
  const copy = adminCallMessages[locale];
  const [inspector, setInspector] = useState<InspectorData | null>(null);
  const [reason,setReason]=useState("");
  const [evidence,setEvidence]=useState<unknown>(null);
  const [loadingEvidence,setLoadingEvidence]=useState(false);
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
          <AdminPreparationTiming inspector={inspector} />
          <section className="admin-inspector-summary">
            <h2>Plan validation</h2>
            <p>Application validation is recorded separately from provider transport results. Private evidence is retained for up to 30 days.</p>
            <ol>{inspector.validationEvents?.map(event=><li key={event.id}>
              <time>{formatDate(event.createdAt,locale)}</time>{" "}{event.metadata.stage}: <strong>{event.metadata.code}</strong>
              {` · candidate ${event.metadata.candidateAttempt}, audit ${event.metadata.auditAttempt} · worker ${event.jobGeneration}/${event.workerAttempt}`}
              {event.metadata.truncated?" · evidence truncated":""}
            </li>)}</ol>
            <label>Reason for private evidence access<input value={reason} maxLength={500} onChange={e=>setReason(e.target.value)} /></label>
            <button type="button" disabled={loadingEvidence||reason.trim().length<3} onClick={async()=>{
              setLoadingEvidence(true);setError(null);
              try {setEvidence(await getPreparationValidationEvidence(preparationId,reason));}
              catch {setError("Private diagnostic evidence could not be loaded.");}
              finally {setLoadingEvidence(false);}
            }}>Inspect private evidence</button>
            {evidence!==null?<>
              <button type="button" onClick={()=>{
                const url=URL.createObjectURL(new Blob([JSON.stringify({preparationId,evidence},null,2)],{type:"application/json"}));
                const link=document.createElement("a");link.href=url;link.download=`preparation-${preparationId}.json`;link.click();URL.revokeObjectURL(url);
              }}>Export diagnostic JSON</button>
              <details><summary>Private source, candidate and audit responses</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(evidence,null,2)}</pre></details>
            </>:null}
          </section>
          <AdminCostBreakdown cost={inspector.cost} locale={locale} />
        </>
      ) : null}
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function formatDate(value: string, locale: "en" | "de") {
  return new Intl.DateTimeFormat(formatLocale(locale), {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}
