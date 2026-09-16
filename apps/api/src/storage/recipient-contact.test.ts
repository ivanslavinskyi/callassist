import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeCreateCallBriefInput, type CreateCallBriefInput } from "@callassist/contracts";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { InMemoryCallRepository } from "./in-memory-call-repository";

export async function prepareContactCall(repository: import("./call-repository").CallRepository, phoneNumber: string, userId?: string) {
  const input: CreateCallBriefInput = {recipientName:"Recipient control test",phoneNumber,objective:"Ask when the office is open",assistantProfileId:"sebastian",representedPersonFirstName:"Nina",representedPersonLastName:"Keller",locale:"en-GB",allowLanguageSwitch:false,allowedFacts:[]};
  const brief=await repository.create(input,await new DeterministicBriefCompiler().compile(normalizeCreateCallBriefInput(input)),userId);
  await repository.approveCompilation(brief.id,await originalPlanReview(repository,brief.id));
  return brief;
}

describe("recipient contact evidence",()=>{
  it.each(["ringing","in-progress","completed","busy","no-answer"])("accepts confirmed Twilio %s without requiring a conversation or credit",async status=>{
    const repository=new InMemoryCallRepository(), phone="+41791234567";
    const brief=await prepareContactCall(repository,phone);
    const challenge={phoneE164:phone,tokenHash:"a".repeat(64)};
    expect(await repository.recipientOptOut.reserve(challenge)).toBe(false);
    const {attempt}=await repository.startAttempt(brief.id,{provider:"twilio"});
    await repository.attachProviderCall(attempt.id,`CA-${attempt.id}`,"queued");
    expect(await repository.recipientOptOut.reserve(challenge)).toBe(false);
    await repository.applyProviderStatus(`CA-${attempt.id}`,status,status==="ringing"?"dialing":status==="in-progress"?"in_progress":status==="completed"?"completed":"failed",brief.id);
    expect(await repository.recipientOptOut.reserve(challenge)).toBe(true);
  });
  it.each(["mock","failed","canceled"])("excludes %s without earlier contact",async status=>{
    const repository=new InMemoryCallRepository(), phone="+41791234567";
    const brief=await prepareContactCall(repository,phone);
    const {attempt}=await repository.startAttempt(brief.id,{provider:status==="mock"?"mock":"twilio"});
    await repository.attachProviderCall(attempt.id,`CA-${attempt.id}`,status==="mock"?"completed":status);
    expect(await repository.recipientOptOut.reserve({phoneE164:phone,tokenHash:"a".repeat(64)})).toBe(false);
  });
  it("retains evidence across late failure and deletion of the owner's call",async()=>{
    const repository=new InMemoryCallRepository(), phone="+41791234567", userId=randomUUID();
    await repository.grantSignupCredits(userId);
    const brief=await prepareContactCall(repository,phone,userId);
    const {attempt}=await repository.startAttempt(brief.id,{provider:"twilio",userId});
    await repository.attachProviderCall(attempt.id,`CA-${attempt.id}`,"ringing");
    await repository.applyProviderStatus(`CA-${attempt.id}`,"failed","failed",brief.id);
    await repository.deleteCallData({callId:brief.id,userId,requestId:randomUUID(),providerRecordingDisposition:"not_present",deletedAt:new Date().toISOString()});
    expect(await repository.recipientOptOut.reserve({phoneE164:phone,tokenHash:"a".repeat(64)})).toBe(true);
  });
});
