import { monitorEventLoopDelay } from "node:perf_hooks";
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

export type DurableJobWorkerOptions = {
  role?: "all" | "preparation" | "review" | "operations" | "background";
  workClasses?: import("./durable-job").DurableWorkClass[];
  laneConcurrency?: Partial<Record<DurableJobType, number>>;
  useDatabaseTime?: boolean;
  drainTimeoutMs?: number;
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
  readonly #eventLoop = monitorEventLoopDelay({ resolution: 20 });
  readonly #options: DurableJobWorkerOptions;
  readonly #controllers = new Set<AbortController>();
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
  #heartbeatStopped = false;

  constructor(
    readonly repository: CallRepository,
    readonly handlers: Partial<Record<DurableJobType, DurableJobHandler>>,
    readonly onError: (error: unknown) => void = error =>
      writePiiSafeOperationalError("durable_worker_operation_failed", error),
    options: DurableJobWorkerOptions = {}
  ) {
    this.#options = options;
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
    this.#lanes = lanes.flatMap(types => {
      const slots = Math.max(...types.map(type => options.laneConcurrency?.[type] ?? 1));
      if (!Number.isInteger(slots) || slots < 1 || slots > 64) throw new Error("Worker slots must be between 1 and 64");
      return Array.from({ length: slots }, () => ({ types, drain: null, wakeRequested: false }));
    });
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
    this.#eventLoop.enable();
    this.#timer = setInterval(() => {
      // A slow transcription/model request must not hold an expired credit reservation.
      if ((!this.#options.role || ["all","operations"].includes(this.#options.role)) && !this.#assessmentSweep) {
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
    this.#eventLoop.disable();
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#writeRuntimeHeartbeat();
    const abortTimer = setTimeout(() => {
      for (const controller of this.#controllers) controller.abort(new Error("DURABLE_WORKER_DRAIN_TIMEOUT"));
    }, this.#options.drainTimeoutMs ?? 30_000);
    let hardTimer: NodeJS.Timeout | undefined;
    try { await Promise.race([Promise.allSettled(this.#lanes.map(lane => lane.drain)), new Promise<never>((_,reject) => {
      hardTimer=setTimeout(() => reject(new Error("DURABLE_WORKER_DRAIN_TIMEOUT")),(this.#options.drainTimeoutMs ?? 30000)+5000);
    })]); }
    finally {
      clearTimeout(abortTimer); clearTimeout(hardTimer); this.#heartbeatStopped=true;
      if (this.#runtimeHeartbeatTimer) clearInterval(this.#runtimeHeartbeatTimer);
      this.#runtimeHeartbeatTimer=null;
    }
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
    if (!this.#reportRuntimeHeartbeat || this.#heartbeatStopped) return;
    if (this.#runtimeHeartbeatWrite) {
      this.#runtimeHeartbeatDirty = true;
      return;
    }
    this.#runtimeHeartbeatWrite = this.repository.reportDurableWorkerHeartbeat({
      workerId: this.#workerId,
      startedAt: this.#startedAt,
      seenAt: this.#now().toISOString(),
      role: this.#options.role ?? "all",
      metrics: { draining: this.#closed, rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed,
        eventLoopP99Ms: Math.round(this.#eventLoop.percentile(99)/1e6), cpuUserMs: Math.round(process.cpuUsage().user/1000),
        cpuSystemMs: Math.round(process.cpuUsage().system/1000), slots: this.#lanes.length },
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
        workClasses: this.#options.workClasses, useDatabaseTime: this.#options.useDatabaseTime,
        workerId: `${this.#workerId}:${randomUUID()}`,
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
    const controller = new AbortController();
    this.#controllers.add(controller);
    const fence: DurableJobLease = { jobId: job.id, workerId: job.leaseOwner!, checkedAt: this.#now().toISOString(),
      generation: job.generation, attemptNumber: job.attemptCount, signal: controller.signal, useDatabaseTime: this.#options.useDatabaseTime };
    let renewing = false;
    const heartbeat = setInterval(() => {
      if (renewing || controller.signal.aborted) return;
      renewing = true;
      const now = this.#now();
      void this.repository.renewDurableJobLease(
        job.id,
        job.leaseOwner!,
        now.toISOString(),
        new Date(now.getTime() + this.#leaseDurationMs).toISOString(), fence
      ).then(renewed => { if (!renewed) controller.abort(new Error("DURABLE_JOB_LEASE_LOST")); })
        .catch(error => { controller.abort(new Error("DURABLE_JOB_LEASE_UNCERTAIN")); this.onError(error); })
        .finally(() => { renewing = false; });
    }, Math.max(1_000, Math.floor(this.#leaseDurationMs / 3)));
    heartbeat.unref();

    try {
      await handler(job, fence);
      controller.signal.throwIfAborted();
      const completed = await this.repository.completeDurableJob(
        job.id,
        job.leaseOwner!,
        this.#now().toISOString(), fence
      );
      if (!completed) {
        this.onError(new Error("DURABLE_JOB_LEASE_LOST"));
      }
    } catch (error) {
      const now = this.#now();
      const failed = await this.repository.failDurableJob(
        job.id,
        job.leaseOwner!,
        durableJobErrorCode(error),
        now.toISOString(),
        new Date(
          now.getTime() + Math.max(durableJobRetryDelayMs(job.attemptCount), error instanceof DurableJobExecutionError ? error.retryAfterMs : 0)
        ).toISOString(),
        durableJobErrorIsRetryable(error),
        error instanceof DurableJobExecutionError && error.defer, fence
      );
      if (failed && failed.status !== "cancelled") this.onError(error);
    } finally {
      clearInterval(heartbeat);
      this.#controllers.delete(controller);
      this.#activeJobs -= 1;
      this.#writeRuntimeHeartbeat();
    }
  }
}
