import type {
  AccountDeletionRequest,
  AdministrableUserStatus,
  AdminUserSummary,
  RegistrationInput,
  User,
  UserRole,
  UserStatus
} from "@callassist/contracts";

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

export type CreateAuthSessionInput = AuthSessionRecord & {
  expectedPasswordHash?: string;
};

export type CreateAuthUserInput = Omit<RegistrationInput, "password"> & {
  passwordHash: string;
};

export type ListActiveSessionsResult = {
  sessions: AuthSessionRecord[];
  totalActive: number;
};

export type AccountAdminInput = {
  actorUserId: string;
  targetUserId: string;
  reason: string;
};

export type ChangeAccountStatusInput = AccountAdminInput & {
  status: AdministrableUserStatus;
};

export type AccountDataExportEventInput = {
  exportId: string;
  userId: string;
  schemaVersion: string;
  callCount: number;
  byteCount: number;
  createdAt: string;
};

export type AccountDeletionRequestRecord = AccountDeletionRequest & {
  userId: string;
  generation: number;
  leaseOwner: string | null;
  leasedAt: string | null;
  leaseExpiresAt: string | null;
};

export type ClaimAccountDeletionInput = {
  workerId: string;
  now: string;
  leaseExpiresAt: string;
};

export type AccountDeletionLeaseInput = {
  requestId: string;
  workerId: string;
  now: string;
};

export type FailAccountDeletionInput = AccountDeletionLeaseInput & {
  errorCode: string;
  retryAt: string;
};

export type RetryAccountDeletionInput = AccountAdminInput & {
  requestId: string;
  now: string;
};

export type PasswordRecoveryChallengeRecord = {
  id: string;
  user: AuthUserRecord;
  attemptCount: number;
  expiresAt: string;
  createdAt: string;
};

export type PhoneChangeChallengeRecord = {
  id: string;
  userId: string;
  initiatingSessionId: string;
  newPhoneE164: string;
  attemptCount: number;
  expiresAt: string;
  createdAt: string;
};

export type PhoneChangeCompletionRecord = {
  user: AuthUserRecord;
  revokedSessionCount: number;
  invalidatedRecoveryChallengeCount: number;
  invalidatedRecoveryGrantCount: number;
};

export type EmailChangeChallengeRecord = {
  id: string;
  userId: string;
  initiatingSessionId: string;
  newEmail: string;
  codeHash: string;
  attemptCount: number;
  expiresAt: string;
  createdAt: string;
};

export type EmailChangeCompletionRecord = {
  user: AuthUserRecord;
  previousEmail: string;
  revokedSessionCount: number;
  invalidatedRecoveryChallengeCount: number;
  invalidatedRecoveryGrantCount: number;
};

export type AdminUserCursor = { createdAt: string; id: string };

export type ListAdminUsersInput = {
  actorUserId: string;
  limit: number;
  search?: string;
  role?: UserRole;
  status?: UserStatus;
  cursor?: AdminUserCursor;
};

export type ListAdminUsersResult = {
  items: AdminUserSummary[];
  nextCursor: string | null;
};

export interface AuthRepository {
  readonly mode: "memory" | "postgres";
  createUser(input: CreateAuthUserInput): Promise<AuthUserRecord>;
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  updateOwnName(input: {
    userId: string;
    firstName: string;
    lastName: string;
  }): Promise<AuthUserRecord | null>;
  listUsersForAdmin(
    input: ListAdminUsersInput
  ): Promise<ListAdminUsersResult>;
  findUserByIdForAdmin(
    actorUserId: string,
    targetUserId: string
  ): Promise<AdminUserSummary>;
  markPhoneVerified(userId: string, verifiedAt: string): Promise<AuthUserRecord>;
  createSession(input: CreateAuthSessionInput): Promise<void>;
  findUserBySessionTokenHash(
    tokenHash: string,
    now: string
  ): Promise<{ user: AuthUserRecord; session: AuthSessionRecord } | null>;
  listActiveSessions(
    userId: string,
    now: string,
    limit: number,
    currentSessionId: string
  ): Promise<ListActiveSessionsResult>;
  revokeSession(tokenHash: string, revokedAt: string): Promise<void>;
  revokeSessionById(
    userId: string,
    sessionId: string,
    revokedAt: string
  ): Promise<boolean>;
  revokeUserSessions(userId: string, revokedAt: string): Promise<void>;
  changeAccountStatus(input: ChangeAccountStatusInput): Promise<AuthUserRecord>;
  revokeUserSessionsByAdmin(input: AccountAdminInput): Promise<void>;
  recordAccountDataExport(
    input: AccountDataExportEventInput
  ): Promise<void>;
  requestAccountDeletion(input: {
    requestId: string;
    userId: string;
    now: string;
    maxAttempts: number;
  }): Promise<AccountDeletionRequestRecord>;
  findAccountDeletionByUser(
    userId: string
  ): Promise<AccountDeletionRequestRecord | null>;
  claimAccountDeletion(
    input: ClaimAccountDeletionInput
  ): Promise<AccountDeletionRequestRecord | null>;
  renewAccountDeletionLease(input: AccountDeletionLeaseInput & {
    leaseExpiresAt: string;
  }): Promise<boolean>;
  deferAccountDeletionForActiveCall(input: AccountDeletionLeaseInput & {
    retryAt: string;
  }): Promise<boolean>;
  failAccountDeletion(input: FailAccountDeletionInput): Promise<boolean>;
  completeAccountDeletion(input: AccountDeletionLeaseInput): Promise<boolean>;
  retryAccountDeletion(input: RetryAccountDeletionInput): Promise<void>;
  createPasswordRecoveryChallenge(input: {
    id: string;
    userId: string;
    now: string;
    expiresAt: string;
  }): Promise<boolean>;
  invalidatePasswordRecoveryChallenge(
    recoveryId: string,
    now: string
  ): Promise<void>;
  consumePasswordRecoveryChallengeAttempt(
    recoveryId: string,
    now: string
  ): Promise<PasswordRecoveryChallengeRecord | null>;
  createPasswordRecoveryGrant(input: {
    id: string;
    recoveryId: string;
    userId: string;
    tokenHash: string;
    now: string;
    expiresAt: string;
  }): Promise<boolean>;
  resetPasswordWithRecoveryGrant(input: {
    tokenHash: string;
    passwordHash: string;
    now: string;
  }): Promise<boolean>;
  createPhoneChangeChallenge(input: {
    id: string;
    userId: string;
    initiatingSessionId: string;
    expectedPasswordHash: string;
    newPhoneE164: string;
    now: string;
    expiresAt: string;
  }): Promise<boolean>;
  invalidatePhoneChangeChallenge(
    phoneChangeId: string,
    userId: string,
    now: string
  ): Promise<void>;
  consumePhoneChangeChallengeAttempt(input: {
    phoneChangeId: string;
    userId: string;
    sessionId: string;
    now: string;
  }): Promise<PhoneChangeChallengeRecord | null>;
  completePhoneChange(input: {
    phoneChangeId: string;
    userId: string;
    sessionId: string;
    now: string;
  }): Promise<PhoneChangeCompletionRecord | null>;
  createEmailChangeChallenge(input: {
    id: string;
    userId: string;
    initiatingSessionId: string;
    expectedPasswordHash: string;
    newEmail: string;
    codeHash: string;
    now: string;
    expiresAt: string;
  }): Promise<boolean>;
  invalidateEmailChangeChallenge(
    emailChangeId: string,
    userId: string,
    now: string
  ): Promise<void>;
  consumeEmailChangeChallengeAttempt(input: {
    emailChangeId: string;
    userId: string;
    sessionId: string;
    now: string;
  }): Promise<EmailChangeChallengeRecord | null>;
  completeEmailChange(input: {
    emailChangeId: string;
    userId: string;
    sessionId: string;
    now: string;
  }): Promise<EmailChangeCompletionRecord | null>;
  close(): Promise<void>;
}

export function encodeAdminUserCursor(cursor: AdminUserCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeAdminUserCursor(value: string): AdminUserCursor | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { createdAt, id } = parsed as Record<string, unknown>;
    if (
      typeof createdAt !== "string" ||
      !Number.isFinite(Date.parse(createdAt)) ||
      typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export class AuthRepositoryError extends Error {
  constructor(
    readonly code:
      | "USER_ALREADY_EXISTS"
      | "USER_NOT_FOUND"
      | "SESSION_CREATION_DENIED"
      | "ADMIN_ACTION_FORBIDDEN"
      | "SELF_ADMIN_ACTION_FORBIDDEN"
      | "ACCOUNT_STATUS_UNCHANGED"
      | "ACCOUNT_STATUS_TRANSITION_INVALID"
      | "ACCOUNT_DELETION_NOT_AVAILABLE"
      | "ACCOUNT_DELETION_NOT_FOUND"
      | "ACCOUNT_DELETION_CALLS_REMAIN",
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
