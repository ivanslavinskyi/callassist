import { describe, expect, it, vi } from "vitest";
import { ApplicationRateLimiter, RateLimiterUnavailableError, type RateLimiter } from "../auth/rate-limiter";
import { MockVerificationProvider } from "../auth/verification-provider";
import { InMemoryRecipientOptOutStore } from "../storage/in-memory-recipient-opt-out-store";
import { RecipientOptOutService } from "./recipient-opt-out-service";

const phoneE164 = "+41791234567", context = { ip: "192.0.2.1" };
function fixture(eligible = true) {
  let now = Date.now(), blocked = false;
  const suppress = vi.fn(async () => { blocked = true; return true; });
  const store = new InMemoryRecipientOptOutStore(() => blocked, suppress, () => now);
  if (eligible) store.recordContact(store.hash(phoneE164));
  const provider = new MockVerificationProvider("123456");
  const send = vi.spyOn(provider,"send"), check = vi.spyOn(provider,"check");
  const service = new RecipientOptOutService({ repository: { recipientOptOut: store }, verificationProvider: provider });
  return { service, store, provider, send, check, suppress, block: () => { blocked=true; }, advance: (ms: number) => { now+=ms; } };
}

describe("recipient opt-out", () => {
  it("returns opaque challenges without sending or checking SMS for unknown recipients", async () => {
    const f=fixture(false);
    const result=await f.service.requestVerification({phoneE164},context);
    expect(result).toEqual({status:"verification_required",challengeToken:expect.stringMatching(/^[a-f0-9]{64}$/)});
    expect(f.send).not.toHaveBeenCalled();
    await expect(f.service.confirm({phoneE164,challengeToken:result.challengeToken,code:"123456"},context)).rejects.toMatchObject({code:"INVALID_OPT_OUT_VERIFICATION"});
    expect(f.check).not.toHaveBeenCalled(); expect(f.suppress).not.toHaveBeenCalled();
  });
  it("allows a retry after a wrong code, then consumes proof exactly once", async () => {
    const f=fixture();
    const {challengeToken}=await f.service.requestVerification({phoneE164},context);
    await expect(f.service.confirm({phoneE164,challengeToken,code:"999999"},context)).rejects.toMatchObject({code:"INVALID_OPT_OUT_VERIFICATION"});
    expect(f.suppress).not.toHaveBeenCalled();
    await expect(f.service.confirm({phoneE164,challengeToken,code:"123456"},context)).resolves.toEqual({status:"suppressed"});
    await expect(f.service.confirm({phoneE164,challengeToken,code:"123456"},context)).rejects.toMatchObject({code:"INVALID_OPT_OUT_VERIFICATION"});
    expect(f.suppress).toHaveBeenCalledTimes(1);
  });
  it("does not reveal or resend to an already suppressed number", async () => {
    const f=fixture(); f.block();
    expect(await f.service.requestVerification({phoneE164},context)).toMatchObject({status:"verification_required"});
    expect(f.send).not.toHaveBeenCalled();
  });
  it("acknowledges valid proof when staff blocked the phone during code verification", async () => {
    const f=fixture();
    const {challengeToken}=await f.service.requestVerification({phoneE164},context);
    f.check.mockImplementationOnce(async()=>{f.block();return true;});
    await expect(f.service.confirm({phoneE164,challengeToken,code:"123456"},context)).resolves.toEqual({status:"suppressed"});
    expect(f.suppress).not.toHaveBeenCalled();
  });
  it("rejects expired, mismatched and forged challenges before the provider", async () => {
    const f=fixture(); const {challengeToken}=await f.service.requestVerification({phoneE164},context);
    for(const input of [{phoneE164,challengeToken:"0".repeat(64),code:"123456"},{phoneE164:"+41791234568",challengeToken,code:"123456"}]) {
      await expect(f.service.confirm(input,context)).rejects.toMatchObject({code:"INVALID_OPT_OUT_VERIFICATION"});
    }
    f.advance(600_001);
    await expect(f.service.confirm({phoneE164,challengeToken,code:"123456"},context)).rejects.toMatchObject({code:"INVALID_OPT_OUT_VERIFICATION"});
    expect(f.check).not.toHaveBeenCalled();
  });
  it("does not accept an account verification code without an opt-out send", async () => {
    const f=fixture(); const accountProvider=new MockVerificationProvider("654321");
    await accountProvider.send(phoneE164);
    const {challengeToken}=await f.service.requestVerification({phoneE164},context);
    await expect(f.service.confirm({phoneE164,challengeToken,code:"654321"},context)).rejects.toMatchObject({code:"INVALID_OPT_OUT_VERIFICATION"});
    expect(f.suppress).not.toHaveBeenCalled();
  });
  it("reserves one concurrent send and one concurrent confirmation", async () => {
    const f=fixture();
    const requests=await Promise.all([f.service.requestVerification({phoneE164},context),f.service.requestVerification({phoneE164},context)]);
    expect(f.send).toHaveBeenCalledTimes(1);
    const confirmations=await Promise.allSettled(requests.flatMap(({challengeToken})=>[
      f.service.confirm({phoneE164,challengeToken,code:"123456"},context),f.service.confirm({phoneE164,challengeToken,code:"123456"},context)
    ]));
    expect(confirmations.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(f.check).toHaveBeenCalledTimes(1); expect(f.suppress).toHaveBeenCalledTimes(1);
  });
  it("does not activate uncertain SMS sends or leak provider errors", async () => {
    const f=fixture(); f.send.mockRejectedValueOnce(new Error("provider unavailable"));
    const {challengeToken}=await f.service.requestVerification({phoneE164},context);
    await expect(f.service.confirm({phoneE164,challengeToken,code:"123456"},context)).rejects.toMatchObject({code:"INVALID_OPT_OUT_VERIFICATION"});
    expect(f.check).not.toHaveBeenCalled();
  });
  it("fails closed if storage cannot establish eligibility", async () => {
    const f=fixture(); vi.spyOn(f.store,"reserve").mockRejectedValueOnce(new Error("database unavailable"));
    await expect(f.service.requestVerification({phoneE164},context)).rejects.toThrow("database unavailable");
    expect(f.send).not.toHaveBeenCalled();
  });
  it("limits attempts on unknown numbers too and fails closed without a shared limiter", async () => {
    const f=fixture(false);
    const service=new RecipientOptOutService({repository:{recipientOptOut:f.store},verificationProvider:f.provider,rateLimiter:new ApplicationRateLimiter(),
      rateLimitPolicy:{verificationSend:{phoneLimit:1,ipLimit:2,windowMs:60_000},verificationAttempt:{phoneLimit:8,ipLimit:20,windowMs:60_000}}});
    await service.requestVerification({phoneE164},context);
    await expect(service.requestVerification({phoneE164},context)).rejects.toMatchObject({code:"RATE_LIMITED"});
    const unavailable=async()=>{throw new RateLimiterUnavailableError();};
    const limiter: RateLimiter={mode:"postgres",shared:true,consume:unavailable,consumeMany:unavailable,getStatus:unavailable,async close(){}};
    const closed=new RecipientOptOutService({repository:{recipientOptOut:f.store},verificationProvider:f.provider,rateLimiter:limiter});
    await expect(closed.requestVerification({phoneE164},context)).rejects.toMatchObject({code:"RATE_LIMIT_UNAVAILABLE"});
    expect(f.send).not.toHaveBeenCalled();
  });
});
