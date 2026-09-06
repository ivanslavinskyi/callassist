"use client";

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
  return new Intl.DateTimeFormat(locale === "de" ? "de-CH" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "medium"
  }).format(new Date(value));
}
