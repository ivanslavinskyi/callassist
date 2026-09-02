import type {
  AccountSessionBrowser,
  AccountSessionList,
  AccountSessionPlatform,
  AdministrableUserStatus,
  AccountNameUpdateInput,
  EmailChangeConfirmInput,
  EmailChangeStartInput,
  LoginInput,
  PasswordRecoveryCompleteInput,
  PasswordRecoveryStartInput,
  PasswordRecoveryVerifyInput,
  PhoneChangeConfirmInput,
  PhoneChangeStartInput,
  PhoneVerificationInput,
  RegistrationInput,
  User,
  VerificationResendInput
} from "@callassist/contracts";
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import {
  AuthRepositoryError,
  toPublicUser,
  type AuthRepository,
  type AuthUserRecord,
  type ListAdminUsersInput
} from "./auth-repository";
import { hashPassword, verifyPassword } from "./password";
import {
  ApplicationRateLimiter,
  RateLimiterUnavailableError,
  type RateLimitEntry,
  type RateLimiter
} from "./rate-limiter";
import type { VerificationProvider } from "./verification-provider";
import {
  MockEmailProvider,
  type EmailProvider
} from "./email-provider";
import { writePiiSafeOperationalError } from "../runtime/pii-safe-logger";

const minute = 60_000;
const accountSessionInventoryLimit = 50;
const passwordRecoveryChallengeTtlMs = 10 * minute;
const passwordRecoveryGrantTtlMs = 15 * minute;
const phoneChangeChallengeTtlMs = 10 * minute;
const emailChangeChallengeTtlMs = 10 * minute;
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
  readonly emailProvider: EmailProvider;
  readonly #rateLimiter: RateLimiter;
  readonly #now: () => Date;
  readonly #sessionTtlMs: number;
  readonly #signupCreditGranter: SignupCreditGranter;
  readonly #emailVerificationHashKey: Buffer;
  readonly #emailVerificationCode: () => string;

  constructor(options: {
    repository: AuthRepository;
    verificationProvider: VerificationProvider;
    emailProvider?: EmailProvider;
    emailVerificationHashKey?: Buffer;
    emailVerificationCode?: () => string;
    rateLimiter?: RateLimiter;
    now?: () => Date;
    sessionTtlMs?: number;
    signupCreditGranter: SignupCreditGranter;
  }) {
    this.repository = options.repository;
    this.verificationProvider = options.verificationProvider;
    this.emailProvider = options.emailProvider ?? new MockEmailProvider();
    this.#rateLimiter = options.rateLimiter ?? new ApplicationRateLimiter();
    this.#now = options.now ?? (() => new Date());
    this.#sessionTtlMs = options.sessionTtlMs ?? 30 * 24 * 60 * minute;
    this.#signupCreditGranter = options.signupCreditGranter;
    this.#emailVerificationHashKey = options.emailVerificationHashKey ??
      Buffer.alloc(32, 11);
    this.#emailVerificationCode = options.emailVerificationCode ??
      (() => String(randomInt(0, 1_000_000)).padStart(6, "0"));
  }

  async register(input: RegistrationInput, context: AuthRequestContext) {
    await this.#limitMany([
      limitEntry("register:ip", context.ip, 5, 60 * minute),
      limitEntry("register:email", input.email, 3, 60 * minute),
      limitEntry("register:phone", input.phoneE164, 3, 60 * minute),
      limitEntry("verification-send:phone", input.phoneE164, 3, 60 * minute)
    ]);
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
    await this.#limitMany([
      limitEntry("verification-send:ip", context.ip, 10, 60 * minute),
      limitEntry("verification-send:email", input.email, 3, 60 * minute)
    ]);
    const user = await this.repository.findUserByEmail(input.email);
    if (!user || user.phoneVerifiedAt || user.status !== "active") {
      return { status: "verification_required" as const };
    }
    await this.#limit("verification-send:phone", user.phoneE164, 3, 60 * minute);
    try {
      await this.verificationProvider.send(user.phoneE164);
    } catch (error) {
      throw new AuthServiceError("VERIFICATION_UNAVAILABLE", { cause: error });
    }
    return { status: "verification_required" as const };
  }

  async verifyPhone(input: PhoneVerificationInput, context: AuthRequestContext) {
    await this.#limitMany([
      limitEntry("verification-attempt:ip", context.ip, 20, 15 * minute),
      limitEntry("verification-attempt:email", input.email, 8, 15 * minute)
    ]);
    const user = await this.repository.findUserByEmail(input.email);
    if (!user || user.status !== "active") {
      throw new AuthServiceError("INVALID_VERIFICATION");
    }
    await this.#limit("verification-attempt:phone", user.phoneE164, 8, 15 * minute);
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
    await this.#limitMany([
      limitEntry("login:ip", context.ip, 30, 15 * minute),
      limitEntry("login:email", input.email, 10, 15 * minute)
    ]);
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
    return this.#createSession(user, context, user.passwordHash);
  }

  async startPasswordRecovery(
    input: PasswordRecoveryStartInput,
    context: AuthRequestContext
  ) {
    await this.#limitMany([
      limitEntry("password-recovery-start:ip", context.ip, 10, 60 * minute),
      limitEntry("password-recovery-start:email", input.email, 3, 60 * minute)
    ]);
    const recoveryId = randomUUID();
    const user = await this.repository.findUserByEmail(input.email);
    if (
      user?.status === "active" &&
      user.phoneVerifiedAt &&
      await this.#allowed(
        "password-recovery-start:phone",
        user.phoneE164,
        3,
        60 * minute
      )
    ) {
      const now = this.#now();
      try {
        const created = await this.repository.createPasswordRecoveryChallenge({
          id: recoveryId,
          userId: user.id,
          now: now.toISOString(),
          expiresAt: new Date(
            now.getTime() + passwordRecoveryChallengeTtlMs
          ).toISOString()
        });
        if (created) await this.verificationProvider.send(user.phoneE164);
      } catch {
        await this.repository.invalidatePasswordRecoveryChallenge(
          recoveryId,
          this.#now().toISOString()
        ).catch(() => undefined);
        writePiiSafeOperationalError("password_recovery_verification_send_failed");
      }
    }
    return { status: "verification_required" as const, recoveryId };
  }

  async verifyPasswordRecovery(
    input: PasswordRecoveryVerifyInput,
    context: AuthRequestContext
  ) {
    await this.#limitMany([
      limitEntry("password-recovery-verify:ip", context.ip, 20, 15 * minute),
      limitEntry(
        "password-recovery-verify:id",
        input.recoveryId,
        8,
        15 * minute
      )
    ]);
    const now = this.#now();
    const challenge = await this.repository.consumePasswordRecoveryChallengeAttempt(
      input.recoveryId,
      now.toISOString()
    );
    if (!challenge) throw new AuthServiceError("INVALID_RECOVERY");
    let approved = false;
    try {
      approved = await this.verificationProvider.check(
        challenge.user.phoneE164,
        input.code
      );
    } catch {
      writePiiSafeOperationalError("password_recovery_verification_check_failed");
      throw new AuthServiceError("INVALID_RECOVERY");
    }
    if (!approved) throw new AuthServiceError("INVALID_RECOVERY");
    const recoveryToken = randomBytes(32).toString("base64url");
    const created = await this.repository.createPasswordRecoveryGrant({
      id: randomUUID(),
      recoveryId: challenge.id,
      userId: challenge.user.id,
      tokenHash: hashPasswordRecoveryToken(recoveryToken),
      now: now.toISOString(),
      expiresAt: new Date(now.getTime() + passwordRecoveryGrantTtlMs).toISOString()
    });
    if (!created) throw new AuthServiceError("INVALID_RECOVERY");
    return {
      status: "password_reset_required" as const,
      recoveryToken
    };
  }

  async completePasswordRecovery(
    input: PasswordRecoveryCompleteInput,
    context: AuthRequestContext
  ) {
    const tokenHash = hashPasswordRecoveryToken(input.recoveryToken);
    await this.#limitMany([
      limitEntry(
        "password-recovery-complete:ip",
        context.ip,
        10,
        15 * minute
      ),
      limitEntry(
        "password-recovery-complete:token",
        tokenHash,
        3,
        15 * minute
      )
    ]);
    const passwordHash = await hashPassword(input.newPassword);
    const reset = await this.repository.resetPasswordWithRecoveryGrant({
      tokenHash,
      passwordHash,
      now: this.#now().toISOString()
    });
    if (!reset) throw new AuthServiceError("INVALID_RECOVERY");
    return { status: "password_reset" as const };
  }

  async startPhoneChange(
    user: User,
    sessionId: string,
    input: PhoneChangeStartInput,
    context: AuthRequestContext
  ) {
    await this.#limitMany([
      limitEntry("phone-change-start:ip", context.ip, 10, 60 * minute),
      limitEntry("phone-change-start:user", user.id, 3, 60 * minute),
      limitEntry(
        "phone-change-start:phone",
        input.newPhoneE164,
        3,
        60 * minute
      )
    ]);
    if (user.phoneE164 === input.newPhoneE164) {
      throw new AuthServiceError("PHONE_CHANGE_NOT_AVAILABLE");
    }
    const record = await this.confirmOwnPassword(user, input.currentPassword);
    const now = this.#now();
    const phoneChangeId = randomUUID();
    const created = await this.repository.createPhoneChangeChallenge({
      id: phoneChangeId,
      userId: user.id,
      initiatingSessionId: sessionId,
      expectedPasswordHash: record.passwordHash,
      newPhoneE164: input.newPhoneE164,
      now: now.toISOString(),
      expiresAt: new Date(
        now.getTime() + phoneChangeChallengeTtlMs
      ).toISOString()
    });
    if (!created) {
      throw new AuthServiceError("PHONE_CHANGE_NOT_AVAILABLE");
    }
    try {
      await this.verificationProvider.send(input.newPhoneE164);
    } catch (error) {
      await this.repository.invalidatePhoneChangeChallenge(
        phoneChangeId,
        user.id,
        this.#now().toISOString()
      ).catch(() => undefined);
      writePiiSafeOperationalError("phone_change_verification_send_failed");
      throw new AuthServiceError("VERIFICATION_UNAVAILABLE", { cause: error });
    }
    return { status: "verification_required" as const, phoneChangeId };
  }

  async confirmPhoneChange(
    user: User,
    sessionId: string,
    input: PhoneChangeConfirmInput,
    context: AuthRequestContext
  ) {
    await this.#limitMany([
      limitEntry("phone-change-confirm:ip", context.ip, 20, 15 * minute),
      limitEntry("phone-change-confirm:user", user.id, 8, 15 * minute),
      limitEntry("phone-change-confirm:id", input.phoneChangeId, 8, 15 * minute)
    ]);
    const now = this.#now();
    const challenge = await this.repository.consumePhoneChangeChallengeAttempt({
      phoneChangeId: input.phoneChangeId,
      userId: user.id,
      sessionId,
      now: now.toISOString()
    });
    if (!challenge) throw new AuthServiceError("INVALID_PHONE_CHANGE");
    await this.#limit(
      "phone-change-confirm:phone",
      challenge.newPhoneE164,
      8,
      15 * minute
    );
    let approved = false;
    try {
      approved = await this.verificationProvider.check(
        challenge.newPhoneE164,
        input.code
      );
    } catch (error) {
      writePiiSafeOperationalError("phone_change_verification_check_failed");
      throw new AuthServiceError("VERIFICATION_UNAVAILABLE", { cause: error });
    }
    if (!approved) throw new AuthServiceError("INVALID_PHONE_CHANGE");
    const completed = await this.repository.completePhoneChange({
      phoneChangeId: challenge.id,
      userId: user.id,
      sessionId,
      now: this.#now().toISOString()
    });
    if (!completed) {
      await this.repository.invalidatePhoneChangeChallenge(
        challenge.id,
        user.id,
        this.#now().toISOString()
      ).catch(() => undefined);
      throw new AuthServiceError("INVALID_PHONE_CHANGE");
    }
    return {
      status: "phone_changed" as const,
      user: toPublicUser(completed.user),
      revokedSessionCount: completed.revokedSessionCount
    };
  }

  async authenticate(token: string | undefined) {
    return (await this.authenticateSession(token))?.user ?? null;
  }

  async updateOwnName(user: User, input: AccountNameUpdateInput) {
    const updated = await this.repository.updateOwnName({
      userId: user.id,
      firstName: input.firstName,
      lastName: input.lastName
    });
    if (!updated) throw new AuthServiceError("PROFILE_UPDATE_NOT_AVAILABLE");
    return { status: "profile_updated" as const, user: toPublicUser(updated) };
  }

  async startEmailChange(
    user: User,
    sessionId: string,
    input: EmailChangeStartInput,
    context: AuthRequestContext
  ) {
    await this.#limitMany([
      limitEntry("email-change-start:ip", context.ip, 10, 60 * minute),
      limitEntry("email-change-start:user", user.id, 3, 60 * minute),
      limitEntry("email-change-start:email", input.newEmail, 3, 60 * minute)
    ]);
    if (user.email === input.newEmail) {
      throw new AuthServiceError("EMAIL_CHANGE_NOT_AVAILABLE");
    }
    const record = await this.confirmOwnPassword(user, input.currentPassword);
    const now = this.#now();
    const emailChangeId = randomUUID();
    const code = this.#emailVerificationCode();
    const expiresAt = new Date(now.getTime() + emailChangeChallengeTtlMs);
    const created = await this.repository.createEmailChangeChallenge({
      id: emailChangeId,
      userId: user.id,
      initiatingSessionId: sessionId,
      expectedPasswordHash: record.passwordHash,
      newEmail: input.newEmail,
      codeHash: hashEmailVerificationCode(
        emailChangeId,
        code,
        this.#emailVerificationHashKey
      ),
      now: now.toISOString(),
      expiresAt: expiresAt.toISOString()
    });
    if (!created) throw new AuthServiceError("EMAIL_CHANGE_NOT_AVAILABLE");
    try {
      await Promise.all([
        this.emailProvider.sendEmailChangeVerification({
          to: input.newEmail,
          code,
          expiresInMinutes: emailChangeChallengeTtlMs / minute,
          locale: user.uiLocale
        }),
        this.emailProvider.sendEmailChangeNotice({
          to: user.email,
          proposedEmail: input.newEmail,
          locale: user.uiLocale
        })
      ]);
    } catch (error) {
      await this.repository.invalidateEmailChangeChallenge(
        emailChangeId,
        user.id,
        this.#now().toISOString()
      ).catch(() => undefined);
      writePiiSafeOperationalError("email_change_delivery_failed");
      throw new AuthServiceError("EMAIL_DELIVERY_UNAVAILABLE", { cause: error });
    }
    return {
      status: "verification_required" as const,
      emailChangeId,
      expiresAt: expiresAt.toISOString()
    };
  }

  async confirmEmailChange(
    user: User,
    sessionId: string,
    input: EmailChangeConfirmInput,
    context: AuthRequestContext
  ) {
    await this.#limitMany([
      limitEntry("email-change-confirm:ip", context.ip, 20, 15 * minute),
      limitEntry("email-change-confirm:user", user.id, 8, 15 * minute),
      limitEntry("email-change-confirm:id", input.emailChangeId, 8, 15 * minute)
    ]);
    const now = this.#now();
    const challenge = await this.repository.consumeEmailChangeChallengeAttempt({
      emailChangeId: input.emailChangeId,
      userId: user.id,
      sessionId,
      now: now.toISOString()
    });
    if (!challenge) throw new AuthServiceError("INVALID_EMAIL_CHANGE");
    const actualHash = hashEmailVerificationCode(
      challenge.id,
      input.code,
      this.#emailVerificationHashKey
    );
    const expected = Buffer.from(challenge.codeHash, "hex");
    const actual = Buffer.from(actualHash, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new AuthServiceError("INVALID_EMAIL_CHANGE");
    }
    const completed = await this.repository.completeEmailChange({
      emailChangeId: challenge.id,
      userId: user.id,
      sessionId,
      now: this.#now().toISOString()
    });
    if (!completed) {
      await this.repository.invalidateEmailChangeChallenge(
        challenge.id,
        user.id,
        this.#now().toISOString()
      ).catch(() => undefined);
      throw new AuthServiceError("INVALID_EMAIL_CHANGE");
    }
    return {
      status: "email_changed" as const,
      user: toPublicUser(completed.user),
      revokedSessionCount: completed.revokedSessionCount
    };
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
    return record;
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
    context: AuthRequestContext,
    expectedPasswordHash?: string
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
        userAgent: context.userAgent?.slice(0, 300) ?? null,
        expectedPasswordHash
      });
    } catch (error) {
      if (
        error instanceof AuthRepositoryError &&
        error.code === "SESSION_CREATION_DENIED"
      ) {
        throw new AuthServiceError(
          expectedPasswordHash === undefined
            ? "ACCOUNT_SUSPENDED"
            : "INVALID_CREDENTIALS"
        );
      }
      throw error;
    }
    return { user: toPublicUser(user), token, expiresAt };
  }

  async #limit(scope: string, identifier: string, limit: number, windowMs: number) {
    return this.#limitMany([limitEntry(scope, identifier, limit, windowMs)]);
  }

  async #limitMany(entries: RateLimitEntry[]) {
    try {
      const result = await this.#rateLimiter.consumeMany(entries);
      if (!result.allowed) {
        throw new AuthServiceError("RATE_LIMITED", {
          retryAfterSeconds: result.retryAfterSeconds
        });
      }
    } catch (error) {
      if (error instanceof RateLimiterUnavailableError) {
        writePiiSafeOperationalError("auth_rate_limit_unavailable");
        throw new AuthServiceError("RATE_LIMIT_UNAVAILABLE", { cause: error });
      }
      throw error;
    }
  }

  async #allowed(
    scope: string,
    identifier: string,
    limit: number,
    windowMs: number
  ) {
    try {
      return (await this.#rateLimiter.consume(
        scope,
        identifier,
        limit,
        windowMs
      )).allowed;
    } catch (error) {
      if (error instanceof RateLimiterUnavailableError) {
        writePiiSafeOperationalError("auth_silent_rate_limit_unavailable");
        return false;
      }
      throw error;
    }
  }
}

function limitEntry(
  scope: string,
  identifier: string,
  limit: number,
  windowMs: number
): RateLimitEntry {
  return { scope, identifier, limit, windowMs };
}

export class AuthServiceError extends Error {
  readonly retryAfterSeconds?: number;

  constructor(
    readonly code:
      | "INVALID_CREDENTIALS"
      | "PHONE_VERIFICATION_REQUIRED"
      | "ACCOUNT_SUSPENDED"
      | "INVALID_VERIFICATION"
      | "INVALID_RECOVERY"
      | "VERIFICATION_UNAVAILABLE"
      | "RATE_LIMITED"
      | "RATE_LIMIT_UNAVAILABLE"
      | "INVALID_PHONE_CHANGE"
      | "PHONE_CHANGE_NOT_AVAILABLE"
      | "PROFILE_UPDATE_NOT_AVAILABLE"
      | "INVALID_EMAIL_CHANGE"
      | "EMAIL_CHANGE_NOT_AVAILABLE"
      | "EMAIL_DELIVERY_UNAVAILABLE"
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

export function hashPasswordRecoveryToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function hashEmailVerificationCode(
  challengeId: string,
  code: string,
  key: Buffer
) {
  return createHmac("sha256", key)
    .update(`${challengeId}:${code}`)
    .digest("hex");
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
