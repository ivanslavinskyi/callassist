import { randomUUID } from "node:crypto";
import type { CallRepository } from "../storage/call-repository";
import { writePiiSafeOperationalError } from "../runtime/pii-safe-logger";
import {
  DurableJobExecutionError,
  durableJobErrorCode,
  durableJobErrorIsRetryable,
  durableJobRetryDelayMs,
  type DurableJob,
  type DurableJobLease,
  type DurableJobType
} from "./durable-job";

type DurableJobHandler = (
  job: DurableJob,
  lease: DurableJobLease
) => Promise<void>;

type WorkerLane = { types: DurableJobType[]; drain: Promise<void> | null; wakeRequested: boolean };

type DurableJobWorkerOptions = {
  workerId?: string;
  pollIntervalMs?: number;
  leaseDurationMs?: number;
  now?: () => Date;
  enabled?: boolean;
  keepAlive?: boolean;
  reportRuntimeHeartbeat?: boolean;
  runtimeHeartbeatIntervalMs?: number;
  /** One serial consumer per lane. Every configured job type belongs to one lane. */
  lanes?: DurableJobType[][];
};

export class DurableJobWorker {
  readonly #workerId: string;
  readonly #pollIntervalMs: number;
  readonly #leaseDurationMs: number;
  readonly #now: () => Date;
  readonly #types: DurableJobType[];
  readonly #lanes: WorkerLane[];
  readonly #configured: boolean;
  readonly #keepAlive: boolean;
  readonly #reportRuntimeHeartbeat: boolean;
  readonly #runtimeHeartbeatIntervalMs: number;
  readonly #startedAt: string;
  #timer: NodeJS.Timeout | null = null;
  #runtimeHeartbeatTimer: NodeJS.Timeout | null = null;
  #runtimeHeartbeatWrite: Promise<void> | null = null;
  #runtimeHeartbeatDirty = false;
  #activeJobs = 0;
  #assessmentSweep: Promise<void> | null = null;
  #closed = false;

  constructor(
    readonly repository: CallRepository,
    readonly handlers: Partial<Record<DurableJobType, DurableJobHandler>>,
    readonly onError: (error: unknown) => void = error =>
      writePiiSafeOperationalError("durable_worker_operation_failed", error),
    options: DurableJobWorkerOptions = {}
  ) {
    this.#workerId = options.workerId ?? `api-${randomUUID()}`;
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.#leaseDurationMs = options.leaseDurationMs ?? 120_000;
    this.#now = options.now ?? (() => new Date());
    this.#types = Object.keys(handlers) as DurableJobType[];
    const lanes = options.lanes
      ? options.lanes.map(lane => lane.filter(type => this.#types.includes(type))).filter(lane => lane.length)
      : [this.#types];
    const scheduledTypes = lanes.flat();
    if (new Set(scheduledTypes).size !== scheduledTypes.length || this.#types.some(type => !scheduledTypes.includes(type))) {
      throw new Error("Durable worker lanes must include every handled type exactly once");
    }
    this.#lanes = lanes.map(types => ({ types, drain: null, wakeRequested: false }));
    this.#configured = options.enabled ?? true;
    this.#keepAlive = options.keepAlive ?? false;
    this.#reportRuntimeHeartbeat = options.reportRuntimeHeartbeat ?? false;
    this.#runtimeHeartbeatIntervalMs =
      options.runtimeHeartbeatIntervalMs ?? 5_000;
    this.#startedAt = this.#now().toISOString();
  }

  get runningCount() {
    return this.#activeJobs;
  }

  get enabled() {
    return this.#timer !== null;
  }

  start() {
    if (
      !this.#configured ||
      this.#closed ||
      this.#timer ||
      this.#types.length === 0
    ) return;
    this.#timer = setInterval(() => {
      // A slow transcription/model request must not hold an expired credit reservation.
      if (!this.#assessmentSweep) {
        this.#assessmentSweep = this.repository.expireCallAssessments(this.#now().toISOString())
          .catch(this.onError).finally(() => { this.#assessmentSweep = null; });
      }
      this.wake();
    }, this.#pollIntervalMs);
    if (!this.#keepAlive) this.#timer.unref();
    if (this.#reportRuntimeHeartbeat) {
      this.#runtimeHeartbeatTimer = setInterval(
        () => this.#writeRuntimeHeartbeat(),
        this.#runtimeHeartbeatIntervalMs
      );
      if (!this.#keepAlive) this.#runtimeHeartbeatTimer.unref();
    }
    this.wake();
    this.#writeRuntimeHeartbeat();
  }

  wake() {
    if (!this.#configured || this.#closed) return;
    for (const lane of this.#lanes) void this.#wakeLane(lane).catch(this.onError);
  }

  async runOnce() {
    if (!this.#configured || this.#closed) return;
    await Promise.all(this.#lanes.map(lane => this.#wakeLane(lane)));
  }

  async close() {
    this.#closed = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    if (this.#runtimeHeartbeatTimer) {
      clearInterval(this.#runtimeHeartbeatTimer);
    }
    this.#runtimeHeartbeatTimer = null;
    await Promise.allSettled(this.#lanes.map(lane => lane.drain));
    await this.#assessmentSweep;
    await this.#runtimeHeartbeatWrite;
    if (this.#reportRuntimeHeartbeat) {
      await this.repository.stopDurableWorkerHeartbeat(
        this.#workerId,
        this.#now().toISOString()
      ).catch(this.onError);
    }
  }

  #writeRuntimeHeartbeat() {
    if (!this.#reportRuntimeHeartbeat || this.#closed) return;
    if (this.#runtimeHeartbeatWrite) {
      this.#runtimeHeartbeatDirty = true;
      return;
    }
    this.#runtimeHeartbeatWrite = this.repository.reportDurableWorkerHeartbeat({
      workerId: this.#workerId,
      startedAt: this.#startedAt,
      seenAt: this.#now().toISOString(),
      activeJobs: this.#activeJobs
    }).catch(this.onError).finally(() => {
      this.#runtimeHeartbeatWrite = null;
      if (this.#runtimeHeartbeatDirty) {
        this.#runtimeHeartbeatDirty = false;
        this.#writeRuntimeHeartbeat();
      }
    });
  }

  #wakeLane(lane: WorkerLane): Promise<void> {
    lane.wakeRequested = true;
    if (lane.drain) return lane.drain;
    lane.drain = (async () => {
      do {
        lane.wakeRequested = false;
        await this.#drainLane(lane.types);
      } while (lane.wakeRequested && !this.#closed);
    })().finally(() => {
      lane.drain = null;
      // A wake can arrive between the final empty claim and this continuation.
      if (lane.wakeRequested && !this.#closed) void this.#wakeLane(lane).catch(this.onError);
      this.#writeRuntimeHeartbeat();
    });
    return lane.drain;
  }

  async #drainLane(types: DurableJobType[]) {
    while (!this.#closed) {
      const now = this.#now();
      const job = await this.repository.claimDueDurableJob({
        types,
        workerId: this.#workerId,
        now: now.toISOString(),
        leaseExpiresAt: new Date(
          now.getTime() + this.#leaseDurationMs
        ).toISOString()
      });
      if (!job) return;
      await this.#execute(job);
    }
  }

  async #execute(job: DurableJob) {
    const handler = this.handlers[job.type];
    if (!handler) return;
    this.#activeJobs += 1;
    this.#writeRuntimeHeartbeat();
    const heartbeat = setInterval(() => {
      const now = this.#now();
      void this.repository.renewDurableJobLease(
        job.id,
        this.#workerId,
        now.toISOString(),
        new Date(now.getTime() + this.#leaseDurationMs).toISOString()
      ).catch(this.onError);
    }, Math.max(1_000, Math.floor(this.#leaseDurationMs / 3)));
    heartbeat.unref();

    try {
      await handler(job, {
        jobId: job.id,
        workerId: this.#workerId,
        checkedAt: this.#now().toISOString()
      });
      const completed = await this.repository.completeDurableJob(
        job.id,
        this.#workerId,
        this.#now().toISOString()
      );
      if (!completed) {
        this.onError(new Error("DURABLE_JOB_LEASE_LOST"));
      }
    } catch (error) {
      const now = this.#now();
      const failed = await this.repository.failDurableJob(
        job.id,
        this.#workerId,
        durableJobErrorCode(error),
        now.toISOString(),
        new Date(
          now.getTime() + Math.max(durableJobRetryDelayMs(job.attemptCount), error instanceof DurableJobExecutionError ? error.retryAfterMs : 0)
        ).toISOString(),
        durableJobErrorIsRetryable(error),
        error instanceof DurableJobExecutionError && error.defer
      );
      if (failed && failed.status !== "cancelled") this.onError(error);
    } finally {
      clearInterval(heartbeat);
      this.#activeJobs -= 1;
      this.#writeRuntimeHeartbeat();
    }
  }
}
