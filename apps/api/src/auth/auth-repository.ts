import type { RegistrationInput, User, UserRole, UserStatus } from "@callassist/contracts";

export type AuthUserRecord = User & { passwordHash: string };

export type AuthSessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string | null;
};

export type CreateAuthUserInput = Omit<RegistrationInput, "password"> & {
  passwordHash: string;
};

export interface AuthRepository {
  readonly mode: "memory" | "postgres";
  createUser(input: CreateAuthUserInput): Promise<AuthUserRecord>;
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  markPhoneVerified(userId: string, verifiedAt: string): Promise<AuthUserRecord>;
  updateLastLogin(userId: string, loggedInAt: string): Promise<void>;
  createSession(input: AuthSessionRecord): Promise<void>;
  findUserBySessionTokenHash(
    tokenHash: string,
    now: string
  ): Promise<{ user: AuthUserRecord; session: AuthSessionRecord } | null>;
  revokeSession(tokenHash: string, revokedAt: string): Promise<void>;
  revokeUserSessions(userId: string, revokedAt: string): Promise<void>;
  close(): Promise<void>;
}

export class AuthRepositoryError extends Error {
  constructor(
    readonly code: "USER_ALREADY_EXISTS" | "USER_NOT_FOUND",
    message = code
  ) {
    super(message);
    this.name = "AuthRepositoryError";
  }
}

export function toPublicUser(record: AuthUserRecord): User {
  const { passwordHash: _passwordHash, ...user } = record;
  return user;
}

export type MutableUserState = {
  role: UserRole;
  status: UserStatus;
};
