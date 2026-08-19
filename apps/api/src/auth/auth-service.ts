import type {
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
  type AuthUserRecord
} from "./auth-repository";
import { hashPassword, verifyPassword } from "./password";
import { ApplicationRateLimiter } from "./rate-limiter";
import type { VerificationProvider } from "./verification-provider";

const minute = 60_000;
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

export class AuthService {
  readonly repository: AuthRepository;
  readonly verificationProvider: VerificationProvider;
  readonly #rateLimiter: ApplicationRateLimiter;
  readonly #now: () => Date;
  readonly #sessionTtlMs: number;

  constructor(options: {
    repository: AuthRepository;
    verificationProvider: VerificationProvider;
    rateLimiter?: ApplicationRateLimiter;
    now?: () => Date;
    sessionTtlMs?: number;
  }) {
    this.repository = options.repository;
    this.verificationProvider = options.verificationProvider;
    this.#rateLimiter = options.rateLimiter ?? new ApplicationRateLimiter();
    this.#now = options.now ?? (() => new Date());
    this.#sessionTtlMs = options.sessionTtlMs ?? 30 * 24 * 60 * minute;
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
    return this.#createSession(user, context);
  }

  async authenticate(token: string | undefined) {
    if (!token) return null;
    const result = await this.repository.findUserBySessionTokenHash(
      hashSessionToken(token),
      this.#now().toISOString()
    );
    if (!result || result.user.status !== "active" || !result.user.phoneVerifiedAt) {
      return null;
    }
    return toPublicUser(result.user);
  }

  async logout(token: string | undefined) {
    if (token) {
      await this.repository.revokeSession(
        hashSessionToken(token),
        this.#now().toISOString()
      );
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
      | "RATE_LIMITED",
    options?: { cause?: unknown; retryAfterSeconds?: number }
  ) {
    super(code, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AuthServiceError";
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("base64url");
}
