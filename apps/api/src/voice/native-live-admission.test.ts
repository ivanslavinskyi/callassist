import { afterEach, expect, it, vi } from "vitest";
import { CallService } from "../call-service";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import type { TelephonyProvider } from "../telephony/telephony-provider";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { OpenAILiveBridge } from "./openai-live-bridge";
import { flush, TestSocket } from "./voice-test-helpers";

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();vi.restoreAllMocks();});
async function fixture(){
  const provider:TelephonyProvider={mode:"twilio",startCall:vi.fn(async()=>({providerCallId:"CA-native",providerStatus:"queued"})),
    stopCall:vi.fn(async()=>{}),startRecording:vi.fn(),getRecordingMedia:vi.fn(),deleteRecording:vi.fn(),purgeCallRecordings:vi.fn(async()=>{})};
  const repository=new InMemoryCallRepository(),service=new CallService(repository,provider),live=new TestSocket();
  const runtime=new OpenAILiveBridge({service,apiKey:"fixture",nativeV2:true,agentHangupEnabled:true,validateStreamToken:()=>true,createLiveSocket:()=>live.ws});
  const brief=await service.create({recipientName:"Office",phoneNumber:"+41710000001",objective:"Ask whether the application was received.",
    representedPersonFirstName:"Nina",representedPersonLastName:"Keller",assistantProfileId:"anna",assistanceReason:"none",locale:"en-GB",audioRetentionDays:7,allowedFacts:[],allowLanguageSwitch:false});
  await service.approveCompilation(brief.id,await originalPlanReview(service,brief.id));
  cleanup.push(async()=>{runtime.close();live.receive({type:"session.closed",reason:"close_requested",usage:{seconds:0}});await flush();await service.close();});
  return{service,repository,provider,runtime,live,brief};
}
it("does not dial when Live rejects the complete startup context",async()=>{
  const h=await fixture(),starting=h.service.start(h.brief.id);
  const rejected=expect(starting).rejects.toMatchObject({code:"LIVE_CONTEXT_TOO_LARGE"});
  await flush();await flush();h.live.emit("open");
  expect(h.provider.startCall).not.toHaveBeenCalled();
  h.live.receive({type:"error",error:{code:"context_length_exceeded",param:"session.input"}});await rejected;
  expect(h.provider.startCall).not.toHaveBeenCalled();
  expect((await h.repository.getLatestAttempt(h.brief.id))?.status).toBe("failed");
});
it("dials only after admission and freezes the connection-recording intent before the provider request",async()=>{
  const h=await fixture(),starting=h.service.start(h.brief.id);await flush();await flush();h.live.emit("open");
  expect(h.provider.startCall).not.toHaveBeenCalled();h.live.startLive("admitted");await starting;
  expect(h.provider.startCall).toHaveBeenCalledTimes(1);
  const attempt=(await h.repository.getLatestAttempt(h.brief.id))!,privacy=await h.repository.nativeLive.get(attempt.id);
  expect(h.provider.startCall).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({nativeRecording:{recordingId:privacy!.recordingId}}));
  expect((await h.repository.get(h.brief.id))?.recording).toMatchObject({consentGrantedAt:null,recordingBasis:"declarative_local"});
  await h.repository.updateStatus(h.brief.id,"completed");
  await h.repository.updateStatus(h.brief.id,"ready");
  await expect(h.service.start(h.brief.id)).rejects.toMatchObject({code:"LIVE_NEW_CALL_REQUIRED"});
  expect(h.provider.startCall).toHaveBeenCalledTimes(1);
});

it("fences access during provider failure, retries after restart and reopens cleanup for late callbacks",async()=>{
  const h=await fixture(),starting=h.service.start(h.brief.id);
  await flush();await flush();h.live.emit("open");h.live.startLive("privacy-admission");await starting;
  const attempt=(await h.repository.getLatestAttempt(h.brief.id))!;
  const privacy=(await h.repository.nativeLive.get(attempt.id))!;
  const callback={callBriefId:h.brief.id,recordingId:privacy.recordingId,providerCallId:"CA-native",
    providerRecordingId:"RE-native",providerStatus:"completed" as const,durationSeconds:5,channels:2};
  await h.repository.applyRecordingStatus(callback);
  expect((await h.repository.get(h.brief.id))?.recording?.status).toBe("available");
  vi.mocked(h.provider.purgeCallRecordings!).mockRejectedValueOnce(new Error("provider unavailable"));
  await h.service.discardNativeConversation(h.brief.id,attempt.id,"recording_refused");await flush();
  expect((await h.repository.nativeLive.get(attempt.id))?.state).toBe("discard_requested");
  expect(await h.repository.nativeLive.pending()).toEqual([]); // durable backoff, not completion
  await expect(h.service.getRecordingMedia(h.brief.id)).rejects.toMatchObject({code:"RECORDING_NOT_AVAILABLE"});
  expect(h.provider.getRecordingMedia).not.toHaveBeenCalled();
  await h.service.close();
  const now=Date.now();vi.spyOn(Date,"now").mockReturnValue(now+31_000);
  const restarted=new CallService(h.repository,h.provider);cleanup.push(()=>restarted.close());
  await restarted.initialize();await flush();await flush();
  expect((await h.repository.nativeLive.get(attempt.id))?.state).toBe("discarded");
  expect(h.provider.purgeCallRecordings).toHaveBeenCalledTimes(2);
  const previousGeneration=(await h.repository.nativeLive.get(attempt.id))!.generation;
  vi.mocked(h.provider.stopCall).mockRejectedValueOnce(new Error("already completed"));
  h.provider.getCallStatus=vi.fn(async()=>({providerCallId:"CA-native",status:"completed" as const}));
  expect(await restarted.handleTwilioRecordingStatus(callback)).toBeNull();await flush();await flush();
  expect((await h.repository.nativeLive.get(attempt.id))?.generation).toBeGreaterThan(previousGeneration);
  expect(h.provider.purgeCallRecordings).toHaveBeenCalledTimes(3);
  expect(h.provider.getCallStatus).toHaveBeenCalledTimes(1);
  expect((await h.repository.get(h.brief.id))?.recording?.status).toBe("deleted");
});

it("stops the phone line even if the refusal transaction fails",async()=>{
  const h=await fixture(),starting=h.service.start(h.brief.id);
  await flush();await flush();h.live.emit("open");h.live.startLive("failure-admission");await starting;
  const attempt=(await h.repository.getLatestAttempt(h.brief.id))!;
  vi.spyOn(h.repository.nativeLive,"discard").mockRejectedValueOnce(new Error("database unavailable"));
  await expect(h.service.discardNativeConversation(h.brief.id,attempt.id,"conversation_refused")).rejects.toThrow("database unavailable");
  expect(h.provider.stopCall).toHaveBeenCalledWith("CA-native");
});
