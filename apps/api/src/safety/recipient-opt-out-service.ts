import { VerificationSendError } from "../auth/bounded-verification-provider";
import { createHash, randomBytes } from "node:crypto";
import type {
  RecipientOptOutConfirmation,
  RecipientOptOutRequest
} from "@callassist/contracts";
import type { VerificationProvider } from "../auth/verification-provider";
import {
  ApplicationRateLimiter,
  RateLimiterUnavailableError,
  type RateLimiter
} from "../auth/rate-limiter";
import { writePiiSafeOperationalError } from "../runtime/pii-safe-logger";
import type { RecipientOptOutStore } from "./recipient-opt-out-store";

const minute = 60_000;

export type RecipientOptOutRateLimitPolicy = {
  verificationSend: { phoneLimit: number; ipLimit: number; windowMs: number };
  verificationAttempt: { phoneLimit: number; ipLimit: number; windowMs: number };
};

export const defaultRecipientOptOutRateLimitPolicy: RecipientOptOutRateLimitPolicy = {
  verificationSend: { phoneLimit: 3, ipLimit: 10, windowMs: 60 * minute },
  verificationAttempt: { phoneLimit: 8, ipLimit: 20, windowMs: 15 * minute }
};

type RecipientOptOutRepository = {
  recipientOptOut: RecipientOptOutStore;
};

export class RecipientOptOutService {
  readonly #repository: RecipientOptOutRepository;
  readonly #verificationProvider: VerificationProvider;
  readonly #rateLimiter: RateLimiter;
  readonly #rateLimitPolicy: RecipientOptOutRateLimitPolicy;

  constructor(options: {
    repository: RecipientOptOutRepository;
    verificationProvider: VerificationProvider;
    rateLimiter?: RateLimiter;
    rateLimitPolicy?: RecipientOptOutRateLimitPolicy;
  }) {
    this.#repository = options.repository;
    this.#verificationProvider = options.verificationProvider;
    this.#rateLimiter = options.rateLimiter ?? new ApplicationRateLimiter();
    this.#rateLimitPolicy = options.rateLimitPolicy ?? defaultRecipientOptOutRateLimitPolicy;
  }

  async requestVerification(
    input: RecipientOptOutRequest,
    context: { ip: string }
  ) {
    await this.#limit(
      "verification-send",
      input.phoneE164,
      context.ip,
      this.#rateLimitPolicy.verificationSend
    );
    const challengeToken = randomBytes(32).toString("hex");
    const challenge = { phoneE164: input.phoneE164, tokenHash: hashToken(challengeToken) };
    const response = { status: "verification_required" as const, challengeToken };
    if (!await this.#repository.recipientOptOut.reserve(challenge)) return response;
    try {
      await this.#verificationProvider.send(input.phoneE164, input.uiLocale);
      await this.#repository.recipientOptOut.activate(challenge);
    } catch (error) {
      // Keep eligibility private, including provider throttling/failure. Never retry an uncertain send.
      writePiiSafeOperationalError(error instanceof VerificationSendError ? "opt_out_sms_send_bounded" : "opt_out_sms_provider_failed");
    }
    return response;
  }

  async confirm(
    input: RecipientOptOutConfirmation,
    context: { ip: string }
  ) {
    await this.#limit(
      "verification-attempt",
      input.phoneE164,
      context.ip,
      this.#rateLimitPolicy.verificationAttempt
    );
    const challenge = { phoneE164: input.phoneE164, tokenHash: hashToken(input.challengeToken) };
    const claimId = await this.#repository.recipientOptOut.claim(challenge);
    if (!claimId) throw new RecipientOptOutServiceError("INVALID_OPT_OUT_VERIFICATION");
    let approved = false;
    try {
      approved = await this.#verificationProvider.check(
        input.phoneE164,
        input.code
      );
    } catch (error) {
      await this.#repository.recipientOptOut.finish(challenge, claimId, false);
      throw new RecipientOptOutServiceError("VERIFICATION_UNAVAILABLE", {
        cause: error
      });
    }
    if (!await this.#repository.recipientOptOut.finish(challenge, claimId, approved)) {
      throw new RecipientOptOutServiceError("INVALID_OPT_OUT_VERIFICATION");
    }
    return { status: "suppressed" as const };
  }

  async #limit(
    scope: string,
    phoneE164: string,
    ip: string,
    rule: { phoneLimit: number; ipLimit: number; windowMs: number }
  ) {
    let result;
    try {
      result = await this.#rateLimiter.consumeMany([
        {
          scope: `recipient-opt-out:${scope}:phone`,
          identifier: phoneE164,
          limit: rule.phoneLimit,
          windowMs: rule.windowMs
        },
        {
          scope: `recipient-opt-out:${scope}:ip`,
          identifier: ip,
          limit: rule.ipLimit,
          windowMs: rule.windowMs
        }
      ]);
    } catch (error) {
      if (error instanceof RateLimiterUnavailableError) {
        writePiiSafeOperationalError("recipient_opt_out_rate_limit_unavailable");
        throw new RecipientOptOutServiceError("RATE_LIMIT_UNAVAILABLE", {
          cause: error
        });
      }
      throw error;
    }
    if (!result.allowed) {
      throw new RecipientOptOutServiceError("RATE_LIMITED", {
        retryAfterSeconds: result.retryAfterSeconds
      });
    }
  }
}

function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }

export class RecipientOptOutServiceError extends Error {
  readonly retryAfterSeconds?: number;

  constructor(
    readonly code:
      | "INVALID_OPT_OUT_VERIFICATION"
      | "VERIFICATION_UNAVAILABLE"
      | "RATE_LIMITED"
      | "RATE_LIMIT_UNAVAILABLE",
    options?: { cause?: unknown; retryAfterSeconds?: number }
  ) {
    super(code, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "RecipientOptOutServiceError";
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}
