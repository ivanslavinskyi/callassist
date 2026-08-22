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
};

export class DurableJobWorker {
  readonly #workerId: string;
  readonly #pollIntervalMs: number;
  readonly #leaseDurationMs: number;
  readonly #now: () => Date;
  readonly #types: DurableJobType[];
  readonly #configured: boolean;
  readonly #keepAlive: boolean;
  #timer: NodeJS.Timeout | null = null;
  #drain: Promise<void> | null = null;
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
    this.wake();
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
      .finally(() => { this.#drain = null; });
  }

  async runOnce() {
    if (!this.#configured || this.#closed) return;
    if (this.#drain) return this.#drain;
    this.#drain = this.#drainDueJobs()
      .finally(() => { this.#drain = null; });
    return this.#drain;
  }

  async close() {
    this.#closed = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#drain;
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
    }
  }
}
