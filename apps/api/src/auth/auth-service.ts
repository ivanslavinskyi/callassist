import type {
  AccountSessionBrowser,
  AccountSessionList,
  AccountSessionPlatform,
  AdministrableUserStatus,
  LoginInput,
  PhoneVerificationInput,
  RegistrationInput,
  User,
  VerificationResendInput
} from "@callassist/contracts";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  AuthRepositoryError,
  toPublicUser,
  type AuthRepository,
  type AuthUserRecord,
  type ListAdminUsersInput
} from "./auth-repository";
import { hashPassword, verifyPassword } from "./password";
import { ApplicationRateLimiter } from "./rate-limiter";
import type { VerificationProvider } from "./verification-provider";

const minute = 60_000;
const accountSessionInventoryLimit = 50;
const dummyPasswordHash = hashPassword("callassist-invalid-account-password");

export type AuthRequestContext = {
  ip: string;
  userAgent?: string;
};

export type AuthenticatedSession = {
  user: User;
  token: string;
  expiresAt: string;
};

export type SignupCreditGranter = {
  grantSignupCredits(userId: string): Promise<unknown>;
};

export class AuthService {
  readonly repository: AuthRepository;
  readonly verificationProvider: VerificationProvider;
  readonly #rateLimiter: ApplicationRateLimiter;
  readonly #now: () => Date;
  readonly #sessionTtlMs: number;
  readonly #signupCreditGranter: SignupCreditGranter;

  constructor(options: {
    repository: AuthRepository;
    verificationProvider: VerificationProvider;
    rateLimiter?: ApplicationRateLimiter;
    now?: () => Date;
    sessionTtlMs?: number;
    signupCreditGranter: SignupCreditGranter;
  }) {
    this.repository = options.repository;
    this.verificationProvider = options.verificationProvider;
    this.#rateLimiter = options.rateLimiter ?? new ApplicationRateLimiter();
    this.#now = options.now ?? (() => new Date());
    this.#sessionTtlMs = options.sessionTtlMs ?? 30 * 24 * 60 * minute;
    this.#signupCreditGranter = options.signupCreditGranter;
  }

  async register(input: RegistrationInput, context: AuthRequestContext) {
    this.#limit("register:ip", context.ip, 5, 60 * minute);
    this.#limit("register:email", input.email, 3, 60 * minute);
    this.#limit("register:phone", input.phoneE164, 3, 60 * minute);
    this.#limit("verification-send:phone", input.phoneE164, 3, 60 * minute);
    const passwordHash = await hashPassword(input.password);
    const { password: _password, ...profile } = input;
    let user: AuthUserRecord;
    try {
      user = await this.repository.createUser({ ...profile, passwordHash });
    } catch (error) {
      if (error instanceof AuthRepositoryError && error.code === "USER_ALREADY_EXISTS") {
        return { status: "verification_required" as const };
      }
      throw error;
    }
    try {
      await this.verificationProvider.send(user.phoneE164);
    } catch (error) {
      throw new AuthServiceError("VERIFICATION_UNAVAILABLE", { cause: error });
    }
    return { status: "verification_required" as const };
  }

  async resendVerification(
    input: VerificationResendInput,
    context: AuthRequestContext
  ) {
    this.#limit("verification-send:ip", context.ip, 10, 60 * minute);
    this.#limit("verification-send:email", input.email, 3, 60 * minute);
    const user = await this.repository.findUserByEmail(input.email);
    if (!user || user.phoneVerifiedAt || user.status !== "active") {
      return { status: "verification_required" as const };
    }
    this.#limit("verification-send:phone", user.phoneE164, 3, 60 * minute);
    try {
      await this.verificationProvider.send(user.phoneE164);
    } catch (error) {
      throw new AuthServiceError("VERIFICATION_UNAVAILABLE", { cause: error });
    }
    return { status: "verification_required" as const };
  }

  async verifyPhone(input: PhoneVerificationInput, context: AuthRequestContext) {
    this.#limit("verification-attempt:ip", context.ip, 20, 15 * minute);
    this.#limit("verification-attempt:email", input.email, 8, 15 * minute);
    const user = await this.repository.findUserByEmail(input.email);
    if (!user || user.status !== "active") {
      throw new AuthServiceError("INVALID_VERIFICATION");
    }
    this.#limit("verification-attempt:phone", user.phoneE164, 8, 15 * minute);
    let approved = false;
    try {
      approved = await this.verificationProvider.check(user.phoneE164, input.code);
    } catch (error) {
      throw new AuthServiceError("VERIFICATION_UNAVAILABLE", { cause: error });
    }
    if (!approved) throw new AuthServiceError("INVALID_VERIFICATION");
    const verified = await this.repository.markPhoneVerified(
      user.id,
      this.#now().toISOString()
    );
    await this.#signupCreditGranter.grantSignupCredits(verified.id);
    return this.#createSession(verified, context);
  }

  async login(input: LoginInput, context: AuthRequestContext) {
    this.#limit("login:ip", context.ip, 30, 15 * minute);
    this.#limit("login:email", input.email, 10, 15 * minute);
    const user = await this.repository.findUserByEmail(input.email);
    const passwordMatches = await verifyPassword(
      input.password,
      user?.passwordHash ?? (await dummyPasswordHash)
    );
    if (!user || !passwordMatches || user.status === "deleted") {
      throw new AuthServiceError("INVALID_CREDENTIALS");
    }
    if (user.status === "suspended") {
      throw new AuthServiceError("ACCOUNT_SUSPENDED");
    }
    if (!user.phoneVerifiedAt) {
      throw new AuthServiceError("PHONE_VERIFICATION_REQUIRED");
    }
    await this.#signupCreditGranter.grantSignupCredits(user.id);
    return this.#createSession(user, context);
  }

  async authenticate(token: string | undefined) {
    return (await this.authenticateSession(token))?.user ?? null;
  }

  async authenticateSession(token: string | undefined) {
    if (!token) return null;
    const result = await this.repository.findUserBySessionTokenHash(
      hashSessionToken(token),
      this.#now().toISOString()
    );
    if (!result || result.user.status !== "active" || !result.user.phoneVerifiedAt) {
      return null;
    }
    return {
      user: toPublicUser(result.user),
      sessionId: result.session.id
    };
  }

  async confirmOwnPassword(user: User, password: string) {
    const record = await this.repository.findUserByEmail(user.email);
    const matches = await verifyPassword(
      password,
      record?.passwordHash ?? (await dummyPasswordHash)
    );
    if (
      !record ||
      record.id !== user.id ||
      record.status !== "active" ||
      !matches
    ) {
      throw new AuthServiceError("INVALID_CREDENTIALS");
    }
  }

  async logout(token: string | undefined) {
    if (token) {
      await this.repository.revokeSession(
        hashSessionToken(token),
        this.#now().toISOString()
      );
    }
  }

  async revokeAllSessions(userId: string) {
    await this.repository.revokeUserSessions(
      userId,
      this.#now().toISOString()
    );
  }

  async listSessions(
    userId: string,
    currentSessionId: string
  ): Promise<AccountSessionList> {
    const result = await this.repository.listActiveSessions(
      userId,
      this.#now().toISOString(),
      accountSessionInventoryLimit,
      currentSessionId
    );
    return {
      sessions: result.sessions.map((session) => ({
        id: session.id,
        ...classifySessionClient(session.userAgent),
        current: session.id === currentSessionId,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt
      })),
      totalActive: result.totalActive,
      truncated: result.totalActive > result.sessions.length
    };
  }

  async revokeOwnSession(userId: string, sessionId: string) {
    const revoked = await this.repository.revokeSessionById(
      userId,
      sessionId,
      this.#now().toISOString()
    );
    if (!revoked) throw new AuthServiceError("SESSION_NOT_FOUND");
  }

  async listUsersAsAdmin(
    actor: User,
    input: Omit<ListAdminUsersInput, "actorUserId">
  ) {
    try {
      const result = await this.repository.listUsersForAdmin({
        ...input,
        actorUserId: actor.id
      });
      return result;
    } catch (error) {
      throw mapAdminRepositoryError(error);
    }
  }

  async findUserAsAdmin(actor: User, targetUserId: string) {
    try {
      return await this.repository.findUserByIdForAdmin(
        actor.id,
        targetUserId
      );
    } catch (error) {
      throw mapAdminRepositoryError(error);
    }
  }

  async changeAccountStatus(
    actor: User,
    targetUserId: string,
    status: AdministrableUserStatus,
    reason: string
  ) {
    try {
      return toPublicUser(await this.repository.changeAccountStatus({
        actorUserId: actor.id,
        targetUserId,
        status,
        reason
      }));
    } catch (error) {
      throw mapAdminRepositoryError(error);
    }
  }

  async revokeUserSessionsAsAdmin(
    actor: User,
    targetUserId: string,
    reason: string
  ) {
    try {
      await this.repository.revokeUserSessionsByAdmin({
        actorUserId: actor.id,
        targetUserId,
        reason
      });
    } catch (error) {
      throw mapAdminRepositoryError(error);
    }
  }

  async close() {
    await this.repository.close();
  }

  async #createSession(
    user: AuthUserRecord,
    context: AuthRequestContext
  ): Promise<AuthenticatedSession> {
    const now = this.#now();
    const expiresAt = new Date(now.getTime() + this.#sessionTtlMs).toISOString();
    const token = randomBytes(32).toString("base64url");
    try {
      await this.repository.createSession({
        id: randomUUID(),
        userId: user.id,
        tokenHash: hashSessionToken(token),
        expiresAt,
        revokedAt: null,
        createdAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        userAgent: context.userAgent?.slice(0, 300) ?? null
      });
    } catch (error) {
      if (
        error instanceof AuthRepositoryError &&
        error.code === "SESSION_CREATION_DENIED"
      ) {
        throw new AuthServiceError("ACCOUNT_SUSPENDED");
      }
      throw error;
    }
    await this.repository.updateLastLogin(user.id, now.toISOString());
    return { user: toPublicUser(user), token, expiresAt };
  }

  #limit(scope: string, identifier: string, limit: number, windowMs: number) {
    const result = this.#rateLimiter.consume(scope, identifier, limit, windowMs);
    if (!result.allowed) {
      throw new AuthServiceError("RATE_LIMITED", {
        retryAfterSeconds: result.retryAfterSeconds
      });
    }
  }
}

export class AuthServiceError extends Error {
  readonly retryAfterSeconds?: number;

  constructor(
    readonly code:
      | "INVALID_CREDENTIALS"
      | "PHONE_VERIFICATION_REQUIRED"
      | "ACCOUNT_SUSPENDED"
      | "INVALID_VERIFICATION"
      | "VERIFICATION_UNAVAILABLE"
      | "RATE_LIMITED"
      | "ADMIN_ACTION_FORBIDDEN"
      | "SELF_ADMIN_ACTION_FORBIDDEN"
      | "USER_NOT_FOUND"
      | "SESSION_NOT_FOUND"
      | "ACCOUNT_STATUS_UNCHANGED"
      | "ACCOUNT_STATUS_TRANSITION_INVALID",
    options?: { cause?: unknown; retryAfterSeconds?: number }
  ) {
    super(code, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AuthServiceError";
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

export function classifySessionClient(userAgent: string | null): {
  browser: AccountSessionBrowser;
  platform: AccountSessionPlatform;
} {
  const value = userAgent ?? "";
  const browser: AccountSessionBrowser = /(?:edg|edge|edga|edgios)\//i.test(value)
    ? "edge"
    : /(?:chrome|crios)\//i.test(value)
      ? "chrome"
      : /(?:firefox|fxios)\//i.test(value)
        ? "firefox"
        : /safari\//i.test(value) && /version\//i.test(value)
          ? "safari"
          : "other";
  const platform: AccountSessionPlatform = /android/i.test(value)
    ? "android"
    : /(?:iphone|ipad|ipod)/i.test(value)
      ? "ios"
      : /windows/i.test(value)
        ? "windows"
        : /(?:macintosh|mac os x)/i.test(value)
          ? "macos"
          : /linux/i.test(value)
            ? "linux"
            : "other";
  return { browser, platform };
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}

function mapAdminRepositoryError(error: unknown) {
  if (!(error instanceof AuthRepositoryError)) return error;
  switch (error.code) {
    case "ADMIN_ACTION_FORBIDDEN":
    case "SELF_ADMIN_ACTION_FORBIDDEN":
    case "USER_NOT_FOUND":
    case "ACCOUNT_STATUS_UNCHANGED":
    case "ACCOUNT_STATUS_TRANSITION_INVALID":
      return new AuthServiceError(error.code, { cause: error });
    default:
      return error;
  }
}
