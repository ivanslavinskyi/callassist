import type { AdminSystemStatus } from "@callassist/contracts";

export const operationalAlertPolicyVersion = "2026-08-22" as const;

type AlertInput = Pick<
  AdminSystemStatus,
  "runtime" | "workload" | "jobs" | "webhooks" | "recentTelemetry"
>;
type OperationalAlert = AdminSystemStatus["alerts"]["active"][number];

export function evaluateOperationalAlerts(
  status: AlertInput,
  now: Date
): AdminSystemStatus["alerts"] {
  const active: OperationalAlert[] = [];
  const push = (alert: OperationalAlert) => active.push(alert);

  if (
    status.runtime.durableWorkerMode === "external" &&
    status.runtime.externalWorker.state !== "healthy"
  ) {
    push({
      code: "external_worker_unavailable",
      severity: "critical",
      observed: 1,
      threshold: 1,
      unit: "count",
      runbook: "worker-unavailable"
    });
  }

  if (status.jobs.deadLetter > 0) {
    push({
      code: "durable_jobs_dead_letter",
      severity: "critical",
      observed: status.jobs.deadLetter,
      threshold: 1,
      unit: "count",
      runbook: "durable-job-failure"
    });
  }

  const oldestDueAgeSeconds = status.jobs.oldestDueAt
    ? Math.max(0, Math.floor(
        (now.getTime() - Date.parse(status.jobs.oldestDueAt)) / 1_000
      ))
    : 0;
  if (status.jobs.queued > 0 && oldestDueAgeSeconds >= 300) {
    push({
      code: "durable_job_backlog",
      severity: oldestDueAgeSeconds >= 900 ? "critical" : "warning",
      observed: oldestDueAgeSeconds,
      threshold: oldestDueAgeSeconds >= 900 ? 900 : 300,
      unit: "seconds",
      runbook: "durable-job-backlog"
    });
  }

  if (status.workload.retentionOverdue > 0) {
    push({
      code: "retention_overdue",
      severity: "critical",
      observed: status.workload.retentionOverdue,
      threshold: 1,
      unit: "count",
      runbook: "retention-overdue"
    });
  }

  const webhookFailures = status.webhooks.voice.failed +
    status.webhooks.callStatus.failed +
    status.webhooks.recordingStatus.failed;
  if (webhookFailures > 0) {
    push({
      code: "webhook_processing_failures",
      severity: "warning",
      observed: webhookFailures,
      threshold: 1,
      unit: "count",
      runbook: "webhook-processing-failure"
    });
  }

  if (status.recentTelemetry.errors > 0) {
    push({
      code: "recent_technical_errors",
      severity: "warning",
      observed: status.recentTelemetry.errors,
      threshold: 1,
      unit: "count",
      runbook: "application-errors"
    });
  }

  return { policyVersion: operationalAlertPolicyVersion, active };
}
