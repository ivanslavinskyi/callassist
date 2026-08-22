import { randomUUID } from "node:crypto";
import type { CallRepository } from "../storage/call-repository";
import {
  durableJobErrorCode,
  durableJobRetryDelayMs,
  type DurableJob,
  type DurableJobLease,
  type DurableJobType
} from "./durable-job";

type DurableJobHandler = (
  job: DurableJob,
  lease: DurableJobLease
) => Promise<void>;

type DurableJobWorkerOptions = {
  workerId?: string;
  pollIntervalMs?: number;
  leaseDurationMs?: number;
  now?: () => Date;
  enabled?: boolean;
  keepAlive?: boolean;
  reportRuntimeHeartbeat?: boolean;
  runtimeHeartbeatIntervalMs?: number;
};

export class DurableJobWorker {
  readonly #workerId: string;
  readonly #pollIntervalMs: number;
  readonly #leaseDurationMs: number;
  readonly #now: () => Date;
  readonly #types: DurableJobType[];
  readonly #configured: boolean;
  readonly #keepAlive: boolean;
  readonly #reportRuntimeHeartbeat: boolean;
  readonly #runtimeHeartbeatIntervalMs: number;
  readonly #startedAt: string;
  #timer: NodeJS.Timeout | null = null;
  #runtimeHeartbeatTimer: NodeJS.Timeout | null = null;
  #runtimeHeartbeatWrite: Promise<void> | null = null;
  #runtimeHeartbeatDirty = false;
  #drain: Promise<void> | null = null;
  #activeJobs = 0;
  #closed = false;

  constructor(
    readonly repository: CallRepository,
    readonly handlers: Partial<Record<DurableJobType, DurableJobHandler>>,
    readonly onError: (error: unknown) => void = console.error,
    options: DurableJobWorkerOptions = {}
  ) {
    this.#workerId = options.workerId ?? `api-${randomUUID()}`;
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.#leaseDurationMs = options.leaseDurationMs ?? 120_000;
    this.#now = options.now ?? (() => new Date());
    this.#types = Object.keys(handlers) as DurableJobType[];
    this.#configured = options.enabled ?? true;
    this.#keepAlive = options.keepAlive ?? false;
    this.#reportRuntimeHeartbeat = options.reportRuntimeHeartbeat ?? false;
    this.#runtimeHeartbeatIntervalMs =
      options.runtimeHeartbeatIntervalMs ?? 5_000;
    this.#startedAt = this.#now().toISOString();
  }

  get runningCount() {
    return this.#drain ? 1 : 0;
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
    this.#timer = setInterval(() => this.wake(), this.#pollIntervalMs);
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
    if (
      !this.#configured ||
      this.#closed ||
      this.#types.length === 0 ||
      this.#drain
    ) return;
    this.#drain = this.#drainDueJobs()
      .catch(this.onError)
      .finally(() => {
        this.#drain = null;
        this.#writeRuntimeHeartbeat();
      });
    this.#writeRuntimeHeartbeat();
  }

  async runOnce() {
    if (!this.#configured || this.#closed) return;
    if (this.#drain) return this.#drain;
    this.#drain = this.#drainDueJobs()
      .finally(() => {
        this.#drain = null;
        this.#writeRuntimeHeartbeat();
      });
    return this.#drain;
  }

  async close() {
    this.#closed = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    if (this.#runtimeHeartbeatTimer) {
      clearInterval(this.#runtimeHeartbeatTimer);
    }
    this.#runtimeHeartbeatTimer = null;
    await this.#drain;
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

  async #drainDueJobs() {
    while (!this.#closed) {
      const now = this.#now();
      const job = await this.repository.claimDueDurableJob({
        types: this.#types,
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
    this.#activeJobs = 1;
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
          now.getTime() + durableJobRetryDelayMs(job.attemptCount)
        ).toISOString()
      );
      if (failed) this.onError(error);
    } finally {
      clearInterval(heartbeat);
      this.#activeJobs = 0;
      this.#writeRuntimeHeartbeat();
    }
  }
}
