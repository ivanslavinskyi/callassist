import { notificationDetail } from "./notification-details";
import { DEFAULT_UI_LOCALE, formatDateTime, formatNumber, formatLocale, type UiLocale } from "@callassist/contracts";
import { notificationMessages } from "./notification-messages";
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

const pair = (label: string, value: string) => `${label}: ${value}`;
export function registrationNotificationEmail(report: RegistrationReport, branding: EmailBranding, locale: UiLocale = DEFAULT_UI_LOCALE) {
  const c = notificationMessages[locale];
  return linkedEmail(locale, c.registration, [
    pair(c.name, report.name), pair(c.email, report.email), pair(c.verified, report.emailVerified ? c.yes : c.no),
    pair(c.phone, report.phone), pair(c.language, languageName(report.language, locale)), pair(c.created, date(report.createdAt, locale)),
    pair(c.phoneVerified, date(report.verifiedAt, locale)), pair(c.userId, report.userId)
  ], `/admin/users?userId=${encodeURIComponent(report.userId)}`, c.openUsers, branding);
}
export function callNotificationEmail(report: CallReport, branding: EmailBranding, locale: UiLocale = DEFAULT_UI_LOCALE) {
  const c = notificationMessages[locale];
  const details = [
    pair(c.user, report.user), pair(c.recipient, report.recipient), pair(c.phone, report.phone),
    pair(c.language, languageName(report.language, locale)), pair(c.task, report.objective), pair(c.status, notificationDetail(report.status, locale)),
    ...(report.failure ? [pair(c.failure, report.failure)] : []),
    pair(c.started, date(report.startedAt, locale)), pair(c.ended, date(report.endedAt, locale)),
    pair(c.connected, duration(report.connectedSeconds, locale)), pair(c.elapsed, duration(report.elapsedSeconds, locale)), pair(c.assessment, notificationDetail(report.assessmentStatus, locale))
  ];
  if (report.assessment) {
    details.push(pair(c.conversation, report.assessment.conversation.status === "uncertain" ? c.goals.uncertain! : notificationDetail(report.assessment.conversation.status === "absent" ? "Not confirmed" : report.assessment.conversation.status, locale)), pair(c.goal, c.goals[report.assessment.goal.status] ?? c.unavailable));
    for (const [index, criterion] of report.assessment.criteria.entries()) {
      details.push(pair(c.criterion.replace("{number}", formatNumber(index + 1, locale)), `${report.criteria[index] ?? criterion.id} — ${c.goals[criterion.status] ?? c.unavailable}`));
    }
  }
  if (report.summary) {
    const summaryItems = report.summary.overview.length ? report.summary.overview : report.summary.findings;
    details.push(c.summary, ...summaryItems.map(item => item.label ? pair(item.label, item.text) : item.text));
    if (report.summary.nextSteps.length) details.push(c.next, ...report.summary.nextSteps.map(item => item.text));
  } else details.push(pair(c.summary, c.unavailable));
  details.push(pair(c.coverage, report.costsIncomplete ? c.partial : c.available));
  for (const cost of report.costs) details.push(`${notificationDetail(cost.label, locale)}: ${cost.amountMicros === null ? c.unavailable : formatNumber(cost.amountMicros / 1_000_000, locale, { style: "currency", currency: cost.currency, minimumFractionDigits: 2, maximumFractionDigits: 6 })} (${notificationDetail(cost.basis, locale)})`);
  details.push(c.shared, c.preliminary, pair(c.prepared, date(report.preparedAt, locale)), pair(c.callId, report.callId), pair(c.attemptId, report.attemptId));
  return linkedEmail(locale, c.call, details, `/admin/calls/${report.callId}`, c.openCall, branding);
}
function date(value: string, locale: UiLocale) {
  return Number.isFinite(Date.parse(value)) ? formatDateTime(value, locale, { timeZone: "Europe/Zurich", dateStyle: "medium", timeStyle: "long" }) : notificationMessages[locale].unavailable;
}
function duration(value: number | null, locale: UiLocale) {
  return value === null ? notificationMessages[locale].unavailable : formatNumber(value, locale, { style: "unit", unit: "second", unitDisplay: "long" });
}
function languageName(value: string, locale: UiLocale) {
  try { return new Intl.DisplayNames(formatLocale(locale), { type: "language" }).of(value) ?? value; } catch { return value; }
}
function linkedEmail(locale: UiLocale, subject: string, details: string[], path: string, label: string, branding: EmailBranding) {
  const url = new URL(path, branding.siteUrl).href;
  const content = renderEmail(locale, subject, [...details, pair(label, url),
    pair(notificationMessages[locale].settings, new URL("/admin/system#superadmin-notifications", branding.siteUrl).href)], branding);
  const escaped = url.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  content.html = content.html.replace(escaped, `<a href="${escaped}" style="color:#35614b">${label}</a>`);
  return content;
}
