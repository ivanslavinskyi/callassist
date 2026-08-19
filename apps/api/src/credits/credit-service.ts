import type {
  AdminCreditGrantInput,
  PromoCodeCreateInput,
  PromoRedemptionInput,
  User
} from "@callassist/contracts";
import { createHmac } from "node:crypto";
import type { AuthRepository } from "../auth/auth-repository";
import type { CallRepository } from "../storage/call-repository";
import { CallRepositoryError } from "../storage/call-repository";

const KEY_LENGTH = 32;

export class CreditService {
  readonly #repository: CallRepository;
  readonly #authRepository: AuthRepository;
  readonly #hashKey: Buffer;
  readonly #now: () => Date;

  constructor(options: {
    repository: CallRepository;
    authRepository: AuthRepository;
    hashKey: Buffer;
    now?: () => Date;
  }) {
    if (options.hashKey.length !== KEY_LENGTH) {
      throw new Error("Promo code hash key must contain 32 bytes");
    }
    this.#repository = options.repository;
    this.#authRepository = options.authRepository;
    this.#hashKey = options.hashKey;
    this.#now = options.now ?? (() => new Date());
  }

  redeem(user: User, input: PromoRedemptionInput) {
    if (user.status !== "active" || !user.phoneVerifiedAt) {
      throw new CallRepositoryError("CREDIT_USER_NOT_FOUND");
    }
    return this.#repository.redeemPromo({
      codeHash: hashPromoCode(input.code, this.#hashKey),
      userId: user.id,
      idempotencyKey: input.idempotencyKey,
      now: this.#now().toISOString()
    });
  }

  createPromoCode(actor: User, input: PromoCodeCreateInput) {
    requireCreditAdministrator(actor);
    return this.#repository.createPromoCode({
      codeHash: hashPromoCode(input.code, this.#hashKey),
      credits: input.credits,
      globalRedemptionLimit: input.globalRedemptionLimit,
      perUserLimit: input.perUserLimit,
      startsAt: input.startsAt,
      expiresAt: input.expiresAt,
      active: input.active,
      campaign: input.campaign,
      actorUserId: actor.id,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      now: this.#now().toISOString()
    });
  }

  async grantAdminCredits(actor: User, input: AdminCreditGrantInput) {
    requireCreditAdministrator(actor);
    const target = await this.#authRepository.findUserByEmail(input.targetEmail);
    if (!target || target.status !== "active" || !target.phoneVerifiedAt) {
      throw new CallRepositoryError("CREDIT_USER_NOT_FOUND");
    }
    if (actor.id === target.id) {
      throw new CallRepositoryError("CREDIT_SELF_GRANT_FORBIDDEN");
    }
    if (actor.role !== "superadmin" && target.role !== "user") {
      throw new CallRepositoryError("CREDIT_ADMIN_ACTION_FORBIDDEN");
    }
    return this.#repository.grantAdminCredits({
      actorUserId: actor.id,
      targetUserId: target.id,
      credits: input.credits,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      now: this.#now().toISOString()
    });
  }
}

export function hashPromoCode(code: string, key: Buffer) {
  return createHmac("sha256", key)
    .update("callassist:promo-code:v1:")
    .update(code.trim().toUpperCase())
    .digest("hex");
}

export function parsePromoCodeHashKey(
  encoded: string | undefined,
  fallbackEncoded?: string
) {
  const value = encoded?.trim() || fallbackEncoded?.trim();
  if (!value) {
    throw new Error(
      "PROMO_CODE_HASH_KEY or DATA_ENCRYPTION_KEY is required for promo codes"
    );
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error("PROMO_CODE_HASH_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

function requireCreditAdministrator(actor: User) {
  if (
    actor.status !== "active" ||
    !actor.phoneVerifiedAt ||
    (actor.role !== "admin" && actor.role !== "superadmin")
  ) {
    throw new CallRepositoryError("CREDIT_ADMIN_ACTION_FORBIDDEN");
  }
}
