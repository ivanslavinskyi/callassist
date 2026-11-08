import { randomUUID } from "node:crypto";
import { afterEach,describe,it,expect,vi } from "vitest";
import { NativeAppointmentCall } from "./native-appointment-call";
import { MemoryNativeLiveStore } from "../storage/native-live-store";
import { nativeAuthority,nativeProposal } from "../test-helpers/native-appointment";
import { speech } from "./voice-test-helpers";
import type { NativeAppointmentAuthorization } from "@callassist/contracts";
afterEach(()=>vi.useRealTimers());
async function fixture(authority:NativeAppointmentAuthorization=nativeAuthority){
 vi.useFakeTimers({toFake:["setTimeout","clearTimeout"]});const store=new MemoryNativeLiveStore(),callId=randomUUID(),attemptId=randomUUID(),marks:string[]=[];
 await store.reserve(callId,attemptId);const ports={store,callId,attemptId,snapshotHash:"a".repeat(64),representedPerson:"Nina Keller",locale:"en-GB",mark:(m:string)=>marks.push(m),trace:vi.fn()};
 const call=new NativeAppointmentCall(authority,ports);await call.restore();
 const proposal={...nativeProposal,operation:authority.operation,alternativeId:authority.alternatives.length?"preferred":null};
 const prepare=(intent="request")=>call.tool("prepare_appointment",{proposal,intent},()=>true);
 const result=(patch:Record<string,unknown>={})=>call.tool("record_appointment_result",{actionId:call.action!.id,episode:call.action!.episode,outcome:"confirmed",assistantQuote:"Please arrange Nina Keller for 16 September 2099 at 15:00.",recipientQuote:"Yes, Nina Keller is booked for that time.",latestRecipientQuote:"Yes, Nina Keller is booked for that time.",detailsMatch:true,previousAppointmentReleased:false,...(patch.recipientQuote?{latestRecipientQuote:patch.recipientQuote}:{}),...patch},()=>true);
 const readback=()=>{call.transcript("assistant","Please arrange Nina Keller for 16 September 2099 at 15:00.",1000,3000);call.audio(speech);};
 const ack=async()=>{await vi.advanceTimersByTimeAsync(1001);expect(marks.length).toBeGreaterThan(0);call.acknowledge(marks.at(-1)!);await call.settled();};
 return {call,store,ports,proposal,prepare,result,readback,ack,marks};
}
describe("native appointment journal",()=>{
 it("does not reuse a confirmed numeric result after a later correction at closing",async()=>{
  const h=await fixture({...nativeAuthority,limits:{finishBy:null,maxTotalPrice:{amount:100,currency:"CHF"}}});
  Object.assign(h.proposal,{totalPrice:{amount:90,currency:"CHF"},termsQuote:"90 CHF total."});h.call.transcript("recipient","90 CHF total.",0,900);
  await h.prepare();h.readback();h.call.transcript("recipient","Yes, Nina Keller is booked for that time.",3100,4000);await h.ack();
  expect(await h.result()).toMatchObject({ok:true,action:{state:"confirmed"}});
  h.call.transcript("recipient","Correction: 150 CHF total.",4100,5000);
  expect(await h.call.settled(true)).toMatchObject({state:"uncertain",confirmation:null});
 });
 it("saves observed numeric evidence and rejects a later price correction before confirming",async()=>{
  const h=await fixture({...nativeAuthority,limits:{finishBy:null,maxTotalPrice:{amount:100,currency:"CHF"}}});
  Object.assign(h.proposal,{totalPrice:{amount:90,currency:"CHF"},termsQuote:"90 CHF total."});
  h.call.transcript("recipient","90 CHF total.",0,900);
  expect(await h.prepare()).toMatchObject({ok:true});
  expect(h.call.action?.termsEvidence).toMatchObject({price:{kind:"amount",amount:90,currency:"CHF"},quote:"90 CHF total."});
  h.readback();h.call.transcript("recipient","Yes, Nina Keller is booked for that time.",3100,4000);await h.ack();
  h.call.transcript("recipient","Correction: 150 CHF total.",4100,5000);
  expect(await h.result({latestRecipientQuote:"Correction: 150 CHF total."})).toMatchObject({ok:false});
  expect(h.call.action?.state).toBe("delivered");
 });
 it("binds a result to the exact action and reconciliation episode without model-supplied hashes",async()=>{
  const h=await fixture();await h.prepare();h.readback();h.call.transcript("recipient","Yes, Nina Keller is booked for that time.",3100,4000);await h.ack();
  expect(await h.result({episode:2})).toMatchObject({reason:"action_mismatch",currentAction:{actionId:h.call.action!.id,episode:1}});
  expect(await h.result({actionId:randomUUID()})).toMatchObject({reason:"action_mismatch"});
  expect(h.call.action?.state).toBe("delivered");
  expect(await h.result()).toMatchObject({ok:true,action:{state:"confirmed"}});
 });
 it("records a confirmed result after an acknowledgment only when the latest speech is separately considered",async()=>{
  const h=await fixture();await h.prepare();h.readback();h.call.transcript("recipient","Yes, Nina Keller is booked for that time.",3100,4000);await h.ack();
  h.call.transcript("recipient"," Thank you, goodbye.",5100,6000);
  expect(await h.result()).toMatchObject({reason:"confirmation_not_established"});
  expect(await h.result({latestRecipientQuote:"Thank you, goodbye."})).toMatchObject({ok:true,action:{state:"confirmed"}});
 });
 it("does not confirm when fresh backend review observes a later substantive correction",async()=>{
  const h=await fixture();await h.prepare();h.readback();h.call.transcript("recipient","Yes, Nina Keller is booked for that time.",3100,4000);await h.ack();
  h.call.transcript("recipient"," Correction: the booking failed.",5100,6000);
  expect(await h.result({latestRecipientQuote:"Correction: the booking failed.",detailsMatch:false})).toMatchObject({reason:"confirmation_not_established"});
  expect(h.call.action?.state).toBe("delivered");
 });
 it("bounds a missing playback mark and wakes a pending result on shutdown",async()=>{
  const h=await fixture();await h.prepare();h.readback();h.call.transcript("recipient","Yes, Nina Keller is booked for that time.",3100,4000);
  const first=h.result();await vi.advanceTimersByTimeAsync(3001);expect(await first).toMatchObject({reason:"playback_pending"});
  const second=h.result();h.call.close();expect(await second).toMatchObject({reason:"stale_request"});await h.call.settled();
  expect(h.call.action?.state).toBe("uncertain");
 });
 it("accepts an explicit matching reply overlapping an approximate readback fragment",async()=>{
  const h=await fixture();await h.prepare();h.readback();h.call.transcript("recipient","Yes, Nina Keller is booked for that time.",2800,4000);await h.ack();
  expect(await h.result()).toMatchObject({ok:true,action:{state:"confirmed"}});h.call.close();
 });
 it("authorizes idempotently and records a rapid confirmation without forcing another question",async()=>{
  const h=await fixture();expect(await h.prepare()).toMatchObject({ok:true});const id=h.call.action!.id;
  await h.prepare();expect(h.call.action?.revision).toBe(1);expect(h.call.action?.id).toBe(id);
  h.readback();h.call.transcript("recipient","Yes, Nina Keller is booked for that time.",3100,4000);
  const pending=h.result();await h.ack();
  expect(await pending).toMatchObject({ok:true,action:{state:"confirmed",confirmation:{source:"recipient_statement",independentlyVerified:false}}});
  expect(await h.result()).toMatchObject({ok:true});expect(h.call.action?.revision).toBe(3);
  h.call.close();await h.call.settled();expect(h.call.action?.state).toBe("confirmed");
 });
 it("requires actual quotes and rejects wholly earlier, stale and unrelated confirmation",async()=>{
  const h=await fixture();await h.prepare();h.readback();await h.ack();
  expect(await h.result()).toMatchObject({reason:"observed_evidence_required"});
  h.call.transcript("recipient","Yes, Nina Keller is booked for that time.",0,900);
  expect(await h.result()).toMatchObject({reason:"confirmation_not_established"});
  h.call.transcript("recipient","Yes, Nina Keller is booked for that time.",4100,5000);
  expect(await h.result({detailsMatch:false})).toMatchObject({reason:"confirmation_not_established"});
  h.call.transcript("recipient","Wait, that is only availability.",5100,6000);
  expect(await h.result()).toMatchObject({reason:"confirmation_not_established"});
 });
 it("invalidates a pending playback mark on actual playback interruption",async()=>{
  const h=await fixture();await h.prepare();h.readback();await vi.advanceTimersByTimeAsync(1001);
  h.call.acknowledge(h.marks[0]!);h.call.interrupt();await h.call.settled();expect(h.call.action?.state).toBe("uncertain");
  expect(await h.prepare()).toMatchObject({reason:"status_check_required"});
  expect(await h.call.tool("prepare_appointment",{proposal:{...h.proposal,startTime:"16:00"},intent:"status_check"},()=>true)).toMatchObject({reason:"existing_action_requires_resolution"});
  expect(await h.prepare("status_check")).toMatchObject({ok:true,action:{intent:"status_check",episode:2}});
 });
 it("persists uncertainty on disconnect and restores it without making another request",async()=>{
  const h=await fixture();await h.prepare();h.readback();h.call.close();await h.call.settled();
  const resumed=new NativeAppointmentCall(nativeAuthority,h.ports);await resumed.restore();expect(resumed.action?.state).toBe("uncertain");
  expect(await resumed.tool("prepare_appointment",{proposal:h.proposal,intent:"request"},()=>true)).toMatchObject({reason:"status_check_required"});resumed.close();
 });
 it("restores conditional proposal evidence for a status enquiry without granting another commitment",async()=>{
  const authority={...nativeAuthority,requirements:[{id:"access",description:"Wheelchair access",sourceText:"Wheelchair access"}]};
  const h=await fixture(authority);h.call.transcript("recipient","Wheelchair access is available.",0,1000);
  const proposal={...h.proposal,requirements:[{id:"access",recipientQuote:"Wheelchair access is available."}]};
  expect(await h.call.tool("prepare_appointment",{proposal,intent:"request"},()=>true)).toMatchObject({ok:true});
  h.call.close();await h.call.settled();
  const resumed=new NativeAppointmentCall(authority,h.ports);await resumed.restore();
  expect(await resumed.tool("prepare_appointment",{proposal:h.proposal,intent:"request"},()=>true)).toMatchObject({ok:false});
  const result=await resumed.tool("prepare_appointment",{proposal:h.proposal,intent:"status_check"},()=>true);
  expect(result).toMatchObject({ok:true,action:{intent:"status_check",episode:2,proposal:{requirements:proposal.requirements}}});
  expect(await resumed.tool("prepare_appointment",{proposal:{...h.proposal,startTime:"16:00"},intent:"status_check"},()=>true)).toMatchObject({ok:false});resumed.close();
 });
 it("retains validated numeric terms across restart without asking for the old price quote",async()=>{
  const authority={...nativeAuthority,limits:{finishBy:null,maxTotalPrice:{amount:100,currency:"CHF"}}};
  const h=await fixture(authority);Object.assign(h.proposal,{totalPrice:{amount:90,currency:"CHF"},termsQuote:"90 CHF total."});
  h.call.transcript("recipient","90 CHF total.",0,900);await h.prepare();h.call.close();await h.call.settled();
  const resumed=new NativeAppointmentCall(authority,h.ports);await resumed.restore();
  expect(await resumed.tool("prepare_appointment",{proposal:h.proposal,intent:"status_check"},()=>true)).toMatchObject({ok:true});
  const question="Is Nina Keller already booked for 16 September 2099 at 15:00?",answer="Yes, Nina Keller is booked for that time.";
  resumed.transcript("assistant",question,1000,2000);resumed.audio(speech);resumed.transcript("recipient",answer,2100,3000);
  await vi.advanceTimersByTimeAsync(1001);resumed.acknowledge(h.marks.at(-1)!);await resumed.settled();
  expect(await resumed.tool("record_appointment_result",{actionId:resumed.action!.id,episode:resumed.action!.episode,outcome:"confirmed",assistantQuote:question,recipientQuote:answer,latestRecipientQuote:answer,detailsMatch:true,previousAppointmentReleased:false},()=>true)).toMatchObject({ok:true,action:{state:"confirmed"}});
  resumed.close();
 });
 it("cannot reuse an earlier decline after the provider corrects it",async()=>{
  const h=await fixture();await h.prepare();h.readback();h.call.transcript("recipient","That slot is unavailable.",3100,4000);
  h.call.transcript("recipient","Correction: it is available, and I have booked it.",4100,5000);
  expect(await h.result({outcome:"declined",recipientQuote:"That slot is unavailable."})).toMatchObject({reason:"decline_not_established"});
  expect(h.call.action?.state).toBe("authorized");
 });
 it("allows another proposal only after an explicit matching decline",async()=>{
  const h=await fixture();await h.prepare();h.readback();h.call.transcript("recipient","That slot is unavailable.",3100,4000);
  expect(await h.result({outcome:"declined",recipientQuote:"That slot is unavailable."})).toMatchObject({ok:true,action:{state:"declined"}});
  const previous=h.call.action!.id;expect(await h.call.tool("prepare_appointment",{proposal:{...h.proposal,startTime:"16:00"},intent:"request"},()=>true)).toMatchObject({ok:true});
  expect(h.call.action?.id).not.toBe(previous);
 });
 it("requires explicit replacement of the old appointment for a reschedule",async()=>{
  const h=await fixture({...nativeAuthority,operation:"reschedule",existingAppointment:{date:"2099-09-10",startTime:"12:00",reference:null}});
  await h.prepare();h.readback();h.call.transcript("recipient","Yes, Nina Keller is booked for that time.",3100,4000);await h.ack();
  expect(await h.result()).toMatchObject({reason:"confirmation_not_established"});
  expect(await h.result({previousAppointmentReleased:true})).toMatchObject({ok:true,action:{state:"confirmed"}});
 });
 it("fences stale results and all writes after refusal",async()=>{
  const h=await fixture();await h.prepare();h.readback();h.call.transcript("recipient","Yes, Nina Keller is booked for that time.",3100,4000);await h.ack();
  const save=h.store.saveAction.bind(h.store);let current=true;vi.spyOn(h.store,"saveAction").mockImplementation(async a=>{const r=await save(a);if(a.state==="confirmed")current=false;return r;});
  const args={actionId:h.call.action!.id,episode:h.call.action!.episode,outcome:"confirmed",assistantQuote:"Please arrange Nina Keller for 16 September 2099 at 15:00.",recipientQuote:"Yes, Nina Keller is booked for that time.",latestRecipientQuote:"Yes, Nina Keller is booked for that time.",detailsMatch:true,previousAppointmentReleased:false};
  expect(await h.call.tool("record_appointment_result",args,()=>current)).toMatchObject({reason:"stale_request",action:{state:"uncertain"}});
  await h.store.discard(h.ports.attemptId,"recording_refused");expect(await h.store.readAction(h.ports.attemptId)).toBeNull();
  await expect(h.prepare("status_check")).rejects.toThrow("LIVE_CONVERSATION_DISCARDED");
 });
});
