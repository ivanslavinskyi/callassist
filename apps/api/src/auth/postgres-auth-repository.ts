import type { UserRole, UserStatus } from "@callassist/contracts";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import {
  AuthRepositoryError,
  type AuthRepository,
  type AuthSessionRecord,
  type AuthUserRecord,
  type CreateAuthUserInput
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
    await this.#sql`
      INSERT INTO sessions (
        id, user_id, token_hash, expires_at, revoked_at,
        created_at, last_seen_at, user_agent
      ) VALUES (
        ${input.id}, ${input.userId}, ${input.tokenHash}, ${new Date(input.expiresAt)},
        ${input.revokedAt ? new Date(input.revokedAt) : null},
        ${new Date(input.createdAt)}, ${new Date(input.lastSeenAt)}, ${input.userAgent}
      )
    `;
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

  async revokeSession(tokenHash: string, revokedAt: string) {
    await this.#sql`
      UPDATE sessions
      SET revoked_at = COALESCE(revoked_at, ${new Date(revokedAt)})
      WHERE token_hash = ${tokenHash}
    `;
  }

  async revokeUserSessions(userId: string, revokedAt: string) {
    await this.#sql`
      UPDATE sessions
      SET revoked_at = COALESCE(revoked_at, ${new Date(revokedAt)})
      WHERE user_id = ${userId}
    `;
  }

  async close() {
    await this.#sql.end({ timeout: 5 });
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

  #mapUser(row: UserRow): AuthUserRecord {
    return {
      ...row,
      phoneVerifiedAt: row.phoneVerifiedAt ? toIso(row.phoneVerifiedAt) : null,
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
