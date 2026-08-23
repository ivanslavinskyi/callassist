import { randomUUID } from "node:crypto";
import type {
  AccountAdminInput,
  AccountDeletionLeaseInput,
  AccountDeletionRequestRecord,
  AccountDataExportEventInput,
  AuthRepository,
  AuthSessionRecord,
  AuthUserRecord,
  ChangeAccountStatusInput,
  ClaimAccountDeletionInput,
  CreateAuthSessionInput,
  CreateAuthUserInput,
  FailAccountDeletionInput,
  ListAdminUsersInput
} from "./auth-repository";
import {
  AuthRepositoryError,
  encodeAdminUserCursor
} from "./auth-repository";

type AccountAdminEvent = {
  eventType:
    | "account.suspended"
    | "account.unsuspended"
    | "account.sessions_revoked";
  actorUserId: string;
  targetUserId: string;
  previousStatus: "active" | "suspended" | null;
  newStatus: "active" | "suspended" | null;
  reason: string;
  createdAt: string;
};

type AccountSessionEvent = {
  eventType: "session.revoked" | "session.all_revoked";
  actorUserId: string;
  targetSessionId: string | null;
  revokedSessionCount: number;
  createdAt: string;
};

type AccountDataExportEvent = AccountDataExportEventInput;

type AccountDeletionEvent = {
  eventType:
    | "account_deletion.requested"
    | "account_deletion.active_call_delayed"
    | "account_deletion.retry_requested"
    | "account_deletion.completed";
  requestId: string;
  actorUserId: string;
  reason: string | null;
  createdAt: string;
};

type PasswordRecoveryChallenge = {
  id: string;
  userId: string;
  attemptCount: number;
  expiresAt: string;
  verifiedAt: string | null;
  invalidatedAt: string | null;
  lastAttemptAt: string | null;
  createdAt: string;
};

type PasswordRecoveryGrant = {
  id: string;
  recoveryId: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
};

type PasswordRecoveryEvent = {
  userId: string;
  recoveryId: string;
  revokedSessionCount: number;
  createdAt: string;
};

export class InMemoryAuthRepository implements AuthRepository {
  readonly mode = "memory" as const;
  readonly #users = new Map<string, AuthUserRecord>();
  readonly #sessions = new Map<string, AuthSessionRecord>();
  readonly #accountAdminEvents: AccountAdminEvent[] = [];
  readonly #accountSessionEvents: AccountSessionEvent[] = [];
  readonly #accountDataExportEvents: AccountDataExportEvent[] = [];
  readonly #accountDeletions = new Map<string, AccountDeletionRequestRecord>();
  readonly #accountDeletionEvents: AccountDeletionEvent[] = [];
  readonly #passwordRecoveryChallenges = new Map<string, PasswordRecoveryChallenge>();
  readonly #passwordRecoveryGrants = new Map<string, PasswordRecoveryGrant>();
  readonly #passwordRecoveryEvents: PasswordRecoveryEvent[] = [];

  async createUser(input: CreateAuthUserInput) {
    const email = input.email.toLowerCase();
    if (
      [...this.#users.values()].some(
        (user) => user.email === email || user.phoneE164 === input.phoneE164
      )
    ) {
      throw new AuthRepositoryError("USER_ALREADY_EXISTS");
    }
    const now = new Date().toISOString();
    const user: AuthUserRecord = {
      id: randomUUID(),
      email,
      passwordHash: input.passwordHash,
      phoneE164: input.phoneE164,
      phoneVerifiedAt: null,
      firstName: input.firstName,
      lastName: input.lastName,
      role: "user",
      status: "active",
      uiLocale: input.uiLocale,
      createdAt: now,
      lastLoginAt: null
    };
    this.#users.set(user.id, user);
    return structuredClone(user);
  }

  async findUserByEmail(email: string) {
    const user = [...this.#users.values()].find(
      (candidate) => candidate.email === email.toLowerCase()
    );
    return user ? structuredClone(user) : null;
  }

  async listUsersForAdmin(input: ListAdminUsersInput) {
    const actor = this.#requireAdmin(input.actorUserId);
    const search = input.search?.toLowerCase();
    const filtered = [...this.#users.values()]
      .filter((user) => actor.role === "superadmin" || user.role === "user")
      .filter((user) => !input.role || user.role === input.role)
      .filter((user) => !input.status || user.status === input.status)
      .filter((user) => !search || [
        user.email,
        user.firstName,
        user.lastName,
        `${user.firstName} ${user.lastName}`
      ].some((value) => value.toLowerCase().includes(search)))
      .filter((user) =>
        !input.cursor ||
        user.createdAt < input.cursor.createdAt ||
        (user.createdAt === input.cursor.createdAt && user.id < input.cursor.id)
      )
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id)
      );
    const items = filtered.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items: items.map(toAdminUserSummary),
      nextCursor: filtered.length > input.limit && last
        ? encodeAdminUserCursor({ createdAt: last.createdAt, id: last.id })
        : null
    };
  }

  async findUserByIdForAdmin(actorUserId: string, targetUserId: string) {
    const actor = this.#requireAdmin(actorUserId);
    const target = this.#users.get(targetUserId);
    if (!target || (actor.role !== "superadmin" && target.role !== "user")) {
      throw new AuthRepositoryError("USER_NOT_FOUND");
    }
    return toAdminUserSummary(target);
  }

  async markPhoneVerified(userId: string, verifiedAt: string) {
    const user = this.#requireUser(userId);
    user.phoneVerifiedAt ??= verifiedAt;
    return structuredClone(user);
  }

  async createSession(input: CreateAuthSessionInput) {
    const user = this.#users.get(input.userId);
    if (
      !user ||
      user.status !== "active" ||
      !user.phoneVerifiedAt ||
      (input.expectedPasswordHash !== undefined &&
        input.expectedPasswordHash !== user.passwordHash)
    ) {
      throw new AuthRepositoryError("SESSION_CREATION_DENIED");
    }
    const { expectedPasswordHash: _expectedPasswordHash, ...session } = input;
    this.#sessions.set(input.tokenHash, structuredClone(session));
    user.lastLoginAt = input.lastSeenAt;
  }

  async findUserBySessionTokenHash(tokenHash: string, now: string) {
    const session = this.#sessions.get(tokenHash);
    if (!session || session.revokedAt || session.expiresAt <= now) return null;
    const user = this.#users.get(session.userId);
    if (user?.status !== "active" || !user.phoneVerifiedAt) return null;
    session.lastSeenAt = now;
    return { user: structuredClone(user), session: structuredClone(session) };
  }

  async listActiveSessions(
    userId: string,
    now: string,
    limit: number,
    currentSessionId: string
  ) {
    const active = [...this.#sessions.values()]
      .filter((session) =>
        session.userId === userId &&
        !session.revokedAt &&
        session.expiresAt > now
      )
      .sort((left, right) =>
        Number(right.id === currentSessionId) - Number(left.id === currentSessionId) ||
        right.lastSeenAt.localeCompare(left.lastSeenAt) ||
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id)
      );
    return {
      sessions: structuredClone(active.slice(0, limit)),
      totalActive: active.length
    };
  }

  async revokeSession(tokenHash: string, revokedAt: string) {
    const session = this.#sessions.get(tokenHash);
    if (session) session.revokedAt ??= revokedAt;
  }

  async revokeSessionById(
    userId: string,
    sessionId: string,
    revokedAt: string
  ) {
    const session = [...this.#sessions.values()].find((candidate) =>
      candidate.id === sessionId &&
      candidate.userId === userId &&
      !candidate.revokedAt &&
      candidate.expiresAt > revokedAt
    );
    if (!session) return false;
    session.revokedAt = revokedAt;
    this.#accountSessionEvents.push({
      eventType: "session.revoked",
      actorUserId: userId,
      targetSessionId: sessionId,
      revokedSessionCount: 1,
      createdAt: revokedAt
    });
    return true;
  }

  async revokeUserSessions(userId: string, revokedAt: string) {
    let revokedSessionCount = 0;
    for (const session of this.#sessions.values()) {
      if (
        session.userId === userId &&
        !session.revokedAt &&
        session.expiresAt > revokedAt
      ) {
        session.revokedAt = revokedAt;
        revokedSessionCount += 1;
      }
    }
    if (revokedSessionCount > 0) {
      this.#accountSessionEvents.push({
        eventType: "session.all_revoked",
        actorUserId: userId,
        targetSessionId: null,
        revokedSessionCount,
        createdAt: revokedAt
      });
    }
  }

  async changeAccountStatus(input: ChangeAccountStatusInput) {
    const reason = requireAdminReason(input.reason);
    const { target } = this.#authorizeAdminAction(input);
    if (target.status === input.status) {
      throw new AuthRepositoryError("ACCOUNT_STATUS_UNCHANGED");
    }
    if (target.status === "deleted") {
      throw new AuthRepositoryError("ACCOUNT_STATUS_TRANSITION_INVALID");
    }
    const previousStatus = target.status;
    const now = new Date().toISOString();
    target.status = input.status;
    if (input.status === "suspended") {
      this.#revokeSessions(input.targetUserId, now);
    }
    this.#accountAdminEvents.push({
      eventType: input.status === "suspended"
        ? "account.suspended"
        : "account.unsuspended",
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      previousStatus,
      newStatus: input.status,
      reason,
      createdAt: now
    });
    return structuredClone(target);
  }

  async revokeUserSessionsByAdmin(input: AccountAdminInput) {
    const reason = requireAdminReason(input.reason);
    this.#authorizeAdminAction(input);
    const now = new Date().toISOString();
    this.#revokeSessions(input.targetUserId, now);
    this.#accountAdminEvents.push({
      eventType: "account.sessions_revoked",
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      previousStatus: null,
      newStatus: null,
      reason,
      createdAt: now
    });
  }

  async recordAccountDataExport(input: AccountDataExportEventInput) {
    this.#requireUser(input.userId);
    this.#accountDataExportEvents.push(structuredClone(input));
  }

  async requestAccountDeletion(input: {
    requestId: string;
    userId: string;
    now: string;
    maxAttempts: number;
  }) {
    const user = this.#requireUser(input.userId);
    if (user.status !== "active" || user.role !== "user") {
      throw new AuthRepositoryError("ACCOUNT_DELETION_NOT_AVAILABLE");
    }
    const existing = this.#accountDeletions.get(input.userId);
    if (existing) return structuredClone(existing);
    const request: AccountDeletionRequestRecord = {
      requestId: input.requestId,
      userId: input.userId,
      status: "queued",
      generation: 1,
      attemptCount: 0,
      maxAttempts: input.maxAttempts,
      requestedAt: input.now,
      updatedAt: input.now,
      nextAttemptAt: input.now,
      completedAt: null,
      lastErrorCode: null,
      leaseOwner: null,
      leasedAt: null,
      leaseExpiresAt: null
    };
    this.#accountDeletions.set(input.userId, request);
    this.#accountDeletionEvents.push({
      eventType: "account_deletion.requested",
      requestId: input.requestId,
      actorUserId: input.userId,
      reason: null,
      createdAt: input.now
    });
    return structuredClone(request);
  }

  async findAccountDeletionByUser(userId: string) {
    const request = this.#accountDeletions.get(userId);
    return request ? structuredClone(request) : null;
  }

  async claimAccountDeletion(input: ClaimAccountDeletionInput) {
    for (const request of this.#accountDeletions.values()) {
      if (
        request.status === "processing" &&
        request.leaseExpiresAt &&
        request.leaseExpiresAt <= input.now
      ) {
        request.status = "retrying";
        request.leaseOwner = null;
        request.leasedAt = null;
        request.leaseExpiresAt = null;
        request.nextAttemptAt = input.now;
        request.lastErrorCode = "LEASE_EXPIRED";
        request.updatedAt = input.now;
      }
    }
    const request = [...this.#accountDeletions.values()]
      .filter((candidate) =>
        ["queued", "waiting_for_calls", "retrying"].includes(candidate.status) &&
        candidate.nextAttemptAt !== null &&
        candidate.nextAttemptAt <= input.now
      )
      .sort((left, right) =>
        (left.nextAttemptAt ?? "").localeCompare(right.nextAttemptAt ?? "") ||
        left.requestedAt.localeCompare(right.requestedAt)
      )[0];
    if (!request) return null;
    request.status = "processing";
    request.attemptCount += 1;
    request.leaseOwner = input.workerId;
    request.leasedAt = input.now;
    request.leaseExpiresAt = input.leaseExpiresAt;
    request.nextAttemptAt = null;
    request.updatedAt = input.now;
    return structuredClone(request);
  }

  async renewAccountDeletionLease(input: AccountDeletionLeaseInput & {
    leaseExpiresAt: string;
  }) {
    const request = this.#accountDeletionById(input.requestId);
    if (request?.status !== "processing" || request.leaseOwner !== input.workerId) {
      return false;
    }
    request.leaseExpiresAt = input.leaseExpiresAt;
    request.updatedAt = input.now;
    return true;
  }

  async deferAccountDeletionForActiveCall(input: AccountDeletionLeaseInput & {
    retryAt: string;
  }) {
    const request = this.#accountDeletionById(input.requestId);
    if (request?.status !== "processing" || request.leaseOwner !== input.workerId) {
      return false;
    }
    request.status = "waiting_for_calls";
    request.attemptCount = Math.max(0, request.attemptCount - 1);
    request.nextAttemptAt = input.retryAt;
    request.lastErrorCode = "ACTIVE_CALL_IN_PROGRESS";
    request.updatedAt = input.now;
    this.#clearAccountDeletionLease(request);
    this.#accountDeletionEvents.push({
      eventType: "account_deletion.active_call_delayed",
      requestId: request.requestId,
      actorUserId: request.userId,
      reason: null,
      createdAt: input.now
    });
    return true;
  }

  async failAccountDeletion(input: FailAccountDeletionInput) {
    const request = this.#accountDeletionById(input.requestId);
    if (request?.status !== "processing" || request.leaseOwner !== input.workerId) {
      return false;
    }
    const exhausted = request.attemptCount >= request.maxAttempts;
    request.status = exhausted ? "needs_support" : "retrying";
    request.nextAttemptAt = exhausted ? null : input.retryAt;
    request.lastErrorCode = input.errorCode;
    request.updatedAt = input.now;
    this.#clearAccountDeletionLease(request);
    return true;
  }

  async completeAccountDeletion(input: AccountDeletionLeaseInput) {
    const request = this.#accountDeletionById(input.requestId);
    if (request?.status !== "processing" || request.leaseOwner !== input.workerId) {
      return false;
    }
    const user = this.#requireUser(request.userId);
    user.email = `deleted+${user.id}@invalid.callassist.local`;
    user.phoneE164 = `deleted:${user.id}`;
    user.firstName = "Deleted";
    user.lastName = "Account";
    user.passwordHash = `deleted:${randomUUID()}`;
    user.phoneVerifiedAt = null;
    user.lastLoginAt = null;
    user.status = "deleted";
    this.#revokeSessions(user.id, input.now);
    request.status = "completed";
    request.completedAt = input.now;
    request.nextAttemptAt = null;
    request.lastErrorCode = null;
    request.updatedAt = input.now;
    this.#clearAccountDeletionLease(request);
    this.#accountDeletionEvents.push({
      eventType: "account_deletion.completed",
      requestId: request.requestId,
      actorUserId: user.id,
      reason: null,
      createdAt: input.now
    });
    return true;
  }

  async retryAccountDeletion(input: {
    requestId: string;
    actorUserId: string;
    targetUserId: string;
    reason: string;
    now: string;
  }) {
    const reason = requireAdminReason(input.reason);
    this.#authorizeAdminAction(input);
    const request = this.#accountDeletionById(input.requestId);
    if (
      !request ||
      request.userId !== input.targetUserId ||
      request.status !== "needs_support"
    ) throw new AuthRepositoryError("ACCOUNT_DELETION_NOT_FOUND");
    request.status = "queued";
    request.generation += 1;
    request.attemptCount = 0;
    request.nextAttemptAt = input.now;
    request.lastErrorCode = null;
    request.updatedAt = input.now;
    this.#accountDeletionEvents.push({
      eventType: "account_deletion.retry_requested",
      requestId: request.requestId,
      actorUserId: input.actorUserId,
      reason,
      createdAt: input.now
    });
  }

  async createPasswordRecoveryChallenge(input: {
    id: string;
    userId: string;
    now: string;
    expiresAt: string;
  }) {
    const user = this.#users.get(input.userId);
    if (
      user?.status !== "active" ||
      !user.phoneVerifiedAt ||
      this.#hasPendingAccountDeletion(input.userId)
    ) return false;
    for (const challenge of this.#passwordRecoveryChallenges.values()) {
      if (
        challenge.userId === input.userId &&
        !challenge.verifiedAt &&
        !challenge.invalidatedAt
      ) challenge.invalidatedAt = input.now;
    }
    this.#passwordRecoveryChallenges.set(input.id, {
      id: input.id,
      userId: input.userId,
      attemptCount: 0,
      expiresAt: input.expiresAt,
      verifiedAt: null,
      invalidatedAt: null,
      lastAttemptAt: null,
      createdAt: input.now
    });
    return true;
  }

  async invalidatePasswordRecoveryChallenge(recoveryId: string, now: string) {
    const challenge = this.#passwordRecoveryChallenges.get(recoveryId);
    if (challenge && !challenge.invalidatedAt) challenge.invalidatedAt = now;
  }

  async consumePasswordRecoveryChallengeAttempt(
    recoveryId: string,
    now: string
  ) {
    const challenge = this.#passwordRecoveryChallenges.get(recoveryId);
    if (
      !challenge ||
      challenge.expiresAt <= now ||
      challenge.verifiedAt ||
      challenge.invalidatedAt ||
      challenge.attemptCount >= 8
    ) return null;
    const user = this.#users.get(challenge.userId);
    if (
      user?.status !== "active" ||
      !user.phoneVerifiedAt ||
      this.#hasPendingAccountDeletion(user.id)
    ) return null;
    challenge.attemptCount += 1;
    challenge.lastAttemptAt = now;
    return {
      id: challenge.id,
      user: structuredClone(user),
      attemptCount: challenge.attemptCount,
      expiresAt: challenge.expiresAt,
      createdAt: challenge.createdAt
    };
  }

  async createPasswordRecoveryGrant(input: {
    id: string;
    recoveryId: string;
    userId: string;
    tokenHash: string;
    now: string;
    expiresAt: string;
  }) {
    const challenge = this.#passwordRecoveryChallenges.get(input.recoveryId);
    const user = this.#users.get(input.userId);
    if (
      !challenge ||
      challenge.userId !== input.userId ||
      challenge.expiresAt <= input.now ||
      challenge.verifiedAt ||
      challenge.invalidatedAt ||
      user?.status !== "active" ||
      !user.phoneVerifiedAt ||
      this.#hasPendingAccountDeletion(input.userId) ||
      [...this.#passwordRecoveryGrants.values()].some(
        (grant) => grant.recoveryId === input.recoveryId
      )
    ) return false;
    challenge.verifiedAt = input.now;
    this.#passwordRecoveryGrants.set(input.tokenHash, {
      id: input.id,
      recoveryId: input.recoveryId,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      consumedAt: null,
      createdAt: input.now
    });
    return true;
  }

  async resetPasswordWithRecoveryGrant(input: {
    tokenHash: string;
    passwordHash: string;
    now: string;
  }) {
    const grant = this.#passwordRecoveryGrants.get(input.tokenHash);
    if (!grant || grant.consumedAt || grant.expiresAt <= input.now) return false;
    const user = this.#users.get(grant.userId);
    if (
      user?.status !== "active" ||
      !user.phoneVerifiedAt ||
      this.#hasPendingAccountDeletion(user.id)
    ) return false;
    user.passwordHash = input.passwordHash;
    user.lastLoginAt = null;
    let revokedSessionCount = 0;
    for (const session of this.#sessions.values()) {
      if (
        session.userId === user.id &&
        !session.revokedAt &&
        session.expiresAt > input.now
      ) {
        session.revokedAt = input.now;
        revokedSessionCount += 1;
      }
    }
    if (revokedSessionCount > 0) {
      this.#accountSessionEvents.push({
        eventType: "session.all_revoked",
        actorUserId: user.id,
        targetSessionId: null,
        revokedSessionCount,
        createdAt: input.now
      });
    }
    grant.consumedAt = input.now;
    this.#passwordRecoveryEvents.push({
      userId: user.id,
      recoveryId: grant.recoveryId,
      revokedSessionCount,
      createdAt: input.now
    });
    return true;
  }

  async setUserStatusForTest(userId: string, status: AuthUserRecord["status"]) {
    this.#requireUser(userId).status = status;
  }

  async setUserRoleForTest(userId: string, role: AuthUserRecord["role"]) {
    this.#requireUser(userId).role = role;
  }

  accountAdminEventsForTest() {
    return structuredClone(this.#accountAdminEvents);
  }

  accountSessionEventsForTest() {
    return structuredClone(this.#accountSessionEvents);
  }

  accountDataExportEventsForTest() {
    return structuredClone(this.#accountDataExportEvents);
  }

  accountDeletionEventsForTest() {
    return structuredClone(this.#accountDeletionEvents);
  }

  passwordRecoveryEventsForTest() {
    return structuredClone(this.#passwordRecoveryEvents);
  }

  async close() {}

  #hasPendingAccountDeletion(userId: string) {
    const request = this.#accountDeletions.get(userId);
    return Boolean(request && request.status !== "completed");
  }

  #requireUser(userId: string) {
    const user = this.#users.get(userId);
    if (!user) throw new AuthRepositoryError("USER_NOT_FOUND");
    return user;
  }

  #authorizeAdminAction(input: AccountAdminInput) {
    if (input.actorUserId === input.targetUserId) {
      throw new AuthRepositoryError("SELF_ADMIN_ACTION_FORBIDDEN");
    }
    const actor = this.#users.get(input.actorUserId);
    if (
      !actor ||
      actor.status !== "active" ||
      (actor.role !== "admin" && actor.role !== "superadmin")
    ) {
      throw new AuthRepositoryError("ADMIN_ACTION_FORBIDDEN");
    }
    const target = this.#users.get(input.targetUserId);
    if (!target) throw new AuthRepositoryError("USER_NOT_FOUND");
    if (target.status === "deleted") {
      throw new AuthRepositoryError("ACCOUNT_STATUS_TRANSITION_INVALID");
    }
    if (actor.role !== "superadmin" && target.role !== "user") {
      throw new AuthRepositoryError("ADMIN_ACTION_FORBIDDEN");
    }
    return { actor, target };
  }

  #requireAdmin(userId: string) {
    const actor = this.#users.get(userId);
    if (
      !actor ||
      actor.status !== "active" ||
      !actor.phoneVerifiedAt ||
      (actor.role !== "admin" && actor.role !== "superadmin")
    ) {
      throw new AuthRepositoryError("ADMIN_ACTION_FORBIDDEN");
    }
    return actor;
  }

  #revokeSessions(userId: string, revokedAt: string) {
    for (const session of this.#sessions.values()) {
      if (session.userId === userId) session.revokedAt ??= revokedAt;
    }
  }

  #accountDeletionById(requestId: string) {
    return [...this.#accountDeletions.values()].find(
      (request) => request.requestId === requestId
    );
  }

  #clearAccountDeletionLease(request: AccountDeletionRequestRecord) {
    request.leaseOwner = null;
    request.leasedAt = null;
    request.leaseExpiresAt = null;
  }
}

function requireAdminReason(value: string) {
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new Error("An admin action reason between 3 and 500 characters is required");
  }
  return reason;
}

function toAdminUserSummary(record: AuthUserRecord) {
  return {
    id: record.id,
    email: record.email,
    firstName: record.firstName,
    lastName: record.lastName,
    role: record.role,
    status: record.status,
    phoneVerified: record.phoneVerifiedAt !== null,
    createdAt: record.createdAt,
    lastLoginAt: record.lastLoginAt
  };
}
