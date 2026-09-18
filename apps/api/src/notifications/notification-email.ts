import type { CallAssessmentDecision, CallSummaryPayload } from "@callassist/contracts";
import type { EmailBranding } from "../auth/email-branding";
import { renderEmail } from "../auth/email-templates";

export type RegistrationReport = {
  userId: string; name: string; email: string; phone: string; emailVerified: boolean;
  language: string; createdAt: string; verifiedAt: string;
};
export type CallReport = {
  callId: string; attemptId: string; user: string; recipient: string; phone: string;
  language: string; objective: string; status: string; failure: string | null;
  startedAt: string; endedAt: string; connectedSeconds: number | null; elapsedSeconds: number;
  assessmentStatus: string; assessment: CallAssessmentDecision | null;
  criteria: string[]; summary: CallSummaryPayload | null;
  costs: Array<{ label: string; amountMicros: number | null; currency: string; basis: string }>;
  costsIncomplete: boolean; preparedAt: string;
};

const money = (micros: number | null, currency: string) => micros === null ? "Unavailable" :
  `${currency} ${(micros / 1_000_000).toFixed(6)}`;
const goalLabel = (value: string) => ({ achieved: "Achieved", partial: "Partially achieved", not_achieved: "Not achieved", uncertain: "Uncertain" })[value] ?? value;

export function registrationNotificationEmail(report: RegistrationReport, branding: EmailBranding) {
  return linkedEmail("New registration confirmed", [
    `Name: ${report.name}`, `Email: ${report.email}`, `Email verified: ${report.emailVerified ? "Yes" : "No"}`,
    `Phone: ${report.phone}`, `Interface language: ${report.language}`, `Account created: ${report.createdAt}`,
    `Phone verified: ${report.verifiedAt}`, `User ID: ${report.userId}`
  ], `/admin/users?userId=${encodeURIComponent(report.userId)}`, "Open users", branding);
}

export function callNotificationEmail(report: CallReport, branding: EmailBranding) {
  const details = [
    `User: ${report.user}`, `Recipient: ${report.recipient}`, `Phone: ${report.phone}`,
    `Call language: ${report.language}`, `Task: ${report.objective}`, `Status: ${report.status}`,
    ...(report.failure ? [`Failure reason: ${report.failure}`] : []),
    `Started: ${report.startedAt}`, `Ended: ${report.endedAt}`,
    `Connected duration: ${report.connectedSeconds === null ? "Unavailable" : `${report.connectedSeconds} seconds`}`,
    `Total attempt duration (including dialing): ${report.elapsedSeconds} seconds`,
    `LLM assessment: ${report.assessmentStatus}`
  ];
  if (report.assessment) {
    details.push(`Conversation: ${report.assessment.conversation.status}`, `Goal: ${goalLabel(report.assessment.goal.status)}`);
    for (const [index, criterion] of report.assessment.criteria.entries()) {
      details.push(`Criterion ${index + 1}: ${report.criteria[index] ?? criterion.id} — ${goalLabel(criterion.status)}`);
    }
  }
  if (report.summary) {
    // The labels supplied by the model and all source text retain their language.
    const summaryItems = report.summary.overview.length ? report.summary.overview : report.summary.findings;
    details.push("Summary (original language)", ...summaryItems.map(item => item.label ? `${item.label}: ${item.text}` : item.text));
    if (report.summary.nextSteps.length) details.push("Next steps (original language)", ...report.summary.nextSteps.map(item => item.text));
  } else details.push("Summary: Unavailable");
  details.push(`Cost coverage: ${report.costsIncomplete ? "Partial — some usage or provider prices are unavailable" : "Available at report time"}`);
  for (const cost of report.costs) details.push(`${cost.label}: ${money(cost.amountMicros, cost.currency)} (${cost.basis})`);
  details.push("Shared preparation costs are listed separately and are not charged again for each attempt.",
    "Costs are preliminary. Later usage and provider prices appear in the call inspector.",
    `Report prepared: ${report.preparedAt}`, `Call ID: ${report.callId}`, `Attempt ID: ${report.attemptId}`);
  return linkedEmail(`Call finished: ${report.status}`, details, `/admin/calls/${report.callId}`, "Open call inspector", branding);
}

function linkedEmail(subject: string, details: string[], path: string, label: string, branding: EmailBranding) {
  const url = new URL(path, branding.siteUrl).href;
  const content = renderEmail("en", subject, [...details, `${label}: ${url}`,
    `Notification settings: ${new URL("/admin/system#superadmin-notifications", branding.siteUrl).href}`], branding);
  // renderEmail escapes the complete text; replace only this trusted, generated URL.
  const escaped = url.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  content.html = content.html.replace(escaped, `<a href="${escaped}" style="color:#35614b">${label}</a>`);
  return content;
}
