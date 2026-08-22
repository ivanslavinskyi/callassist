import type {
  AdminUserSummary,
  UserRole,
  UserStatus
} from "@callassist/contracts";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
  AuthRepositoryError,
  type AccountAdminInput,
  type AuthRepository,
  type AuthSessionRecord,
  type AuthUserRecord,
  type ChangeAccountStatusInput,
  type CreateAuthUserInput,
  type ListAdminUsersInput,
  encodeAdminUserCursor
} from "./auth-repository";

type DatabaseDate = Date | string;

type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  phoneE164: string;
  phoneVerifiedAt: DatabaseDate | null;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  uiLocale: "en" | "de";
  createdAt: DatabaseDate;
  lastLoginAt: DatabaseDate | null;
};

type SessionUserRow = UserRow & {
  sessionId: string;
  sessionUserId: string;
  sessionTokenHash: string;
  sessionExpiresAt: DatabaseDate;
  sessionRevokedAt: DatabaseDate | null;
  sessionCreatedAt: DatabaseDate;
  sessionLastSeenAt: DatabaseDate;
  sessionUserAgent: string | null;
};

type ActiveSessionRow = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: DatabaseDate;
  revokedAt: DatabaseDate | null;
  createdAt: DatabaseDate;
  lastSeenAt: DatabaseDate;
  userAgent: string | null;
  totalActive: number;
};

type AdminUserRow = {
  id: string;
  role: UserRole;
  status: UserStatus;
};

type AdminUserSummaryRow = Omit<
  AdminUserSummary,
  "createdAt" | "lastLoginAt"
> & {
  createdAt: DatabaseDate;
  lastLoginAt: DatabaseDate | null;
};

function toIso(value: DatabaseDate) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export class PostgresAuthRepository implements AuthRepository {
  readonly mode = "postgres" as const;
  readonly #sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 5, onnotice: () => undefined });
  }

  async createUser(input: CreateAuthUserInput) {
    const id = randomUUID();
    const now = new Date();
    try {
      const [row] = await this.#sql<UserRow[]>`
        INSERT INTO users (
          id, email, password_hash, phone_e164, phone_verified_at,
          first_name, last_name, role, status, ui_locale, created_at, last_login_at
        ) VALUES (
          ${id}, ${input.email}, ${input.passwordHash}, ${input.phoneE164}, ${null},
          ${input.firstName}, ${input.lastName}, 'user', 'active', ${input.uiLocale},
          ${now}, ${null}
        )
        RETURNING ${this.#userColumns()}
      `;
      if (!row) throw new AuthRepositoryError("USER_NOT_FOUND");
      return this.#mapUser(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AuthRepositoryError("USER_ALREADY_EXISTS");
      }
      throw error;
    }
  }

  async findUserByEmail(email: string) {
    const [row] = await this.#sql<UserRow[]>`
      SELECT ${this.#userColumns()}
      FROM users
      WHERE lower(email) = ${email.toLowerCase()}
      LIMIT 1
    `;
    return row ? this.#mapUser(row) : null;
  }

  async listUsersForAdmin(input: ListAdminUsersInput) {
    return this.#sql.begin(async (transaction) => {
      const actor = await this.#requireAdminRead(
        transaction,
        input.actorUserId
      );
      const searchTerm = input.search
        ? input.search.toLowerCase()
        : null;
      const cursorCreatedAt = input.cursor
        ? new Date(input.cursor.createdAt)
        : null;
      const cursorId = input.cursor?.id ?? null;
      const rows = await transaction<AdminUserSummaryRow[]>`
        SELECT ${this.#adminUserSummaryColumns()}
        FROM users
        WHERE (${actor.role === "superadmin"} OR role = 'user')
          AND (${input.role ?? null}::text IS NULL OR role::text = ${input.role ?? null})
          AND (${input.status ?? null}::text IS NULL OR status::text = ${input.status ?? null})
          AND (
            ${searchTerm}::text IS NULL OR
            strpos(lower(email), ${searchTerm}) > 0 OR
            strpos(lower(first_name), ${searchTerm}) > 0 OR
            strpos(lower(last_name), ${searchTerm}) > 0 OR
            strpos(lower(first_name || ' ' || last_name), ${searchTerm}) > 0
          )
          AND (
            ${cursorCreatedAt}::timestamptz IS NULL OR
            (created_at, id) < (${cursorCreatedAt}, ${cursorId}::uuid)
          )
        ORDER BY created_at DESC, id DESC
        LIMIT ${input.limit + 1}
      `;
      const hasMore = rows.length > input.limit;
      const items = rows
        .slice(0, input.limit)
        .map((row) => this.#mapAdminUserSummary(row));
      const last = items.at(-1);
      return {
        items,
        nextCursor: hasMore && last
          ? encodeAdminUserCursor({ createdAt: last.createdAt, id: last.id })
          : null
      };
    });
  }

  async findUserByIdForAdmin(actorUserId: string, targetUserId: string) {
    return this.#sql.begin(async (transaction) => {
      const actor = await this.#requireAdminRead(transaction, actorUserId);
      const [row] = await transaction<AdminUserSummaryRow[]>`
        SELECT ${this.#adminUserSummaryColumns()}
        FROM users
        WHERE id = ${targetUserId}
          AND (${actor.role === "superadmin"} OR role = 'user')
        LIMIT 1
      `;
      if (!row) throw new AuthRepositoryError("USER_NOT_FOUND");
      return this.#mapAdminUserSummary(row);
    });
  }

  async markPhoneVerified(userId: string, verifiedAt: string) {
    const [row] = await this.#sql<UserRow[]>`
      UPDATE users
      SET phone_verified_at = COALESCE(phone_verified_at, ${new Date(verifiedAt)})
      WHERE id = ${userId}
      RETURNING ${this.#userColumns()}
    `;
    if (!row) throw new AuthRepositoryError("USER_NOT_FOUND");
    return this.#mapUser(row);
  }

  async updateLastLogin(userId: string, loggedInAt: string) {
    await this.#sql`
      UPDATE users SET last_login_at = ${new Date(loggedInAt)} WHERE id = ${userId}
    `;
  }

  async createSession(input: AuthSessionRecord) {
    await this.#sql.begin(async (transaction) => {
      const [user] = await transaction<{
        status: UserStatus;
        phoneVerifiedAt: DatabaseDate | null;
      }[]>`
        SELECT status, phone_verified_at AS "phoneVerifiedAt"
        FROM users
        WHERE id = ${input.userId}
        FOR SHARE
      `;
      if (user?.status !== "active" || !user.phoneVerifiedAt) {
        throw new AuthRepositoryError("SESSION_CREATION_DENIED");
      }
      await transaction`
        INSERT INTO sessions (
          id, user_id, token_hash, expires_at, revoked_at,
          created_at, last_seen_at, user_agent
        ) VALUES (
          ${input.id}, ${input.userId}, ${input.tokenHash}, ${new Date(input.expiresAt)},
          ${input.revokedAt ? new Date(input.revokedAt) : null},
          ${new Date(input.createdAt)}, ${new Date(input.lastSeenAt)}, ${input.userAgent}
        )
      `;
    });
  }

  async findUserBySessionTokenHash(tokenHash: string, now: string) {
    const rows = await this.#sql<SessionUserRow[]>`
      SELECT
        ${this.#qualifiedUserColumns()},
        sessions.id AS "sessionId",
        sessions.user_id AS "sessionUserId",
        sessions.token_hash AS "sessionTokenHash",
        sessions.expires_at AS "sessionExpiresAt",
        sessions.revoked_at AS "sessionRevokedAt",
        sessions.created_at AS "sessionCreatedAt",
        sessions.last_seen_at AS "sessionLastSeenAt",
        sessions.user_agent AS "sessionUserAgent"
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ${tokenHash}
        AND sessions.revoked_at IS NULL
        AND sessions.expires_at > ${new Date(now)}
        AND users.status = 'active'
        AND users.phone_verified_at IS NOT NULL
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    await this.#sql`
      UPDATE sessions SET last_seen_at = ${new Date(now)} WHERE token_hash = ${tokenHash}
    `;
    return {
      user: this.#mapUser(row),
      session: {
        id: row.sessionId,
        userId: row.sessionUserId,
        tokenHash: row.sessionTokenHash,
        expiresAt: toIso(row.sessionExpiresAt),
        revokedAt: row.sessionRevokedAt ? toIso(row.sessionRevokedAt) : null,
        createdAt: toIso(row.sessionCreatedAt),
        lastSeenAt: toIso(row.sessionLastSeenAt),
        userAgent: row.sessionUserAgent
      }
    };
  }

  async listActiveSessions(
    userId: string,
    now: string,
    limit: number,
    currentSessionId: string
  ) {
    const rows = await this.#sql<ActiveSessionRow[]>`
      SELECT
        id,
        user_id AS "userId",
        token_hash AS "tokenHash",
        expires_at AS "expiresAt",
        revoked_at AS "revokedAt",
        created_at AS "createdAt",
        last_seen_at AS "lastSeenAt",
        user_agent AS "userAgent",
        count(*) OVER()::integer AS "totalActive"
      FROM sessions
      WHERE user_id = ${userId}
        AND revoked_at IS NULL
        AND expires_at > ${new Date(now)}
      ORDER BY (id = ${currentSessionId}) DESC, last_seen_at DESC, created_at DESC, id DESC
      LIMIT ${limit}
    `;
    return {
      sessions: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        tokenHash: row.tokenHash,
        expiresAt: toIso(row.expiresAt),
        revokedAt: row.revokedAt ? toIso(row.revokedAt) : null,
        createdAt: toIso(row.createdAt),
        lastSeenAt: toIso(row.lastSeenAt),
        userAgent: row.userAgent
      })),
      totalActive: rows[0]?.totalActive ?? 0
    };
  }

  async revokeSession(tokenHash: string, revokedAt: string) {
    await this.#sql`
      UPDATE sessions
      SET revoked_at = COALESCE(revoked_at, ${new Date(revokedAt)})
      WHERE token_hash = ${tokenHash}
    `;
  }

  async revokeSessionById(
    userId: string,
    sessionId: string,
    revokedAt: string
  ) {
    return this.#sql.begin(async (transaction) => {
      const rows = await transaction<{ id: string }[]>`
        UPDATE sessions
        SET revoked_at = ${new Date(revokedAt)}
        WHERE id = ${sessionId}
          AND user_id = ${userId}
          AND revoked_at IS NULL
          AND expires_at > ${new Date(revokedAt)}
        RETURNING id
      `;
      if (rows.length === 0) return false;
      await this.#accountSessionEvent(transaction, {
        eventType: "session.revoked",
        actorUserId: userId,
        targetSessionId: sessionId,
        revokedSessionCount: 1,
        now: new Date(revokedAt)
      });
      return true;
    });
  }

  async revokeUserSessions(userId: string, revokedAt: string) {
    await this.#sql.begin(async (transaction) => {
      const rows = await transaction<{ id: string }[]>`
        UPDATE sessions
        SET revoked_at = ${new Date(revokedAt)}
        WHERE user_id = ${userId}
          AND revoked_at IS NULL
          AND expires_at > ${new Date(revokedAt)}
        RETURNING id
      `;
      if (rows.length > 0) {
        await this.#accountSessionEvent(transaction, {
          eventType: "session.all_revoked",
          actorUserId: userId,
          targetSessionId: null,
          revokedSessionCount: rows.length,
          now: new Date(revokedAt)
        });
      }
    });
  }

  async changeAccountStatus(input: ChangeAccountStatusInput) {
    const reason = requireAdminReason(input.reason);
    return this.#sql.begin(async (transaction) => {
      const { target } = await this.#authorizeAdminAction(transaction, input);
      if (target.status === input.status) {
        throw new AuthRepositoryError("ACCOUNT_STATUS_UNCHANGED");
      }
      const now = new Date();
      const [updated] = await transaction<UserRow[]>`
        UPDATE users
        SET status = ${input.status}
        WHERE id = ${input.targetUserId}
        RETURNING ${this.#userColumns()}
      `;
      if (!updated) throw new AuthRepositoryError("USER_NOT_FOUND");
      if (input.status === "suspended") {
        await transaction`
          UPDATE sessions
          SET revoked_at = COALESCE(revoked_at, ${now})
          WHERE user_id = ${input.targetUserId}
        `;
      }
      await this.#accountAdminEvent(transaction, {
        eventType: input.status === "suspended"
          ? "account.suspended"
          : "account.unsuspended",
        actorUserId: input.actorUserId,
        targetUserId: input.targetUserId,
        previousStatus: target.status as "active" | "suspended",
        newStatus: input.status,
        reason,
        now
      });
      return this.#mapUser(updated);
    });
  }

  async revokeUserSessionsByAdmin(input: AccountAdminInput) {
    const reason = requireAdminReason(input.reason);
    await this.#sql.begin(async (transaction) => {
      await this.#authorizeAdminAction(transaction, input);
      const now = new Date();
      await transaction`
        UPDATE sessions
        SET revoked_at = COALESCE(revoked_at, ${now})
        WHERE user_id = ${input.targetUserId}
      `;
      await this.#accountAdminEvent(transaction, {
        eventType: "account.sessions_revoked",
        actorUserId: input.actorUserId,
        targetUserId: input.targetUserId,
        previousStatus: null,
        newStatus: null,
        reason,
        now
      });
    });
  }

  async close() {
    await this.#sql.end({ timeout: 5 });
  }

  async #authorizeAdminAction(
    transaction: postgres.TransactionSql,
    input: AccountAdminInput
  ) {
    if (input.actorUserId === input.targetUserId) {
      throw new AuthRepositoryError("SELF_ADMIN_ACTION_FORBIDDEN");
    }
    const rows = await transaction<AdminUserRow[]>`
      SELECT id, role, status
      FROM users
      WHERE id = ${input.actorUserId} OR id = ${input.targetUserId}
      ORDER BY id
      FOR UPDATE
    `;
    const actor = rows.find(({ id }) => id === input.actorUserId);
    if (
      !actor ||
      actor.status !== "active" ||
      (actor.role !== "admin" && actor.role !== "superadmin")
    ) {
      throw new AuthRepositoryError("ADMIN_ACTION_FORBIDDEN");
    }
    const target = rows.find(({ id }) => id === input.targetUserId);
    if (!target) throw new AuthRepositoryError("USER_NOT_FOUND");
    if (target.status === "deleted") {
      throw new AuthRepositoryError("ACCOUNT_STATUS_TRANSITION_INVALID");
    }
    if (actor.role !== "superadmin" && target.role !== "user") {
      throw new AuthRepositoryError("ADMIN_ACTION_FORBIDDEN");
    }
    return { actor, target };
  }

  async #requireAdminRead(
    transaction: postgres.TransactionSql,
    actorUserId: string
  ) {
    const [actor] = await transaction<(AdminUserRow & {
      phoneVerifiedAt: DatabaseDate | null;
    })[]>`
      SELECT
        id, role, status, phone_verified_at AS "phoneVerifiedAt"
      FROM users
      WHERE id = ${actorUserId}
      FOR SHARE
    `;
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

  async #accountAdminEvent(
    transaction: postgres.TransactionSql,
    input: {
      eventType:
        | "account.suspended"
        | "account.unsuspended"
        | "account.sessions_revoked";
      actorUserId: string;
      targetUserId: string;
      previousStatus: "active" | "suspended" | null;
      newStatus: "active" | "suspended" | null;
      reason: string;
      now: Date;
    }
  ) {
    await transaction`
      INSERT INTO account_admin_events (
        id, event_type, actor_user_id, target_user_id,
        previous_status, new_status, reason, metadata, created_at
      ) VALUES (
        ${randomUUID()}, ${input.eventType}, ${input.actorUserId},
        ${input.targetUserId}, ${input.previousStatus}, ${input.newStatus},
        ${input.reason}, ${transaction.json({})}, ${input.now}
      )
    `;
  }

  async #accountSessionEvent(
    transaction: postgres.TransactionSql,
    input: {
      eventType: "session.revoked" | "session.all_revoked";
      actorUserId: string;
      targetSessionId: string | null;
      revokedSessionCount: number;
      now: Date;
    }
  ) {
    await transaction`
      INSERT INTO account_session_events (
        id, event_type, actor_user_id, target_session_id,
        revoked_session_count, created_at
      ) VALUES (
        ${randomUUID()}, ${input.eventType}, ${input.actorUserId},
        ${input.targetSessionId}, ${input.revokedSessionCount}, ${input.now}
      )
    `;
  }

  #userColumns() {
    return this.#sql`
      id AS "id",
      email AS "email",
      password_hash AS "passwordHash",
      phone_e164 AS "phoneE164",
      phone_verified_at AS "phoneVerifiedAt",
      first_name AS "firstName",
      last_name AS "lastName",
      role AS "role",
      status AS "status",
      ui_locale AS "uiLocale",
      created_at AS "createdAt",
      last_login_at AS "lastLoginAt"
    `;
  }

  #qualifiedUserColumns() {
    return this.#sql`
      users.id AS "id",
      users.email AS "email",
      users.password_hash AS "passwordHash",
      users.phone_e164 AS "phoneE164",
      users.phone_verified_at AS "phoneVerifiedAt",
      users.first_name AS "firstName",
      users.last_name AS "lastName",
      users.role AS "role",
      users.status AS "status",
      users.ui_locale AS "uiLocale",
      users.created_at AS "createdAt",
      users.last_login_at AS "lastLoginAt"
    `;
  }

  #adminUserSummaryColumns() {
    return this.#sql`
      id AS "id",
      email AS "email",
      first_name AS "firstName",
      last_name AS "lastName",
      role AS "role",
      status AS "status",
      (phone_verified_at IS NOT NULL) AS "phoneVerified",
      created_at AS "createdAt",
      last_login_at AS "lastLoginAt"
    `;
  }

  #mapUser(row: UserRow): AuthUserRecord {
    return {
      ...row,
      phoneVerifiedAt: row.phoneVerifiedAt ? toIso(row.phoneVerifiedAt) : null,
      createdAt: toIso(row.createdAt),
      lastLoginAt: row.lastLoginAt ? toIso(row.lastLoginAt) : null
    };
  }

  #mapAdminUserSummary(row: AdminUserSummaryRow): AdminUserSummary {
    return {
      ...row,
      createdAt: toIso(row.createdAt),
      lastLoginAt: row.lastLoginAt ? toIso(row.lastLoginAt) : null
    };
  }

}

function isUniqueViolation(error: unknown) {
  return Boolean(
    error && typeof error === "object" && "code" in error && error.code === "23505"
  );
}

function requireAdminReason(value: string) {
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 500) {
    throw new Error("An admin action reason between 3 and 500 characters is required");
  }
  return reason;
}
