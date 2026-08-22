import { randomUUID } from "node:crypto";
import type {
  AccountAdminInput,
  AccountDataExportEventInput,
  AuthRepository,
  AuthSessionRecord,
  AuthUserRecord,
  ChangeAccountStatusInput,
  CreateAuthUserInput,
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

export class InMemoryAuthRepository implements AuthRepository {
  readonly mode = "memory" as const;
  readonly #users = new Map<string, AuthUserRecord>();
  readonly #sessions = new Map<string, AuthSessionRecord>();
  readonly #accountAdminEvents: AccountAdminEvent[] = [];
  readonly #accountSessionEvents: AccountSessionEvent[] = [];
  readonly #accountDataExportEvents: AccountDataExportEvent[] = [];

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

  async updateLastLogin(userId: string, loggedInAt: string) {
    this.#requireUser(userId).lastLoginAt = loggedInAt;
  }

  async createSession(input: AuthSessionRecord) {
    const user = this.#users.get(input.userId);
    if (!user || user.status !== "active" || !user.phoneVerifiedAt) {
      throw new AuthRepositoryError("SESSION_CREATION_DENIED");
    }
    this.#sessions.set(input.tokenHash, structuredClone(input));
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

  async close() {}

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
