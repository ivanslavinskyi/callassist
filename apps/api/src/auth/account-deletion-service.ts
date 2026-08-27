import {
  CALL_DATA_DELETION_CONFIRMATION,
  type AccountDeletionRequest
} from "@callassist/contracts";
import { randomUUID } from "node:crypto";
import { CallService, CallServiceError } from "../call-service";
import { writePiiSafeOperationalError } from "../runtime/pii-safe-logger";
import {
  AuthRepositoryError,
  type AccountDeletionRequestRecord,
  type AuthRepository
} from "./auth-repository";

const terminalCallStatuses = new Set([
  "blocked",
  "completed",
  "stopped",
  "failed"
]);
const activeCallStatuses = new Set([
  "dialing",
  "in_progress",
  "awaiting_approval"
]);

export type AccountDeletionServiceOptions = {
  authRepository: AuthRepository;
  callService: CallService;
  workerId?: string;
  workerEnabled?: boolean;
  keepAlive?: boolean;
  pollIntervalMs?: number;
  leaseDurationMs?: number;
  activeCallDelayMs?: number;
  now?: () => Date;
  onError?: (error: unknown) => void;
};

export class AccountDeletionService {
  readonly #authRepository: AuthRepository;
  readonly #callService: CallService;
  readonly #workerId: string;
  readonly #workerEnabled: boolean;
  readonly #keepAlive: boolean;
  readonly #pollIntervalMs: number;
  readonly #leaseDurationMs: number;
  readonly #activeCallDelayMs: number;
  readonly #now: () => Date;
  readonly #onError: (error: unknown) => void;
  #timer: NodeJS.Timeout | null = null;
  #drain: Promise<void> | null = null;
  #closed = false;

  constructor(options: AccountDeletionServiceOptions) {
    this.#authRepository = options.authRepository;
    this.#callService = options.callService;
    this.#workerId = options.workerId ?? `account-delete-${randomUUID()}`;
    this.#workerEnabled = options.workerEnabled ?? false;
    this.#keepAlive = options.keepAlive ?? false;
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.#leaseDurationMs = options.leaseDurationMs ?? 120_000;
    this.#activeCallDelayMs = options.activeCallDelayMs ?? 30_000;
    this.#now = options.now ?? (() => new Date());
    this.#onError = options.onError ?? (() =>
      writePiiSafeOperationalError("account_deletion_worker_failed"));
  }

  start() {
    if (!this.#workerEnabled || this.#closed || this.#timer) return;
    this.#timer = setInterval(() => this.wake(), this.#pollIntervalMs);
    if (!this.#keepAlive) this.#timer.unref();
    this.wake();
  }

  wake() {
    if (!this.#workerEnabled || this.#closed || this.#drain) return;
    this.#drain = this.#drainDueRequests()
      .catch(this.#onError)
      .finally(() => { this.#drain = null; });
  }

  async runOnce() {
    if (this.#closed) return;
    if (this.#drain) return this.#drain;
    this.#drain = this.#drainDueRequests()
      .finally(() => { this.#drain = null; });
    return this.#drain;
  }

  async close() {
    this.#closed = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#drain;
  }

  async request(userId: string, requestId: string) {
    const request = await this.#authRepository.requestAccountDeletion({
      requestId,
      userId,
      now: this.#now().toISOString(),
      maxAttempts: 5
    });
    this.wake();
    return toPublicAccountDeletion(request);
  }

  async getForUser(userId: string) {
    const request = await this.#authRepository.findAccountDeletionByUser(userId);
    return request ? toPublicAccountDeletion(request) : null;
  }

  async assertAccountAvailable(userId: string) {
    const request = await this.#authRepository.findAccountDeletionByUser(userId);
    if (request && request.status !== "completed") {
      throw new AccountDeletionServiceError("ACCOUNT_DELETION_PENDING");
    }
  }

  async retryAsAdmin(input: {
    requestId: string;
    actorUserId: string;
    targetUserId: string;
    reason: string;
  }) {
    await this.#authRepository.retryAccountDeletion({
      ...input,
      now: this.#now().toISOString()
    });
    this.wake();
  }

  async #drainDueRequests() {
    while (!this.#closed) {
      const now = this.#now();
      const request = await this.#authRepository.claimAccountDeletion({
        workerId: this.#workerId,
        now: now.toISOString(),
        leaseExpiresAt: new Date(now.getTime() + this.#leaseDurationMs).toISOString()
      });
      if (!request) return;
      await this.#execute(request);
    }
  }

  async #execute(request: AccountDeletionRequestRecord) {
    const heartbeat = setInterval(() => {
      const now = this.#now();
      void this.#authRepository.renewAccountDeletionLease({
        requestId: request.requestId,
        workerId: this.#workerId,
        now: now.toISOString(),
        leaseExpiresAt: new Date(now.getTime() + this.#leaseDurationMs).toISOString()
      }).catch(this.#onError);
    }, Math.max(1_000, Math.floor(this.#leaseDurationMs / 3)));
    heartbeat.unref();
    try {
      await this.#callService.repository.cancelCallPreparations(
        request.userId,
        this.#now().toISOString()
      );
      while (true) {
        const calls = await this.#callService.repository.list({
          userId: request.userId,
          limit: 100
        });
        if (calls.items.some(({ status }) => activeCallStatuses.has(status))) {
          const now = this.#now();
          await this.#authRepository.deferAccountDeletionForActiveCall({
            requestId: request.requestId,
            workerId: this.#workerId,
            now: now.toISOString(),
            retryAt: new Date(now.getTime() + this.#activeCallDelayMs).toISOString()
          });
          return;
        }
        if (calls.items.length === 0) break;
        for (const call of calls.items) {
          if (!terminalCallStatuses.has(call.status)) {
            await this.#callService.stop(call.id);
          }
          await this.#callService.deleteCallData(call.id, request.userId, {
            requestId: randomUUID(),
            password: "worker-confirmed-at-request-time",
            confirmation: CALL_DATA_DELETION_CONFIRMATION
          });
        }
      }
      const completed = await this.#authRepository.completeAccountDeletion({
        requestId: request.requestId,
        workerId: this.#workerId,
        now: this.#now().toISOString()
      });
      if (!completed) throw new AccountDeletionServiceError("ACCOUNT_DELETION_LEASE_LOST");
    } catch (error) {
      const now = this.#now();
      const failed = await this.#authRepository.failAccountDeletion({
        requestId: request.requestId,
        workerId: this.#workerId,
        now: now.toISOString(),
        retryAt: new Date(
          now.getTime() + accountDeletionRetryDelayMs(request.attemptCount)
        ).toISOString(),
        errorCode: accountDeletionErrorCode(error)
      });
      if (failed) this.#onError(error);
    } finally {
      clearInterval(heartbeat);
    }
  }
}

export class AccountDeletionServiceError extends Error {
  constructor(
    readonly code:
      | "ACCOUNT_DELETION_PENDING"
      | "ACCOUNT_DELETION_LEASE_LOST",
    options?: { cause?: unknown }
  ) {
    super(code, options);
    this.name = "AccountDeletionServiceError";
  }
}

export function toPublicAccountDeletion(
  request: AccountDeletionRequestRecord
): AccountDeletionRequest {
  return {
    requestId: request.requestId,
    status: request.status,
    attemptCount: request.attemptCount,
    maxAttempts: request.maxAttempts,
    requestedAt: request.requestedAt,
    updatedAt: request.updatedAt,
    nextAttemptAt: request.nextAttemptAt,
    completedAt: request.completedAt,
    lastErrorCode: request.lastErrorCode
  };
}

function accountDeletionRetryDelayMs(attemptNumber: number) {
  const safeAttempt = Math.max(1, Math.floor(attemptNumber));
  return Math.min(15 * 60_000, 5_000 * 2 ** (safeAttempt - 1));
}

function accountDeletionErrorCode(error: unknown) {
  if (
    error instanceof CallServiceError &&
    error.code === "CALL_DATA_DELETION_PROVIDER_FAILED"
  ) return "PROVIDER_RECORDING_DELETE_FAILED";
  if (
    error instanceof AuthRepositoryError &&
    error.code === "ACCOUNT_DELETION_CALLS_REMAIN"
  ) return "CALLS_REMAIN_AFTER_REDACTION";
  if (error instanceof AccountDeletionServiceError) return error.code;
  return "ACCOUNT_DELETION_EXECUTION_FAILED";
}
