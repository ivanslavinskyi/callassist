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
  type AccountDeletionLeaseInput,
  type AccountDeletionRequestRecord,
  type AccountDataExportEventInput,
  type AuthRepository,
  type AuthSessionRecord,
  type AuthUserRecord,
  type ChangeAccountStatusInput,
  type ClaimAccountDeletionInput,
  type CreateAuthSessionInput,
  type CreateAuthUserInput,
  type FailAccountDeletionInput,
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

type AccountDeletionRow = {
  requestId: string;
  userId: string;
  status: AccountDeletionRequestRecord["status"];
  generation: number;
  attemptCount: number;
  maxAttempts: number;
  runAfter: DatabaseDate;
  leaseOwner: string | null;
  leasedAt: DatabaseDate | null;
  leaseExpiresAt: DatabaseDate | null;
  lastErrorCode: string | null;
  requestedAt: DatabaseDate;
  updatedAt: DatabaseDate;
  completedAt: DatabaseDate | null;
};

type PasswordRecoveryChallengeRow = {
  id: string;
  userId: string;
  attemptCount: number;
  expiresAt: DatabaseDate;
  createdAt: DatabaseDate;
};

type PasswordRecoveryGrantRow = {
  id: string;
  recoveryId: string;
  userId: string;
  expiresAt: DatabaseDate;
  consumedAt: DatabaseDate | null;
  invalidatedAt: DatabaseDate | null;
};

type PhoneChangeChallengeRow = {
  id: string;
  userId: string;
  initiatingSessionId: string;
  newPhoneE164: string;
  attemptCount: number;
  expiresAt: DatabaseDate;
  createdAt: DatabaseDate;
};

function toIso(value: DatabaseDate) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapPhoneChangeChallenge(
  row: PhoneChangeChallengeRow
) {
  return {
    ...row,
    expiresAt: toIso(row.expiresAt),
    createdAt: toIso(row.createdAt)
  };
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

  async createSession(input: CreateAuthSessionInput) {
    await this.#sql.begin(async (transaction) => {
      const [user] = await transaction<{
        status: UserStatus;
        phoneVerifiedAt: DatabaseDate | null;
        passwordHash: string;
      }[]>`
        SELECT
          status,
          phone_verified_at AS "phoneVerifiedAt",
          password_hash AS "passwordHash"
        FROM users
        WHERE id = ${input.userId}
        FOR UPDATE
      `;
      if (
        user?.status !== "active" ||
        !user.phoneVerifiedAt ||
        (input.expectedPasswordHash !== undefined &&
          input.expectedPasswordHash !== user.passwordHash)
      ) {
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
      await transaction`
        UPDATE users
        SET last_login_at = ${new Date(input.lastSeenAt)}
        WHERE id = ${input.userId}
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

  async recordAccountDataExport(input: AccountDataExportEventInput) {
    await this.#sql`
      INSERT INTO account_data_export_events (
        id, user_id, schema_version, call_count, byte_count, created_at
      ) VALUES (
        ${input.exportId}, ${input.userId}, ${input.schemaVersion},
        ${input.callCount}, ${input.byteCount}, ${new Date(input.createdAt)}
      )
    `;
  }

  async requestAccountDeletion(input: {
    requestId: string;
    userId: string;
    now: string;
    maxAttempts: number;
  }) {
    return this.#sql.begin(async (transaction) => {
      const [user] = await transaction<AdminUserRow[]>`
        SELECT id, role, status
        FROM users
        WHERE id = ${input.userId}
        FOR UPDATE
      `;
      if (!user || user.role !== "user" || user.status !== "active") {
        throw new AuthRepositoryError("ACCOUNT_DELETION_NOT_AVAILABLE");
      }
      const [existing] = await transaction<AccountDeletionRow[]>`
        SELECT ${this.#accountDeletionColumns()}
        FROM account_deletion_requests
        WHERE user_id = ${input.userId}
        LIMIT 1
      `;
      if (existing) return this.#mapAccountDeletion(existing);
      const now = new Date(input.now);
      const [created] = await transaction<AccountDeletionRow[]>`
        INSERT INTO account_deletion_requests (
          id, user_id, status, generation, attempt_count, max_attempts,
          run_after, requested_at, updated_at
        ) VALUES (
          ${input.requestId}, ${input.userId}, 'queued', 1, 0,
          ${input.maxAttempts}, ${now}, ${now}, ${now}
        )
        RETURNING ${this.#accountDeletionColumns()}
      `;
      await transaction`
        INSERT INTO account_deletion_events (
          id, request_id, event_type, actor_user_id, reason, created_at
        ) VALUES (
          ${randomUUID()}, ${input.requestId},
          'account_deletion.requested', ${input.userId}, ${null}, ${now}
        )
      `;
      if (!created) throw new AuthRepositoryError("ACCOUNT_DELETION_NOT_FOUND");
      return this.#mapAccountDeletion(created);
    });
  }

  async findAccountDeletionByUser(userId: string) {
    const [row] = await this.#sql<AccountDeletionRow[]>`
      SELECT ${this.#accountDeletionColumns()}
      FROM account_deletion_requests
      WHERE user_id = ${userId}
      LIMIT 1
    `;
    return row ? this.#mapAccountDeletion(row) : null;
  }

  async claimAccountDeletion(input: ClaimAccountDeletionInput) {
    return this.#sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO account_deletion_attempts (
          id, request_id, generation, attempt_number, worker_id,
          started_at, completed_at, outcome, error_code
        )
        SELECT
          gen_random_uuid(), id, generation, attempt_count, lease_owner,
          leased_at, ${new Date(input.now)}, 'lease_expired', 'LEASE_EXPIRED'
        FROM account_deletion_requests
        WHERE status = 'processing'
          AND lease_expires_at <= ${new Date(input.now)}
        ON CONFLICT (request_id, generation, attempt_number) DO NOTHING
      `;
      await transaction`
        UPDATE account_deletion_requests
        SET
          status = 'retrying',
          run_after = ${new Date(input.now)},
          lease_owner = NULL,
          leased_at = NULL,
          lease_expires_at = NULL,
          last_error_code = 'LEASE_EXPIRED',
          updated_at = ${new Date(input.now)}
        WHERE status = 'processing'
          AND lease_expires_at <= ${new Date(input.now)}
      `;
      const [candidate] = await transaction<{ id: string }[]>`
        SELECT id
        FROM account_deletion_requests
        WHERE status IN ('queued', 'waiting_for_calls', 'retrying')
          AND run_after <= ${new Date(input.now)}
        ORDER BY run_after ASC, requested_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      if (!candidate) return null;
      const [claimed] = await transaction<AccountDeletionRow[]>`
        UPDATE account_deletion_requests
        SET
          status = 'processing',
          attempt_count = attempt_count + 1,
          lease_owner = ${input.workerId},
          leased_at = ${new Date(input.now)},
          lease_expires_at = ${new Date(input.leaseExpiresAt)},
          updated_at = ${new Date(input.now)}
        WHERE id = ${candidate.id}
        RETURNING ${this.#accountDeletionColumns()}
      `;
      return claimed ? this.#mapAccountDeletion(claimed) : null;
    });
  }

  async renewAccountDeletionLease(input: AccountDeletionLeaseInput & {
    leaseExpiresAt: string;
  }) {
    const rows = await this.#sql<{ id: string }[]>`
      UPDATE account_deletion_requests
      SET
        lease_expires_at = ${new Date(input.leaseExpiresAt)},
        updated_at = ${new Date(input.now)}
      WHERE id = ${input.requestId}
        AND status = 'processing'
        AND lease_owner = ${input.workerId}
      RETURNING id
    `;
    return rows.length === 1;
  }

  async deferAccountDeletionForActiveCall(input: AccountDeletionLeaseInput & {
    retryAt: string;
  }) {
    return this.#sql.begin(async (transaction) => {
      const rows = await transaction<{ userId: string }[]>`
        UPDATE account_deletion_requests
        SET
          status = 'waiting_for_calls',
          attempt_count = GREATEST(0, attempt_count - 1),
          run_after = ${new Date(input.retryAt)},
          lease_owner = NULL,
          leased_at = NULL,
          lease_expires_at = NULL,
          last_error_code = 'ACTIVE_CALL_IN_PROGRESS',
          updated_at = ${new Date(input.now)}
        WHERE id = ${input.requestId}
          AND status = 'processing'
          AND lease_owner = ${input.workerId}
        RETURNING user_id AS "userId"
      `;
      const row = rows[0];
      if (!row) return false;
      await transaction`
        INSERT INTO account_deletion_events (
          id, request_id, event_type, actor_user_id, reason, created_at
        ) VALUES (
          ${randomUUID()}, ${input.requestId},
          'account_deletion.active_call_delayed', ${row.userId}, ${null},
          ${new Date(input.now)}
        )
      `;
      return true;
    });
  }

  async failAccountDeletion(input: FailAccountDeletionInput) {
    return this.#sql.begin(async (transaction) => {
      const [request] = await transaction<AccountDeletionRow[]>`
        SELECT ${this.#accountDeletionColumns()}
        FROM account_deletion_requests
        WHERE id = ${input.requestId}
          AND status = 'processing'
          AND lease_owner = ${input.workerId}
        FOR UPDATE
      `;
      if (!request) return false;
      const exhausted = request.attemptCount >= request.maxAttempts;
      await transaction`
        INSERT INTO account_deletion_attempts (
          id, request_id, generation, attempt_number, worker_id,
          started_at, completed_at, outcome, error_code
        ) VALUES (
          ${randomUUID()}, ${input.requestId}, ${request.generation},
          ${request.attemptCount}, ${input.workerId},
          ${new Date(toIso(request.leasedAt!))}, ${new Date(input.now)},
          ${exhausted ? "needs_support" : "retry_scheduled"},
          ${input.errorCode}
        )
      `;
      await transaction`
        UPDATE account_deletion_requests
        SET
          status = ${exhausted ? "needs_support" : "retrying"},
          run_after = ${new Date(input.retryAt)},
          lease_owner = NULL,
          leased_at = NULL,
          lease_expires_at = NULL,
          last_error_code = ${input.errorCode},
          updated_at = ${new Date(input.now)}
        WHERE id = ${input.requestId}
      `;
      return true;
    });
  }

  async completeAccountDeletion(input: AccountDeletionLeaseInput) {
    return this.#sql.begin(async (transaction) => {
      const [request] = await transaction<AccountDeletionRow[]>`
        SELECT ${this.#accountDeletionColumns()}
        FROM account_deletion_requests
        WHERE id = ${input.requestId}
          AND status = 'processing'
          AND lease_owner = ${input.workerId}
        FOR UPDATE
      `;
      if (!request) return false;
      const [deletableUser] = await transaction<AdminUserRow[]>`
        SELECT id, role, status
        FROM users
        WHERE id = ${request.userId}
          AND status IN ('active', 'suspended')
        FOR UPDATE
      `;
      if (!deletableUser) {
        throw new AuthRepositoryError("ACCOUNT_DELETION_NOT_AVAILABLE");
      }
      const [remainingCall] = await transaction<{ id: string }[]>`
        SELECT id
        FROM call_briefs
        WHERE user_id = ${request.userId}
          AND data_deleted_at IS NULL
        LIMIT 1
        FOR SHARE
      `;
      if (remainingCall) {
        throw new AuthRepositoryError("ACCOUNT_DELETION_CALLS_REMAIN");
      }
      const now = new Date(input.now);
      const revokedSessions = await transaction<{ id: string }[]>`
        UPDATE sessions
        SET revoked_at = COALESCE(revoked_at, ${now})
        WHERE user_id = ${request.userId}
          AND revoked_at IS NULL
        RETURNING id
      `;
      if (revokedSessions.length > 0) {
        await this.#accountSessionEvent(transaction, {
          eventType: "session.all_revoked",
          actorUserId: request.userId,
          targetSessionId: null,
          revokedSessionCount: revokedSessions.length,
          now
        });
      }
      const anonymizedUsers = await transaction<{ id: string }[]>`
        UPDATE users
        SET
          email = ${`deleted+${request.userId}@invalid.callassist.local`},
          phone_e164 = ${`deleted:${request.userId}`},
          first_name = 'Deleted',
          last_name = 'Account',
          password_hash = ${`deleted:${randomUUID()}`},
          phone_verified_at = NULL,
          last_login_at = NULL,
          status = 'deleted'
        WHERE id = ${request.userId}
          AND status IN ('active', 'suspended')
        RETURNING id
      `;
      if (anonymizedUsers.length !== 1) {
        throw new AuthRepositoryError("ACCOUNT_DELETION_NOT_AVAILABLE");
      }
      await transaction`
        INSERT INTO account_deletion_attempts (
          id, request_id, generation, attempt_number, worker_id,
          started_at, completed_at, outcome, error_code
        ) VALUES (
          ${randomUUID()}, ${request.requestId}, ${request.generation},
          ${request.attemptCount}, ${input.workerId},
          ${new Date(toIso(request.leasedAt!))}, ${now}, 'succeeded', ${null}
        )
      `;
      await transaction`
        UPDATE account_deletion_requests
        SET
          status = 'completed',
          lease_owner = NULL,
          leased_at = NULL,
          lease_expires_at = NULL,
          last_error_code = NULL,
          updated_at = ${now},
          completed_at = ${now}
        WHERE id = ${request.requestId}
      `;
      await transaction`
        INSERT INTO account_deletion_events (
          id, request_id, event_type, actor_user_id, reason, created_at
        ) VALUES (
          ${randomUUID()}, ${request.requestId},
          'account_deletion.completed', ${request.userId}, ${null}, ${now}
        )
      `;
      return true;
    });
  }

  async retryAccountDeletion(input: {
    requestId: string;
    actorUserId: string;
    targetUserId: string;
    reason: string;
    now: string;
  }) {
    const reason = requireAdminReason(input.reason);
    await this.#sql.begin(async (transaction) => {
      await this.#authorizeAdminAction(transaction, input);
      const rows = await transaction<{ id: string }[]>`
        UPDATE account_deletion_requests
        SET
          status = 'queued',
          generation = generation + 1,
          attempt_count = 0,
          run_after = ${new Date(input.now)},
          last_error_code = NULL,
          updated_at = ${new Date(input.now)}
        WHERE id = ${input.requestId}
          AND user_id = ${input.targetUserId}
          AND status = 'needs_support'
        RETURNING id
      `;
      if (rows.length === 0) {
        throw new AuthRepositoryError("ACCOUNT_DELETION_NOT_FOUND");
      }
      await transaction`
        INSERT INTO account_deletion_events (
          id, request_id, event_type, actor_user_id, reason, created_at
        ) VALUES (
          ${randomUUID()}, ${input.requestId},
          'account_deletion.retry_requested', ${input.actorUserId}, ${reason},
          ${new Date(input.now)}
        )
      `;
    });
  }

  async createPasswordRecoveryChallenge(input: {
    id: string;
    userId: string;
    now: string;
    expiresAt: string;
  }) {
    return this.#sql.begin(async (transaction) => {
      const [user] = await transaction<AdminUserRow[]>`
        SELECT id, role, status
        FROM users
        WHERE id = ${input.userId}
          AND status = 'active'
          AND phone_verified_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM account_deletion_requests
            WHERE user_id = users.id AND status <> 'completed'
          )
        FOR UPDATE
      `;
      if (!user) return false;
      await transaction`
        UPDATE password_recovery_challenges
        SET invalidated_at = ${new Date(input.now)}
        WHERE user_id = ${input.userId}
          AND verified_at IS NULL
          AND invalidated_at IS NULL
      `;
      await transaction`
        INSERT INTO password_recovery_challenges (
          id, user_id, attempt_count, expires_at, created_at
        ) VALUES (
          ${input.id}, ${input.userId}, 0,
          ${new Date(input.expiresAt)}, ${new Date(input.now)}
        )
      `;
      return true;
    });
  }

  async invalidatePasswordRecoveryChallenge(recoveryId: string, now: string) {
    await this.#sql`
      UPDATE password_recovery_challenges
      SET invalidated_at = COALESCE(invalidated_at, ${new Date(now)})
      WHERE id = ${recoveryId}
    `;
  }

  async consumePasswordRecoveryChallengeAttempt(
    recoveryId: string,
    now: string
  ) {
    return this.#sql.begin(async (transaction) => {
      const [challenge] = await transaction<PasswordRecoveryChallengeRow[]>`
        UPDATE password_recovery_challenges AS challenges
        SET
          attempt_count = attempt_count + 1,
          last_attempt_at = ${new Date(now)}
        FROM users
        WHERE challenges.id = ${recoveryId}
          AND users.id = challenges.user_id
          AND users.status = 'active'
          AND users.phone_verified_at IS NOT NULL
          AND challenges.verified_at IS NULL
          AND challenges.invalidated_at IS NULL
          AND challenges.expires_at > ${new Date(now)}
          AND challenges.attempt_count < 8
          AND NOT EXISTS (
            SELECT 1
            FROM account_deletion_requests
            WHERE user_id = users.id AND status <> 'completed'
          )
        RETURNING
          challenges.id,
          challenges.user_id AS "userId",
          challenges.attempt_count AS "attemptCount",
          challenges.expires_at AS "expiresAt",
          challenges.created_at AS "createdAt"
      `;
      if (!challenge) return null;
      const [user] = await transaction<UserRow[]>`
        SELECT ${this.#userColumns()}
        FROM users
        WHERE id = ${challenge.userId}
        FOR SHARE
      `;
      if (!user) return null;
      return {
        id: challenge.id,
        user: this.#mapUser(user),
        attemptCount: challenge.attemptCount,
        expiresAt: toIso(challenge.expiresAt),
        createdAt: toIso(challenge.createdAt)
      };
    });
  }

  async createPasswordRecoveryGrant(input: {
    id: string;
    recoveryId: string;
    userId: string;
    tokenHash: string;
    now: string;
    expiresAt: string;
  }) {
    return this.#sql.begin(async (transaction) => {
      const [challenge] = await transaction<{ id: string }[]>`
        SELECT challenges.id
        FROM password_recovery_challenges AS challenges
        JOIN users ON users.id = challenges.user_id
        WHERE challenges.id = ${input.recoveryId}
          AND challenges.user_id = ${input.userId}
          AND challenges.verified_at IS NULL
          AND challenges.invalidated_at IS NULL
          AND challenges.expires_at > ${new Date(input.now)}
          AND users.status = 'active'
          AND users.phone_verified_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM account_deletion_requests
            WHERE user_id = users.id AND status <> 'completed'
          )
        FOR UPDATE OF challenges
      `;
      if (!challenge) return false;
      await transaction`
        UPDATE password_recovery_challenges
        SET verified_at = ${new Date(input.now)}
        WHERE id = ${input.recoveryId}
      `;
      await transaction`
        INSERT INTO password_recovery_grants (
          id, challenge_id, user_id, token_hash,
          expires_at, consumed_at, created_at
        ) VALUES (
          ${input.id}, ${input.recoveryId}, ${input.userId}, ${input.tokenHash},
          ${new Date(input.expiresAt)}, ${null}, ${new Date(input.now)}
        )
      `;
      return true;
    }).catch((error) => {
      if (isUniqueViolation(error)) return false;
      throw error;
    });
  }

  async resetPasswordWithRecoveryGrant(input: {
    tokenHash: string;
    passwordHash: string;
    now: string;
  }) {
    return this.#sql.begin(async (transaction) => {
      const [candidate] = await transaction<PasswordRecoveryGrantRow[]>`
        SELECT
          id,
          challenge_id AS "recoveryId",
          user_id AS "userId",
          expires_at AS "expiresAt",
          consumed_at AS "consumedAt",
          invalidated_at AS "invalidatedAt"
        FROM password_recovery_grants
        WHERE token_hash = ${input.tokenHash}
      `;
      if (
        !candidate || candidate.consumedAt || candidate.invalidatedAt ||
        toIso(candidate.expiresAt) <= input.now
      ) return false;
      const [user] = await transaction<AdminUserRow[]>`
        SELECT id, role, status
        FROM users
        WHERE id = ${candidate.userId}
          AND status = 'active'
          AND phone_verified_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM account_deletion_requests
            WHERE user_id = users.id AND status <> 'completed'
          )
        FOR UPDATE
      `;
      if (!user) return false;
      const [grant] = await transaction<PasswordRecoveryGrantRow[]>`
        SELECT
          id,
          challenge_id AS "recoveryId",
          user_id AS "userId",
          expires_at AS "expiresAt",
          consumed_at AS "consumedAt",
          invalidated_at AS "invalidatedAt"
        FROM password_recovery_grants
        WHERE token_hash = ${input.tokenHash}
        FOR UPDATE
      `;
      if (
        !grant || grant.userId !== user.id || grant.consumedAt ||
        grant.invalidatedAt || toIso(grant.expiresAt) <= input.now
      ) return false;
      const now = new Date(input.now);
      await transaction`
        UPDATE users
        SET password_hash = ${input.passwordHash}, last_login_at = NULL
        WHERE id = ${grant.userId}
      `;
      const revokedSessions = await transaction<{ id: string }[]>`
        UPDATE sessions
        SET revoked_at = COALESCE(revoked_at, ${now})
        WHERE user_id = ${grant.userId}
          AND revoked_at IS NULL
          AND expires_at > ${now}
        RETURNING id
      `;
      if (revokedSessions.length > 0) {
        await this.#accountSessionEvent(transaction, {
          eventType: "session.all_revoked",
          actorUserId: grant.userId,
          targetSessionId: null,
          revokedSessionCount: revokedSessions.length,
          now
        });
      }
      await transaction`
        UPDATE password_recovery_grants
        SET consumed_at = ${now}
        WHERE id = ${grant.id}
      `;
      await transaction`
        INSERT INTO password_recovery_events (
          id, user_id, challenge_id, revoked_session_count, created_at
        ) VALUES (
          ${randomUUID()}, ${grant.userId}, ${grant.recoveryId},
          ${revokedSessions.length}, ${now}
        )
      `;
      return true;
    });
  }

  async createPhoneChangeChallenge(input: {
    id: string;
    userId: string;
    initiatingSessionId: string;
    expectedPasswordHash: string;
    newPhoneE164: string;
    now: string;
    expiresAt: string;
  }) {
    return this.#sql.begin(async (transaction) => {
      const now = new Date(input.now);
      const [user] = await transaction<UserRow[]>`
        SELECT ${this.#userColumns()}
        FROM users
        WHERE id = ${input.userId}
          AND password_hash = ${input.expectedPasswordHash}
          AND status = 'active'
          AND phone_verified_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM account_deletion_requests
            WHERE user_id = users.id AND status <> 'completed'
          )
        FOR UPDATE
      `;
      if (!user || user.phoneE164 === input.newPhoneE164) return false;
      const [session] = await transaction<{ id: string }[]>`
        SELECT id
        FROM sessions
        WHERE id = ${input.initiatingSessionId}
          AND user_id = ${input.userId}
          AND revoked_at IS NULL
          AND expires_at > ${now}
        FOR UPDATE
      `;
      if (!session) return false;
      await transaction`
        DELETE FROM phone_change_challenges
        WHERE created_at < ${new Date(now.getTime() - 30 * 24 * 60 * 60 * 1_000)}
      `;
      await transaction`
        UPDATE phone_change_challenges
        SET invalidated_at = ${now}
        WHERE user_id = ${input.userId}
          AND completed_at IS NULL
          AND invalidated_at IS NULL
      `;
      await transaction`
        INSERT INTO phone_change_challenges (
          id, user_id, initiating_session_id, new_phone_e164,
          attempt_count, expires_at, created_at
        ) VALUES (
          ${input.id}, ${input.userId}, ${input.initiatingSessionId},
          ${input.newPhoneE164}, 0, ${new Date(input.expiresAt)}, ${now}
        )
      `;
      return true;
    });
  }

  async invalidatePhoneChangeChallenge(
    phoneChangeId: string,
    userId: string,
    now: string
  ) {
    await this.#sql`
      UPDATE phone_change_challenges
      SET invalidated_at = COALESCE(invalidated_at, ${new Date(now)})
      WHERE id = ${phoneChangeId}
        AND user_id = ${userId}
        AND completed_at IS NULL
    `;
  }

  async consumePhoneChangeChallengeAttempt(input: {
    phoneChangeId: string;
    userId: string;
    sessionId: string;
    now: string;
  }) {
    return this.#sql.begin(async (transaction) => {
      const now = new Date(input.now);
      const [user] = await transaction<{ id: string }[]>`
        SELECT id
        FROM users
        WHERE id = ${input.userId}
          AND status = 'active'
          AND phone_verified_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM account_deletion_requests
            WHERE user_id = users.id AND status <> 'completed'
          )
        FOR UPDATE
      `;
      if (!user) return null;
      const [session] = await transaction<{ id: string }[]>`
        SELECT id
        FROM sessions
        WHERE id = ${input.sessionId}
          AND user_id = ${input.userId}
          AND revoked_at IS NULL
          AND expires_at > ${now}
        FOR UPDATE
      `;
      if (!session) return null;
      const [challenge] = await transaction<PhoneChangeChallengeRow[]>`
        UPDATE phone_change_challenges
        SET
          attempt_count = attempt_count + 1,
          last_attempt_at = ${now}
        WHERE id = ${input.phoneChangeId}
          AND user_id = ${input.userId}
          AND initiating_session_id = ${input.sessionId}
          AND completed_at IS NULL
          AND invalidated_at IS NULL
          AND expires_at > ${now}
          AND attempt_count < 8
        RETURNING
          id,
          user_id AS "userId",
          initiating_session_id AS "initiatingSessionId",
          new_phone_e164 AS "newPhoneE164",
          attempt_count AS "attemptCount",
          expires_at AS "expiresAt",
          created_at AS "createdAt"
      `;
      return challenge ? mapPhoneChangeChallenge(challenge) : null;
    });
  }

  async completePhoneChange(input: {
    phoneChangeId: string;
    userId: string;
    sessionId: string;
    now: string;
  }) {
    return this.#sql.begin(async (transaction) => {
      const now = new Date(input.now);
      const [user] = await transaction<UserRow[]>`
        SELECT ${this.#userColumns()}
        FROM users
        WHERE id = ${input.userId}
          AND status = 'active'
          AND phone_verified_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM account_deletion_requests
            WHERE user_id = users.id AND status <> 'completed'
          )
        FOR UPDATE
      `;
      if (!user) return null;
      const [session] = await transaction<{ id: string }[]>`
        SELECT id
        FROM sessions
        WHERE id = ${input.sessionId}
          AND user_id = ${input.userId}
          AND revoked_at IS NULL
          AND expires_at > ${now}
        FOR UPDATE
      `;
      if (!session) return null;
      const [challenge] = await transaction<PhoneChangeChallengeRow[]>`
        SELECT
          id,
          user_id AS "userId",
          initiating_session_id AS "initiatingSessionId",
          new_phone_e164 AS "newPhoneE164",
          attempt_count AS "attemptCount",
          expires_at AS "expiresAt",
          created_at AS "createdAt"
        FROM phone_change_challenges
        WHERE id = ${input.phoneChangeId}
          AND user_id = ${input.userId}
          AND initiating_session_id = ${input.sessionId}
          AND completed_at IS NULL
          AND invalidated_at IS NULL
          AND expires_at > ${now}
          AND attempt_count > 0
        FOR UPDATE
      `;
      if (!challenge) return null;
      const [updated] = await transaction<UserRow[]>`
        UPDATE users
        SET
          phone_e164 = ${challenge.newPhoneE164},
          phone_verified_at = ${now}
        WHERE id = ${input.userId}
        RETURNING ${this.#userColumns()}
      `;
      if (!updated) return null;
      const revokedSessions = await transaction<{ id: string }[]>`
        UPDATE sessions
        SET revoked_at = ${now}
        WHERE user_id = ${input.userId}
          AND id <> ${input.sessionId}
          AND revoked_at IS NULL
          AND expires_at > ${now}
        RETURNING id
      `;
      const invalidatedRecoveryChallenges = await transaction<{ id: string }[]>`
        UPDATE password_recovery_challenges
        SET invalidated_at = ${now}
        WHERE user_id = ${input.userId}
          AND invalidated_at IS NULL
        RETURNING id
      `;
      const invalidatedRecoveryGrants = await transaction<{ id: string }[]>`
        UPDATE password_recovery_grants
        SET invalidated_at = ${now}
        WHERE user_id = ${input.userId}
          AND consumed_at IS NULL
          AND invalidated_at IS NULL
        RETURNING id
      `;
      await transaction`
        UPDATE phone_change_challenges
        SET invalidated_at = ${now}
        WHERE user_id = ${input.userId}
          AND id <> ${input.phoneChangeId}
          AND completed_at IS NULL
          AND invalidated_at IS NULL
      `;
      await transaction`
        UPDATE phone_change_challenges
        SET completed_at = ${now}
        WHERE id = ${input.phoneChangeId}
      `;
      await transaction`
        INSERT INTO phone_change_events (
          id, user_id, challenge_id, revoked_session_count,
          invalidated_recovery_challenge_count,
          invalidated_recovery_grant_count, created_at
        ) VALUES (
          ${randomUUID()}, ${input.userId}, ${input.phoneChangeId},
          ${revokedSessions.length}, ${invalidatedRecoveryChallenges.length},
          ${invalidatedRecoveryGrants.length}, ${now}
        )
      `;
      return {
        user: this.#mapUser(updated),
        revokedSessionCount: revokedSessions.length,
        invalidatedRecoveryChallengeCount: invalidatedRecoveryChallenges.length,
        invalidatedRecoveryGrantCount: invalidatedRecoveryGrants.length
      };
    }).catch((error) => {
      if (isUniqueViolation(error)) return null;
      throw error;
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

  #accountDeletionColumns() {
    return this.#sql`
      id AS "requestId",
      user_id AS "userId",
      status AS "status",
      generation AS "generation",
      attempt_count AS "attemptCount",
      max_attempts AS "maxAttempts",
      run_after AS "runAfter",
      lease_owner AS "leaseOwner",
      leased_at AS "leasedAt",
      lease_expires_at AS "leaseExpiresAt",
      last_error_code AS "lastErrorCode",
      requested_at AS "requestedAt",
      updated_at AS "updatedAt",
      completed_at AS "completedAt"
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

  #mapAccountDeletion(row: AccountDeletionRow): AccountDeletionRequestRecord {
    return {
      requestId: row.requestId,
      userId: row.userId,
      status: row.status,
      generation: row.generation,
      attemptCount: row.attemptCount,
      maxAttempts: row.maxAttempts,
      requestedAt: toIso(row.requestedAt),
      updatedAt: toIso(row.updatedAt),
      nextAttemptAt: ["queued", "waiting_for_calls", "retrying"].includes(row.status)
        ? toIso(row.runAfter)
        : null,
      completedAt: row.completedAt ? toIso(row.completedAt) : null,
      lastErrorCode: row.lastErrorCode,
      leaseOwner: row.leaseOwner,
      leasedAt: row.leasedAt ? toIso(row.leasedAt) : null,
      leaseExpiresAt: row.leaseExpiresAt ? toIso(row.leaseExpiresAt) : null
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
