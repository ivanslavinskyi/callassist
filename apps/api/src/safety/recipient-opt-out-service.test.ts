import { describe, expect, it, vi } from "vitest";
import { ApplicationRateLimiter } from "../auth/rate-limiter";
import { MockVerificationProvider } from "../auth/verification-provider";
import {
  RecipientOptOutService,
  RecipientOptOutServiceError
} from "./recipient-opt-out-service";

describe("RecipientOptOutService", () => {
  it("suppresses only after the recipient proves control of the phone", async () => {
    const suppressRecipient = vi.fn().mockResolvedValue(true);
    const service = new RecipientOptOutService({
      repository: { suppressRecipient },
      verificationProvider: new MockVerificationProvider("123456")
    });

    await service.requestVerification(
      { phoneE164: "+41791234567" },
      { ip: "192.0.2.1" }
    );
    await expect(service.confirm(
      { phoneE164: "+41791234567", code: "000000" },
      { ip: "192.0.2.1" }
    )).rejects.toMatchObject({ code: "INVALID_OPT_OUT_VERIFICATION" });
    expect(suppressRecipient).not.toHaveBeenCalled();

    await expect(service.confirm(
      { phoneE164: "+41791234567", code: "123456" },
      { ip: "192.0.2.1" }
    )).resolves.toEqual({ status: "suppressed" });
    expect(suppressRecipient).toHaveBeenCalledWith({
      phoneE164: "+41791234567",
      source: "recipient_request",
      reason: "Recipient confirmed public opt-out by SMS",
      actorUserId: null
    });
  });

  it("atomically rate-limits verification sends by phone and IP", async () => {
    const service = new RecipientOptOutService({
      repository: { suppressRecipient: vi.fn().mockResolvedValue(true) },
      verificationProvider: new MockVerificationProvider(),
      rateLimiter: new ApplicationRateLimiter(() => 1_000),
      rateLimitPolicy: {
        verificationSend: { phoneLimit: 1, ipLimit: 2, windowMs: 60_000 },
        verificationAttempt: { phoneLimit: 1, ipLimit: 2, windowMs: 60_000 }
      }
    });
    await service.requestVerification(
      { phoneE164: "+41791234567" },
      { ip: "192.0.2.2" }
    );
    await expect(service.requestVerification(
      { phoneE164: "+41791234567" },
      { ip: "192.0.2.2" }
    )).rejects.toEqual(expect.objectContaining({
      code: "RATE_LIMITED",
      retryAfterSeconds: 60
    } satisfies Partial<RecipientOptOutServiceError>));
  });
});
