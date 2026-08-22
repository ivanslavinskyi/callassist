import type { AdminSystemStatus } from "@callassist/contracts";
import { describe, expect, it } from "vitest";
import { evaluateOperationalAlerts } from "./operational-alerts";

function alertInput(): Pick<
  AdminSystemStatus,
  "runtime" | "workload" | "jobs" | "webhooks" | "recentTelemetry"
> {
  return {
    runtime: {
      uptimeSeconds: 120,
      backgroundTasks: 0,
      processingRecordings: 0,
      durableWorkerEnabled: false,
      durableWorkerMode: "external",
      externalWorker: {
        state: "healthy",
        healthyInstances: 1,
        staleInstances: 0,
        activeJobs: 0,
        lastSeenAt: "2026-08-22T11:59:59.000Z",
        lastSeenAgeSeconds: 1
      }
    },
    workload: {
      activeCalls: 0,
      recordingsProcessing: 0,
      transcriptionReady: 0,
      transcriptionProcessing: 0,
      transcriptionFailed: 0,
      retentionScheduled: 0,
      retentionOverdue: 0
    },
    jobs: {
      queued: 0,
      running: 0,
      succeeded: 0,
      deadLetter: 0,
      retryQueued: 0,
      transcriptionQueued: 0,
      retentionQueued: 0,
      providerReconciliationQueued: 0,
      oldestDueAt: null,
      recent: []
    },
    webhooks: {
      since: "2026-08-21T12:00:00.000Z",
      retentionDays: 30,
      voice: emptyWebhook(),
      callStatus: emptyWebhook(),
      recordingStatus: emptyWebhook()
    },
    recentTelemetry: {
      since: "2026-08-21T12:00:00.000Z",
      warnings: 0,
      errors: 0
    }
  };
}

function emptyWebhook() {
  return {
    accepted: 0,
    rejected: 0,
    unmatched: 0,
    failed: 0,
    lastAcceptedAt: null,
    lastAcceptedAgeSeconds: null,
    lastProblemAt: null,
    lastProblemCode: null
  };
}

describe("operational alert policy", () => {
  const now = new Date("2026-08-22T12:00:00.000Z");

  it("has no active alerts for a healthy snapshot", () => {
    expect(evaluateOperationalAlerts(alertInput(), now)).toEqual({
      policyVersion: "2026-08-22",
      active: []
    });
  });

  it("raises deterministic critical worker, dead-letter and retention alerts", () => {
    const input = alertInput();
    input.runtime.externalWorker.state = "offline";
    input.jobs.deadLetter = 2;
    input.workload.retentionOverdue = 1;

    expect(evaluateOperationalAlerts(input, now).active).toMatchObject([
      { code: "external_worker_unavailable", severity: "critical" },
      { code: "durable_jobs_dead_letter", observed: 2, severity: "critical" },
      { code: "retention_overdue", observed: 1, severity: "critical" }
    ]);
  });

  it("escalates an overdue queue from warning to critical", () => {
    const warning = alertInput();
    warning.jobs.queued = 1;
    warning.jobs.oldestDueAt = "2026-08-22T11:54:59.000Z";
    expect(evaluateOperationalAlerts(warning, now).active[0]).toMatchObject({
      code: "durable_job_backlog",
      severity: "warning",
      observed: 301,
      threshold: 300
    });

    warning.jobs.oldestDueAt = "2026-08-22T11:44:59.000Z";
    expect(evaluateOperationalAlerts(warning, now).active[0]).toMatchObject({
      severity: "critical",
      observed: 901,
      threshold: 900
    });
  });
});
