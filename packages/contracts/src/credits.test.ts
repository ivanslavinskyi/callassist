import { describe, expect, it } from "vitest";
import {
  adminCreditGrantInputSchema,
  promoCodeCreateInputSchema,
  promoRedemptionInputSchema
} from "./credits";

describe("credit operation contracts", () => {
  it("normalizes promo codes and requires an idempotency key", () => {
    expect(promoRedemptionInputSchema.parse({
      code: " beta-2026 ",
      idempotencyKey: "34a9354c-3976-4b58-9610-65f36fe9bc72"
    }).code).toBe("BETA-2026");
    expect(promoRedemptionInputSchema.safeParse({
      code: "short",
      idempotencyKey: "not-a-uuid"
    }).success).toBe(false);
  });

  it("bounds manual grants and rejects an inverted campaign window", () => {
    expect(adminCreditGrantInputSchema.safeParse({
      targetEmail: "USER@example.com",
      credits: 101,
      reason: "Manual beta grant",
      idempotencyKey: "34a9354c-3976-4b58-9610-65f36fe9bc72"
    }).success).toBe(false);
    expect(promoCodeCreateInputSchema.safeParse({
      code: "BETA-2026",
      credits: 2,
      globalRedemptionLimit: 100,
      perUserLimit: 1,
      startsAt: "2026-09-02T00:00:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z",
      active: true,
      campaign: "Public beta",
      reason: "Launch campaign",
      idempotencyKey: "34a9354c-3976-4b58-9610-65f36fe9bc72"
    }).success).toBe(false);
    expect(promoCodeCreateInputSchema.parse({
      code: "BETA-2026",
      credits: 2,
      globalRedemptionLimit: null,
      perUserLimit: 1,
      startsAt: "2026-09-01T02:00:00+02:00",
      expiresAt: null,
      active: true,
      campaign: "Public beta",
      reason: "Launch campaign",
      idempotencyKey: "34a9354c-3976-4b58-9610-65f36fe9bc72"
    }).startsAt).toBe("2026-09-01T00:00:00.000Z");
  });
});
