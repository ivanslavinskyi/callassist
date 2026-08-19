import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryAuthRepository } from "../auth/in-memory-auth-repository";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { CreditService, hashPromoCode, parsePromoCodeHashKey } from "./credit-service";

describe("CreditService", () => {
  it("normalizes promo codes into a keyed hash", () => {
    const key = Buffer.alloc(32, 7);
    expect(hashPromoCode(" beta-2026 ", key)).toBe(
      hashPromoCode("BETA-2026", key)
    );
    expect(hashPromoCode("BETA-2026", key)).not.toContain("BETA");
    expect(parsePromoCodeHashKey(key.toString("base64"))).toEqual(key);
  });

  it("rejects self-grants before the ledger mutation", async () => {
    const authRepository = new InMemoryAuthRepository();
    const callRepository = new InMemoryCallRepository();
    const user = await authRepository.createUser({
      email: "admin@example.com",
      phoneE164: "+41790000001",
      firstName: "Ada",
      lastName: "Admin",
      uiLocale: "en",
      passwordHash: "test"
    });
    await authRepository.markPhoneVerified(user.id, new Date().toISOString());
    await authRepository.setUserRoleForTest(user.id, "admin");
    const actor = { ...user, role: "admin" as const, phoneVerifiedAt: new Date().toISOString() };
    const service = new CreditService({
      repository: callRepository,
      authRepository,
      hashKey: Buffer.alloc(32, 7)
    });
    await expect(service.grantAdminCredits(actor, {
      targetEmail: user.email,
      credits: 2,
      reason: "Self grant must fail",
      idempotencyKey: randomUUID()
    })).rejects.toMatchObject({ code: "CREDIT_SELF_GRANT_FORBIDDEN" });
  });
});
