import { randomUUID } from "node:crypto";
import type { AuthRepository, AuthSessionRecord, AuthUserRecord, CreateAuthUserInput } from "./auth-repository";
import { AuthRepositoryError } from "./auth-repository";

export class InMemoryAuthRepository implements AuthRepository {
  readonly mode = "memory" as const;
  readonly #users = new Map<string, AuthUserRecord>();
  readonly #sessions = new Map<string, AuthSessionRecord>();

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

  async markPhoneVerified(userId: string, verifiedAt: string) {
    const user = this.#requireUser(userId);
    user.phoneVerifiedAt ??= verifiedAt;
    return structuredClone(user);
  }

  async updateLastLogin(userId: string, loggedInAt: string) {
    this.#requireUser(userId).lastLoginAt = loggedInAt;
  }

  async createSession(input: AuthSessionRecord) {
    this.#sessions.set(input.tokenHash, structuredClone(input));
  }

  async findUserBySessionTokenHash(tokenHash: string, now: string) {
    const session = this.#sessions.get(tokenHash);
    if (!session || session.revokedAt || session.expiresAt <= now) return null;
    const user = this.#users.get(session.userId);
    return user
      ? { user: structuredClone(user), session: structuredClone(session) }
      : null;
  }

  async revokeSession(tokenHash: string, revokedAt: string) {
    const session = this.#sessions.get(tokenHash);
    if (session) session.revokedAt ??= revokedAt;
  }

  async revokeUserSessions(userId: string, revokedAt: string) {
    for (const session of this.#sessions.values()) {
      if (session.userId === userId) session.revokedAt ??= revokedAt;
    }
  }

  async setUserStatusForTest(userId: string, status: AuthUserRecord["status"]) {
    this.#requireUser(userId).status = status;
  }

  async close() {}

  #requireUser(userId: string) {
    const user = this.#users.get(userId);
    if (!user) throw new AuthRepositoryError("USER_NOT_FOUND");
    return user;
  }
}
