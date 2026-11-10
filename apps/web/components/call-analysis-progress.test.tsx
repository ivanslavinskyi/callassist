import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { deriveCallLifecycle, uiLocales } from "@callassist/contracts";
import { CallAnalysisProgress } from "./call-analysis-progress";
import { CallAssessments } from "./call-assessments";
import { CallLifecycleSummary } from "./call-lifecycle-summary";
import { callPresentationCopy } from "@/lib/i18n/call-presentation";

it.each(uiLocales)("labels indeterminate analysis accessibly in %s without fictitious percentages", locale => {
  const html = renderToStaticMarkup(<CallAnalysisProgress locale={locale} />);
  expect(html).toContain('role="progressbar"');
  expect(html).toContain('aria-label="');
  expect(html).not.toContain('aria-valuenow');
  expect(html).not.toContain('…');
});

it.each(uiLocales)("shows pending analysis and settled states in user and admin presentations in %s", locale => {
  const base = deriveCallLifecycle("completed", []);
  for (const status of ["pending", "ready", "unavailable"] as const) {
    const lifecycle = { ...base, result: "assessment_pending" as const, assessment: {
      status, conversation: null, goal: null, reason: null, updatedAt: "2026-11-10T09:00:00.000Z",
      deadlineAt: "2026-11-10T09:05:00.000Z", transcriptRevisionId: null, evaluatorVersion: null
    } };
    for (const admin of [false, true]) {
      const html = renderToStaticMarkup(<><CallAssessments brief={{ status: "completed", lifecycle }} locale={locale} admin={admin} />
        <CallLifecycleSummary lifecycle={lifecycle} locale={locale} /></>);
      expect(html.includes('role="progressbar"')).toBe(status === "pending");
      const label = admin ? callPresentationCopy[locale].adminUser : callPresentationCopy[locale].user;
      expect(html).toContain(renderToStaticMarkup(<strong>{label}:</strong>));
    }
  }
});
