import { afterEach, describe, expect, it, vi } from "vitest";
import { approvedCall, authorization, flush, speech, silence, TestSocket } from "./voice-test-helpers";
import { NativeLiveV2Call } from "./native-live-v2-call";
import { nativeV2Session } from "./live-task-context";
import { LiveProtocolTrace } from "./live-protocol-trace";
import { MemoryNativeLiveStore } from "../storage/native-live-store";
import { nativeProposal } from "../test-helpers/native-appointment";
import { voiceRuntimeMode } from "../config/voice-runtime";
import { NATIVE_COMPLETION_TIMING } from "./live-native-completion";
import { NATIVE_TRACE_DRAIN_MS } from "./live-native-configuration";
import type { CallLocale } from "@callassist/contracts";

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();vi.useRealTimers();});
async function fixture(withAppointment=false,objective?:string,appointmentAuthority=authorization,locale:CallLocale="en-GB"){
  vi.useFakeTimers({toFake:["setTimeout","clearTimeout","setInterval","clearInterval"]});
  const h=await approvedCall(withAppointment?appointmentAuthority:undefined,undefined,locale,undefined,undefined,undefined,undefined,objective);const live=new TestSocket(),twilio=new TestSocket();live.autoAcknowledge=true;
  await h.repository.nativeLive.reserve(h.brief.id,h.attempt.id);
  await h.repository.nativeLive.bind(h.attempt.id,"CA-LIVE");
  const tts=vi.fn<typeof fetch>(),hangup=vi.spyOn(h.service,"prepareAgentHangup").mockResolvedValue(true);
  const call=new NativeLiveV2Call({service:h.service,apiKey:"fixture",agentHangupEnabled:true,nativeV2:true,
    createLiveSocket:()=>live.ws,speechFetch:tts,validateStreamToken:(_binding,token)=>token==="valid"});
  cleanup.push(async()=>{call.dispose();live.receive({type:"session.closed",reason:"close_requested",usage:{seconds:2}});await flush();await h.service.close();});
  const preflight=call.preflight(h.brief.id,h.attempt.id);await flush();live.emit("open");live.startLive("v2-session");await preflight;
  const attach=async()=>{
    await h.repository.transitionAnswering(h.brief.id,{attemptId:h.attempt.id,providerCallId:"CA-LIVE",snapshotHash:h.snapshot.compilationSnapshotHash,
      kind:"resolve",answeredBy:"human",now:new Date().toISOString()});
    call.attach(twilio.ws);twilio.receive({event:"start",start:{callSid:"CA-LIVE",streamSid:"MZ",customParameters:{callBriefId:h.brief.id,
      callAttemptId:h.attempt.id,compilationSnapshotHash:h.snapshot.compilationSnapshotHash,streamToken:"valid"}}});await flush();await flush();
  };
  return{...h,live,twilio,call,tts,hangup,attach};
}
describe("native Live v2",()=>{
  it("updates a closing decision after a reciprocal goodbye without another assistant phrase",async()=>{
    const h=await fixture();await h.attach();
    h.call.transcript("recipient","At nine.",0,500,()=>{});
    h.call.transcript("assistant","The office opens at nine.",600,1600,()=>{});h.call.audio(speech);
    const farewell="Thank you, goodbye.";
    h.call.transcript("assistant",farewell,1600,2600,()=>{});h.call.audio(speech);
    const end=(recipientQuote:string)=>h.call.tool({name:"end_call",arguments:JSON.stringify({reason:"objective_resolved",closingQuote:farewell,recipientQuote,noActionRequired:null})},()=>true);
    expect(await end("At nine.")).toMatchObject({ok:true});
    await vi.advanceTimersByTimeAsync(1001);const oldMark=h.twilio.sent.filter(e=>e.event==="mark").at(-1);
    h.call.activity("started");h.call.transcript("recipient","Goodbye.",2800,3300,()=>{});h.call.activity("stopped");
    h.twilio.receive(oldMark);await vi.advanceTimersByTimeAsync(351);expect(h.hangup).not.toHaveBeenCalled();
    expect(await end("At nine.")).toMatchObject({reason:"latest_recipient_evidence_required"});
    expect(await end("Goodbye.")).toMatchObject({ok:true});
    await vi.advanceTimersByTimeAsync(1001);h.twilio.receive(h.twilio.sent.filter(e=>e.event==="mark").at(-1));
    await vi.advanceTimersByTimeAsync(351);await flush();expect(h.hangup).toHaveBeenCalledTimes(1);
    expect(h.live.sent.filter(e=>e.type==="session.commentary.append")).toHaveLength(1);
  });
  it("reconciles a changed date, records one replacement and hangs up after playback without extra reviews",async()=>{
    const h=await fixture(true,undefined,{...authorization,windows:[...authorization.windows,{date:"2099-09-17",startTime:"09:00",endTime:"17:00"}]});await h.attach();
    const invoke=(name:string,args:object)=>h.call.tool({name,arguments:JSON.stringify(args)},()=>true);
    const readback=async(text:string,start:number)=>{h.call.transcript("assistant",text,start,start+800,()=>{});h.call.audio(speech);await vi.advanceTimersByTimeAsync(1001);h.twilio.receive(h.twilio.sent.filter(e=>e.event==="mark"&&e.mark.name.startsWith("native-action:")).at(-1));await flush();};
    h.call.transcript("recipient","The sixteenth at three is available.",0,500,()=>{});
    const first=await invoke("prepare_appointment",{proposal:{...nativeProposal,alternativeId:"approved"},intent:"request"});const old=first.action as any;
    const request="Please book Nina Keller for 16 September 2099 at 15:00.";await readback(request,1000);
    const correction="No, instead 17 September at 10:00.";h.call.transcript("recipient",correction,2100,2900,()=>{});
    expect(await invoke("record_appointment_result",{actionId:old.id,episode:1,outcome:"declined",assistantQuote:request,recipientQuote:correction,latestRecipientQuote:correction,detailsMatch:true,previousAppointmentReleased:false})).toMatchObject({ok:true});
    const second=await invoke("prepare_appointment",{proposal:{...nativeProposal,alternativeId:"approved",date:"2099-09-17",startTime:"10:00"},intent:"request"});const next=second.action as any;expect(second.ok).toBe(true);expect(next.id).not.toBe(old.id);
    const nextRequest="Please book Nina Keller for 17 September 2099 at 10:00.";await readback(nextRequest,3000);
    h.call.transcript("recipient","Yes, booked.",4100,4500,()=>{});
    expect(await invoke("record_appointment_result",{actionId:next.id,episode:1,outcome:"confirmed",assistantQuote:nextRequest,recipientQuote:"Yes, booked.",latestRecipientQuote:"Yes, booked.",detailsMatch:true,previousAppointmentReleased:false})).toMatchObject({ok:true});
    const closing="Nina Keller is booked for 17 September at ten. Thank you, goodbye.";
    h.call.transcript("assistant",closing,5000,6000,()=>{});h.call.audio(speech);
    expect(await invoke("end_call",{reason:"objective_resolved",closingQuote:closing,recipientQuote:"Yes, booked.",noActionRequired:null})).toMatchObject({ok:true});
    await vi.advanceTimersByTimeAsync(1001);h.twilio.receive(h.twilio.sent.filter(e=>e.event==="mark").at(-1));await vi.advanceTimersByTimeAsync(351);await flush();
    expect(h.hangup).toHaveBeenCalledTimes(1);expect(h.live.sent.filter(e=>e.type==="response.create")).toHaveLength(0);
    expect(await h.repository.nativeLive.readAction(h.attempt.id)).toMatchObject({state:"confirmed",proposal:{date:"2099-09-17",startTime:"10:00"}});
  });
  it("preserves useful speech and evidence while native delegation is still running",async()=>{
    const h=await fixture();await h.attach();
    h.live.receive({type:"session.input_transcript.delta",delta:"Margherita.",start_ms:0,end_ms:500});
    h.live.receive({type:"session.delegation.created",offset_ms:600,delegation:{id:"overlap",response_id:"overlap-response"}});
    h.live.receive({type:"response.event",delegation_id:"overlap",event:{type:"response.created",response:{id:"overlap-response"}}});
    const quote="You would like Margherita. Thank you, goodbye.";
    h.live.receive({type:"session.output_transcript.delta",delta:quote,start_ms:800,end_ms:2000});
    h.live.receive({type:"session.output_audio.delta",delta:speech});
    expect(h.twilio.sent.filter(e=>e.event==="media")).toHaveLength(1);
    h.live.receive({type:"response.event",delegation_id:"overlap",event:{type:"response.output_item.done",response_id:"overlap-response",item:{type:"function_call",call_id:"overlap-end",name:"end_call",arguments:JSON.stringify({reason:"objective_resolved",closingQuote:quote,recipientQuote:"Margherita.",noActionRequired:null})}}});
    h.live.receive({type:"response.event",delegation_id:"overlap",event:{type:"response.completed",response:{id:"overlap-response",status:"completed",output:[]}}});
    for(let i=0;i<8;i++)await flush();
    expect(JSON.parse(h.live.sent.find(e=>e.item?.call_id==="overlap-end").item.output)).toMatchObject({ok:true});
    expect((await h.repository.get(h.brief.id))!.transcript.map(s=>s.text).join(" ")).toContain(quote);
    await vi.advanceTimersByTimeAsync(1001);
    const mark=h.twilio.sent.find(e=>e.event==="mark");expect(mark).toBeTruthy();
    h.twilio.receive(mark);await vi.advanceTimersByTimeAsync(351);await flush();
    expect(h.hangup).toHaveBeenCalledTimes(1);
  });
  it("does not clip a conclusion that starts during an automatic quiet review",async()=>{
    const h=await fixture();await h.attach();
    h.live.receive({type:"session.input_transcript.delta",delta:"Margherita.",start_ms:0,end_ms:500});
    h.live.receive({type:"session.output_transcript.delta",delta:"Understood.",start_ms:600,end_ms:800});
    h.live.receive({type:"session.output_audio.delta",delta:speech});
    await vi.advanceTimersByTimeAsync(NATIVE_COMPLETION_TIMING.quietEpisodeMs+1);
    const command=h.live.sent.find(e=>e.type==="response.create");expect(command).toBeDefined();
    const quote="You would like Margherita. Thank you, goodbye.";
    const before=h.twilio.sent.filter(e=>e.event==="media").length;
    h.live.receive({type:"session.output_transcript.delta",delta:quote,start_ms:7000,end_ms:9000});
    h.live.receive({type:"session.output_audio.delta",delta:speech});
    expect(h.twilio.sent.filter(e=>e.event==="media")).toHaveLength(before+1);
    await backendReply(h,"overlapping-review",{closingQuote:quote,recipientQuote:"Margherita."});
    expect(JSON.parse(h.live.sent.find(e=>e.item?.call_id==="overlapping-review-end").item.output)).toMatchObject({ok:true});
    h.live.receive({type:"session.input_transcript.delta",delta:"Actually, a correction.",start_ms:9500,end_ms:10000});
    h.live.receive({type:"session.output_audio.delta",delta:speech});
    expect(h.twilio.sent.filter(e=>e.event==="media")).toHaveLength(before+2);
    await vi.advanceTimersByTimeAsync(1400);expect(h.hangup).not.toHaveBeenCalled();
  });
  it("repairs appointment-only closing evidence to null for a general task without repeating speech",async()=>{
    const h=await fixture();await h.attach();
    const answer="Margherita.",closing="Sie möchten Pizza Margherita. Vielen Dank und auf Wiederhören.";
    h.call.transcript("recipient",answer,0,1000,()=>{});h.call.transcript("assistant",closing,1000,3000,()=>{});h.call.audio(speech);
    const args={reason:"objective_resolved",closingQuote:closing,recipientQuote:answer};
    const end=(noActionRequired:unknown)=>h.call.tool({name:"end_call",arguments:JSON.stringify({...args,noActionRequired})},()=>true);
    const rejected=await end({conditionSourceQuote:"If pizza, ask which kind.",recipientQuote:answer});
    expect(rejected).toMatchObject({ok:false,reason:"no_action_required_not_applicable",instruction:expect.stringContaining("noActionRequired: null")});
    expect(h.hangup).not.toHaveBeenCalled();expect(h.call.closed).toBe(false);
    expect((await h.repository.exportCallTextData(h.brief.id)).terminalDecisions).toHaveLength(0);
    expect(await end(null)).toMatchObject({ok:true,state:"closing_requested"});
    await vi.advanceTimersByTimeAsync(1001);h.twilio.receive(h.twilio.sent.find(e=>e.event==="mark"));await vi.advanceTimersByTimeAsync(351);await flush();
    expect(h.hangup).toHaveBeenCalledTimes(1);
    expect(h.live.sent.filter(e=>e.type==="session.commentary.append")).toHaveLength(1);
    expect(h.tts).not.toHaveBeenCalled();
    const decisions=(await h.repository.exportCallTextData(h.brief.id)).terminalDecisions!;
    expect(decisions).toHaveLength(1);expect(decisions[0]).not.toHaveProperty("noActionRequired");
  });
  it("resolves a conditional task without booking only with approved and observed evidence",async()=>{
    const condition="Book only if the total price is at most CHF 100.";
    const h=await fixture(true,`Ask the total price. ${condition}`);await h.attach();
    const answer="The total price is CHF 150.",closing="Nina's price limit is exceeded, so no booking. Thank you, goodbye.";
    h.call.transcript("recipient",answer,0,1000,()=>{});h.call.transcript("assistant",closing,1000,3000,()=>{});h.call.audio(speech);
    const args={reason:"objective_resolved",closingQuote:closing,recipientQuote:answer};
    const end=(extra:object)=>h.call.tool({name:"end_call",arguments:JSON.stringify({...args,...extra})},()=>true);
    expect(await end({})).toMatchObject({reason:"appointment_result_unconfirmed"});
    expect(await end({noActionRequired:{conditionSourceQuote:"Invented condition",recipientQuote:answer}})).toMatchObject({reason:"conditional_resolution_evidence_required"});
    expect(await end({noActionRequired:{conditionSourceQuote:condition,recipientQuote:"CHF 200"}})).toMatchObject({reason:"conditional_resolution_evidence_required"});
    expect(await end({noActionRequired:{conditionSourceQuote:condition,recipientQuote:answer}})).toMatchObject({ok:true});
    await vi.advanceTimersByTimeAsync(1001);h.twilio.receive(h.twilio.sent.find(e=>e.event==="mark"));await vi.advanceTimersByTimeAsync(351);await flush();
    expect(h.hangup).toHaveBeenCalledTimes(1);expect(await h.repository.nativeLive.readAction(h.attempt.id)).toBeNull();
  });
  it("closes media immediately and retains a delayed provider closure in the trace",async()=>{
    const h=await fixture();await h.attach();h.call.dispose();
    const store=h.repository.nativeLive as MemoryNativeLiveStore;
    expect(h.call.closed).toBe(true);expect(h.twilio.readyState).toBe(3);
    await vi.advanceTimersByTimeAsync(4000);
    expect(store.traces.get(h.attempt.id)?.some(row=>row.eventType==="trace.manifest")).not.toBe(true);
    h.live.receive({type:"session.closed",reason:"close_requested",usage:{seconds:2}});await flush();
    expect(store.traces.get(h.attempt.id)?.at(-1)?.payload).toMatchObject({complete:true,sessionClosed:true,drainTimeout:false});
    await vi.advanceTimersByTimeAsync(NATIVE_TRACE_DRAIN_MS);
    expect(store.traces.get(h.attempt.id)?.filter(row=>row.eventType==="trace.manifest")).toHaveLength(1);
    expect(h.hangup).not.toHaveBeenCalled();
  });
  it("bounds trace drainage and reports an unobserved provider closure honestly",async()=>{
    const h=await fixture();await h.attach();h.call.dispose();
    const store=h.repository.nativeLive as MemoryNativeLiveStore;
    await vi.advanceTimersByTimeAsync(NATIVE_TRACE_DRAIN_MS+1);await flush();
    expect(h.call.closed).toBe(true);
    expect(store.traces.get(h.attempt.id)?.at(-1)?.payload).toMatchObject({complete:false,sessionClosed:false,drainTimeout:true});
    expect(h.hangup).not.toHaveBeenCalled();
  });
  async function backendReply(h:Awaited<ReturnType<typeof fixture>>,id:string,tool?:{reason?:string;closingQuote:string;recipientQuote:string}){
    const command=h.live.sent.filter(e=>e.type==="response.create").at(-1);
    h.live.receive({type:"response.event",client_event_id:command.event_id,event:{type:"response.created",response:{id}}});
    if(tool)h.live.receive({type:"response.event",event:{type:"response.output_item.done",response_id:id,item:{type:"function_call",call_id:id+"-end",name:"end_call",arguments:JSON.stringify({reason:"objective_resolved",...tool})}}});
    h.live.receive({type:"response.event",event:{type:"response.completed",response:{id,status:"completed",output:[]}}});
    for(let i=0;i<8;i++)await flush();
  }
  it.each([
    {locale:"de-CH",answer:"Margherita.",quote:"Sie möchten Pizza Margherita. Vielen Dank und auf Wiederhören."},
    {locale:"de-DE",answer:"Margherita.",quote:"Sie möchten Pizza Margherita. Vielen Dank und auf Wiedersehen."},
    {locale:"fr-CH",answer:"Margherita.",quote:"Vous souhaitez une pizza Margherita. Merci et au revoir."},
    {locale:"it-CH",answer:"Margherita.",quote:"Desidera una pizza Margherita. Grazie e arrivederci."},
    {locale:"en-GB",answer:"Margherita.",quote:"You would like a Margherita pizza. Thank you, goodbye."},
    {locale:"en-US",answer:"Margherita.",quote:"You would like a Margherita pizza. Thank you, goodbye."},
    {locale:"ru-RU",answer:"Маргарита.",quote:"Вы хотите пиццу Маргарита. Спасибо, до свидания."}
  ] satisfies Array<{locale:CallLocale;answer:string;quote:string}>)("recovers closing in $locale, waits for playback and hangs up exactly once",async({locale,answer,quote})=>{
    const h=await fixture(false,undefined,authorization,locale);await h.attach();
    expect(h.live.sent.find(e=>e.type==="session.start").session.instructions).toContain(`Speak ${locale}`);
    h.live.receive({type:"session.input_transcript.delta",event_id:"recipient-answer",delta:answer,start_ms:0,end_ms:900});
    h.live.receive({type:"session.output_transcript.delta",event_id:"farewell",delta:quote,start_ms:1000,end_ms:5000});
    h.live.receive({type:"session.output_audio.delta",delta:speech});
    await vi.advanceTimersByTimeAsync(NATIVE_COMPLETION_TIMING.farewellQuietMs-1);
    expect(h.live.sent.filter(e=>e.type==="response.create")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);expect(h.live.sent.filter(e=>e.type==="response.create")).toHaveLength(1);
    expect(h.hangup).not.toHaveBeenCalled();
    await backendReply(h,"closing-review",{closingQuote:quote,recipientQuote:answer});
    expect(JSON.parse(h.live.sent.find(e=>e.item?.call_id==="closing-review-end").item.output)).toMatchObject({ok:true});
    await vi.advanceTimersByTimeAsync(1001);const mark=h.twilio.sent.find(e=>e.event==="mark");expect(mark).toBeTruthy();
    h.twilio.receive(mark);await vi.advanceTimersByTimeAsync(351);await flush();
    expect(h.hangup).toHaveBeenCalledTimes(1);expect(h.call.closed).toBe(true);
    expect(h.live.sent.filter(e=>e.type==="session.commentary.append")).toHaveLength(1);
  });
  it("accepts a reciprocal closing quote with punctuation changes but rejects changed recipient words",async()=>{
    const h=await fixture();await h.attach();const quote="Nina wants pizza. Thank you, goodbye.";
    h.call.transcript("assistant",quote,1000,2000,()=>{});h.call.audio(speech);
    h.call.transcript("recipient","Danke Auf Wiederhören",2100,3000,()=>{});
    expect(await h.call.tool({name:"end_call",arguments:JSON.stringify({reason:"objective_resolved",closingQuote:quote,recipientQuote:"Danke. Auf Wiedersehen."})},()=>true)).toMatchObject({ok:false,reason:"latest_recipient_evidence_required"});
    expect(await h.call.tool({name:"end_call",arguments:JSON.stringify({reason:"objective_resolved",closingQuote:quote,recipientQuote:"Danke. Auf Wiederhören."})},()=>true)).toMatchObject({ok:true});
  });
  it.each(["Thank you, goodbye.","Thank you and have a peaceful afternoon."])("reviews a new conclusion after a previous farewell review without new input: %s",async(ending)=>{
    const h=await fixture();await h.attach();
    h.call.transcript("recipient","Margherita.",0,900,()=>{});
    h.call.transcript("assistant","I have noted your answer. Thank you, goodbye.",1000,3000,()=>{});h.call.audio(speech);
    const reviews=()=>h.live.sent.filter(e=>e.type==="response.create");
    await vi.advanceTimersByTimeAsync(NATIVE_COMPLETION_TIMING.farewellQuietMs);
    expect(reviews()).toHaveLength(1);await backendReply(h,"first-closing-without-tool");
    // A punctuation-only tail and unchanged silence must not restart the backend.
    h.call.transcript("assistant"," …",3000,3100,()=>{});
    for(let i=0;i<20;i++)h.call.audio(silence);
    await vi.advanceTimersByTimeAsync(20000);expect(reviews()).toHaveLength(1);
    const closing="You want a Margherita pizza. "+ending;
    h.call.transcript("assistant",closing,3200,6000,()=>{});h.call.audio(speech);
    await vi.advanceTimersByTimeAsync(300);h.call.audio(speech);
    await vi.advanceTimersByTimeAsync(300);expect(reviews()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(NATIVE_COMPLETION_TIMING.quietEpisodeMs);
    expect(reviews()).toHaveLength(2);
    await backendReply(h,"new-conclusion",{closingQuote:closing,recipientQuote:"Margherita."});
    expect(JSON.parse(h.live.sent.find(e=>e.item?.call_id==="new-conclusion-end").item.output)).toMatchObject({ok:true});
    await vi.advanceTimersByTimeAsync(1001);h.twilio.receive(h.twilio.sent.filter(e=>e.event==="mark").at(-1));
    await vi.advanceTimersByTimeAsync(351);await flush();
    expect(h.hangup).toHaveBeenCalledTimes(1);expect(h.call.closed).toBe(true);
    expect(h.live.sent.filter(e=>e.type==="session.commentary.append")).toHaveLength(1);
  });
  it("preserves a new question after goodbye, rejects old evidence and closes after its answer",async()=>{
    const h=await fixture();await h.attach();
    h.call.transcript("recipient","Margherita.",0,900,()=>{});
    const first="You want Margherita. Thank you, goodbye.";
    h.call.transcript("assistant",first,1000,2000,()=>{});h.call.audio(speech);
    const end=(closingQuote:string,recipientQuote:string)=>h.call.tool({name:"end_call",arguments:JSON.stringify({reason:"objective_resolved",closingQuote,recipientQuote,noActionRequired:null})},()=>true);
    expect(await end(first,"Margherita.")).toMatchObject({ok:true});
    await vi.advanceTimersByTimeAsync(1001);const oldMark=h.twilio.sent.filter(e=>e.event==="mark").at(-1);
    h.call.activity("started");const question="Wait, which pizza did I say?";
    h.call.transcript("recipient",question,2100,3000,()=>{});h.call.activity("stopped");h.twilio.receive(oldMark);
    await vi.advanceTimersByTimeAsync(351);expect(h.hangup).not.toHaveBeenCalled();
    expect(await end(first,"Margherita.")).toMatchObject({reason:"latest_recipient_evidence_required"});
    const answer="You said Margherita. Thank you, goodbye.";
    h.call.transcript("assistant",answer,3200,4500,()=>{});h.call.audio(speech);
    expect(h.twilio.sent.filter(e=>e.event==="media")).toHaveLength(2);
    expect(await end(answer,question)).toMatchObject({ok:true});
    await vi.advanceTimersByTimeAsync(1001);h.twilio.receive(h.twilio.sent.filter(e=>e.event==="mark").at(-1));
    await vi.advanceTimersByTimeAsync(351);await flush();expect(h.hangup).toHaveBeenCalledTimes(1);
  });
  it("checks an unknown farewell once after a longer quiet episode and never loops on unchanged silence",async()=>{
    const h=await fixture();await h.attach();h.call.transcript("recipient","Yes, it arrived.",0,1000,()=>{});
    h.call.transcript("assistant","That resolves Nina’s request. Thank you and have a peaceful afternoon.",1000,3000,()=>{});h.call.audio(speech);
    await vi.advanceTimersByTimeAsync(NATIVE_COMPLETION_TIMING.quietEpisodeMs-1);expect(h.live.sent.filter(e=>e.type==="response.create")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);await backendReply(h,"quiet-review");
    for(let i=0;i<20;i++)h.call.audio(silence);
    await vi.advanceTimersByTimeAsync(20000);expect(h.live.sent.filter(e=>e.type==="response.create")).toHaveLength(1);expect(h.hangup).not.toHaveBeenCalled();
  });
  it("leaves an ordinary question open after a silent negative review and can still accelerate a later farewell",async()=>{
    const h=await fixture();await h.attach();h.call.transcript("recipient","Yes, now is convenient.",0,1000,()=>{});
    h.call.transcript("assistant","Which pizza would you like?",1000,2000,()=>{});h.call.audio(speech);
    await vi.advanceTimersByTimeAsync(NATIVE_COMPLETION_TIMING.quietEpisodeMs);await backendReply(h,"waiting-review");
    expect(h.hangup).not.toHaveBeenCalled();expect(h.call.closed).toBe(false);
    const input=JSON.stringify(h.live.sent.filter(e=>e.type==="response.item.create"&&e.item?.type==="message").at(-1));
    expect(input).toContain("return no tool call or message");
    h.call.transcript("assistant","No answer was available. Thank you, goodbye.",2100,3000,()=>{});h.call.audio(speech);
    await vi.advanceTimersByTimeAsync(NATIVE_COMPLETION_TIMING.farewellQuietMs);expect(h.live.sent.filter(e=>e.type==="response.create")).toHaveLength(2);
  });
  it("waits for input and ongoing output to stop before reviewing, including a reciprocal goodbye",async()=>{
    const h=await fixture();await h.attach();h.call.transcript("recipient","It arrived.",0,1000,()=>{});
    h.call.transcript("assistant","Nina’s application arrived. Thank you, goodbye.",1000,2000,()=>{});h.call.audio(speech);
    await vi.advanceTimersByTimeAsync(300);h.call.audio(speech);await vi.advanceTimersByTimeAsync(300);
    expect(h.live.sent.filter(e=>e.type==="response.create")).toHaveLength(0);
    h.call.activity("started");h.call.transcript("recipient","Thank you, goodbye.",2100,3000,()=>{});
    await vi.advanceTimersByTimeAsync(1000);expect(h.live.sent.filter(e=>e.type==="response.create")).toHaveLength(0);
    h.call.activity("stopped");await vi.advanceTimersByTimeAsync(NATIVE_COMPLETION_TIMING.farewellQuietMs);
    expect(h.live.sent.filter(e=>e.type==="response.create")).toHaveLength(1);expect(h.hangup).not.toHaveBeenCalled();
  });
  it("wakes a due review on backend settlement without starting a competing response",async()=>{
    const h=await fixture();await h.attach();h.call.transcript("recipient","It arrived.",0,1000,()=>{});
    h.live.receive({type:"response.event",delegation_id:"already-working",event:{type:"response.created",response:{id:"existing-backend"}}});
    h.call.transcript("assistant","Nina’s application arrived. Thank you, goodbye.",1000,2000,()=>{});h.call.audio(speech);
    await vi.advanceTimersByTimeAsync(5000);expect(h.live.sent.filter(e=>e.type==="response.create")).toHaveLength(0);
    h.live.receive({type:"response.event",delegation_id:"already-working",event:{type:"response.completed",response:{id:"existing-backend",status:"completed",output:[]}}});
    for(let i=0;i<8;i++)await flush();
    expect(h.live.sent.filter(e=>e.type==="response.create")).toHaveLength(1);expect(h.hangup).not.toHaveBeenCalled();
  });
  it("does not add a quiet review after backend work, but preserves recovery for a new unrecognized farewell",async()=>{
    const h=await fixture();await h.attach();
    h.call.transcript("recipient","It arrived.",0,1000,()=>{});h.call.transcript("assistant","Understood.",1000,2000,()=>{});h.call.audio(speech);
    h.live.receive({type:"response.event",delegation_id:"current",event:{type:"response.created",response:{id:"current-backend"}}});
    await vi.advanceTimersByTimeAsync(7000);
    h.live.receive({type:"response.event",delegation_id:"current",event:{type:"response.completed",response:{id:"current-backend",status:"completed",output:[]}}});
    for(let i=0;i<8;i++)await flush();
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.live.sent.filter(e=>e.type==="response.create")).toHaveLength(0);
    h.call.transcript("assistant","Nina's application arrived. Thank you and have a peaceful afternoon.",2100,4000,()=>{});h.call.audio(speech);
    await vi.advanceTimersByTimeAsync(NATIVE_COMPLETION_TIMING.quietEpisodeMs);
    expect(h.live.sent.filter(e=>e.type==="response.create")).toHaveLength(1);
  });
  it("does not duplicate rejected result work and closes an unresolved action after an observed farewell",async()=>{
    const h=await fixture(true);await h.attach();
    h.call.transcript("recipient","Three is available.",0,500,()=>{});
    const prepared=await h.call.tool({name:"prepare_appointment",arguments:JSON.stringify({proposal:{...nativeProposal,alternativeId:"approved"},intent:"request"})},()=>true);
    const action=prepared.action as any,request="Please book Nina Keller for 16 September 2099 at 15:00.",reply="No, instead tomorrow at ten.";
    h.call.transcript("assistant",request,1000,3000,()=>{});h.call.audio(speech);
    await vi.advanceTimersByTimeAsync(1001);h.twilio.receive(h.twilio.sent.find(e=>e.event==="mark"));await flush();
    h.call.transcript("recipient",reply,3100,4000,()=>{});
    h.live.receive({type:"response.event",delegation_id:"result-repair",event:{type:"response.created",response:{id:"result-repair"}}});
    expect(await h.call.tool({name:"record_appointment_result",arguments:JSON.stringify({actionId:action.id,episode:1,outcome:"declined",assistantQuote:request,recipientQuote:reply,latestRecipientQuote:reply,detailsMatch:false,previousAppointmentReleased:false})},()=>true)).toMatchObject({reason:"decline_not_established"});
    await vi.advanceTimersByTimeAsync(15000);
    h.live.receive({type:"response.event",delegation_id:"result-repair",event:{type:"response.completed",response:{id:"result-repair",status:"completed",output:[]}}});
    for(let i=0;i<8;i++)await flush();
    expect(h.live.sent.filter(e=>e.type==="response.create")).toHaveLength(0);
    const closing="I cannot confirm Nina's appointment. Thank you, goodbye.";
    h.call.transcript("assistant",closing,4100,5500,()=>{});h.call.audio(speech);
    await vi.advanceTimersByTimeAsync(NATIVE_COMPLETION_TIMING.farewellQuietMs);
    expect(h.live.sent.filter(e=>e.type==="response.create")).toHaveLength(1);
    await backendReply(h,"uncertain-end",{reason:"cannot_proceed",closingQuote:closing,recipientQuote:reply});
    expect(JSON.parse(h.live.sent.find(e=>e.item?.call_id==="uncertain-end-end").item.output)).toMatchObject({ok:true});
    await vi.advanceTimersByTimeAsync(1001);h.twilio.receive(h.twilio.sent.filter(e=>e.event==="mark").at(-1));await vi.advanceTimersByTimeAsync(351);await flush();
    expect(h.hangup).toHaveBeenCalledTimes(1);
    expect((await h.repository.exportCallTextData(h.brief.id)).terminalDecisions).toMatchObject([{reason:"cannot_proceed"}]);
    expect((await h.repository.nativeLive.readAction(h.attempt.id))?.state).not.toBe("confirmed");
  });
  it("rejects an old review decision after a substantive correction",async()=>{
    const h=await fixture();await h.attach();const quote="Nina’s application arrived. Thank you, goodbye.";
    h.live.receive({type:"session.input_transcript.delta",event_id:"answer-before",delta:"It arrived.",start_ms:0,end_ms:1000});
    h.live.receive({type:"session.output_transcript.delta",event_id:"out-before",delta:quote,start_ms:1000,end_ms:2000});h.call.audio(speech);
    await vi.advanceTimersByTimeAsync(NATIVE_COMPLETION_TIMING.farewellQuietMs);
    const command=h.live.sent.filter(e=>e.type==="response.create").at(-1);
    h.live.receive({type:"response.event",client_event_id:command.event_id,event:{type:"response.created",response:{id:"old-review"}}});
    h.live.receive({type:"session.input_transcript.delta",event_id:"late-correction",delta:"Wait, it was a different application.",start_ms:2100,end_ms:4000});
    h.live.receive({type:"response.event",event:{type:"response.output_item.done",response_id:"old-review",item:{type:"function_call",call_id:"old-end",name:"end_call",arguments:JSON.stringify({reason:"objective_resolved",closingQuote:quote,recipientQuote:"It arrived."})}}});
    h.live.receive({type:"response.event",event:{type:"response.completed",response:{id:"old-review",status:"completed",output:[]}}});
    for(let i=0;i<8;i++)await flush();
    expect(h.hangup).not.toHaveBeenCalled();expect(h.twilio.sent.filter(e=>e.event==="mark")).toHaveLength(0);
    expect(JSON.parse(h.live.sent.find(e=>e.item?.call_id==="old-end").item.output)).toMatchObject({ok:false,reason:"stale_request"});
  });
  it.each(["already_closing","discarded","disposed"])("does not recover after %s",async mode=>{
    const h=await fixture();await h.attach();const quote="The application arrived. Thank you, goodbye.";
    h.call.transcript("recipient","It arrived.",0,1000,()=>{});h.call.transcript("assistant",quote,1000,2000,()=>{});h.call.audio(speech);
    if(mode==="already_closing")await h.call.tool({name:"end_call",arguments:JSON.stringify({reason:"objective_resolved",closingQuote:quote,recipientQuote:"It arrived."})},()=>true);
    else if(mode==="discarded"){
      vi.spyOn(h.service,"discardNativeConversation").mockResolvedValue(undefined);
      await h.call.tool({name:"stop_and_discard",arguments:'{"reason":"recording_refused"}'},()=>true);
    }else h.call.dispose();
    await vi.advanceTimersByTimeAsync(1000);expect(h.live.sent.filter(e=>e.type==="response.create")).toHaveLength(0);
  });
  it("reviews a delivered action once after a recipient reply, without recording success or repeating the action",async()=>{
    const h=await fixture(true);await h.attach();h.call.transcript("recipient","There is a slot at three.",0,500,()=>{});
    await h.call.tool({name:"prepare_appointment",arguments:JSON.stringify({proposal:{...nativeProposal,alternativeId:"approved"},intent:"request"})},()=>true);
    h.call.transcript("assistant","Please book Nina Keller for 16 September 2099 at 15:00.",1000,3000,()=>{});h.call.audio(speech);
    await vi.advanceTimersByTimeAsync(1001);h.twilio.receive(h.twilio.sent.find(e=>e.event==="mark"&&e.mark.name.startsWith("native-action:")));await flush();
    const reviews=()=>h.live.sent.filter(e=>e.type==="response.create");
    await vi.advanceTimersByTimeAsync(3000);expect(reviews()).toHaveLength(0);
    h.call.activity("started");h.call.transcript("recipient","Nina Keller is booked for that time.",3100,4000,()=>{});
    await vi.advanceTimersByTimeAsync(3000);expect(reviews()).toHaveLength(0);
    h.call.activity("stopped");await vi.advanceTimersByTimeAsync(2001);expect(reviews()).toHaveLength(1);
    const input=h.live.sent.filter(e=>e.type==="response.item.create"&&e.item?.type==="message").at(-1);
    expect(JSON.stringify(input)).toContain("Never repeat the original commitment");
    expect((await h.repository.nativeLive.readAction(h.attempt.id))?.state).toBe("delivered");expect(h.hangup).not.toHaveBeenCalled();
    h.call.transcript("recipient","Thank you.",4100,4500,()=>{});await vi.advanceTimersByTimeAsync(3000);expect(reviews()).toHaveLength(1);
  });
  it("reviews missing closing delegation once after a confirmed action, without granting hangup",async()=>{
    const h=await fixture(true);await h.attach();h.call.transcript("recipient","There is a slot at three.",0,500,()=>{});
    const prepared=await h.call.tool({name:"prepare_appointment",arguments:JSON.stringify({proposal:{...nativeProposal,alternativeId:"approved"},intent:"request"})},()=>true);
    const action=prepared.action as any;
    h.call.transcript("assistant","Please book Nina Keller for 16 September 2099 at 15:00.",1000,3000,()=>{});h.call.audio(speech);
    h.call.transcript("recipient","Nina Keller is booked for that time.",3100,4000,()=>{});
    await vi.advanceTimersByTimeAsync(1001);h.twilio.receive(h.twilio.sent.find(e=>e.event==="mark"&&e.mark.name.startsWith("native-action:")));await flush();
    expect(await h.call.tool({name:"record_appointment_result",arguments:JSON.stringify({actionId:action.id,episode:action.episode,outcome:"confirmed",assistantQuote:"Please book Nina Keller for 16 September 2099 at 15:00.",recipientQuote:"Nina Keller is booked for that time.",latestRecipientQuote:"Nina Keller is booked for that time.",detailsMatch:true,previousAppointmentReleased:false})},()=>true)).toMatchObject({ok:true});
    const reminders=()=>h.live.sent.filter(e=>e.type==="response.create");
    h.call.activity("started");await vi.advanceTimersByTimeAsync(3000);expect(reminders()).toHaveLength(0);
    h.call.activity("stopped");await vi.advanceTimersByTimeAsync(2001);expect(reminders()).toHaveLength(1);expect(h.hangup).not.toHaveBeenCalled();
    h.call.transcript("assistant","Nina Keller is booked. Thank you, goodbye.",4100,6000,()=>{});h.call.audio(speech);
    await vi.advanceTimersByTimeAsync(3000);expect(reminders()).toHaveLength(1);expect(h.hangup).not.toHaveBeenCalled();
    const command=reminders()[0];
    h.live.receive({type:"response.event",client_event_id:command.event_id,event:{type:"response.created",response:{id:"application-review"}}});
    h.live.receive({type:"response.event",event:{type:"response.output_item.done",response_id:"application-review",item:{type:"function_call",call_id:"review-end",name:"end_call",arguments:JSON.stringify({reason:"objective_resolved",closingQuote:"Nina Keller is booked. Thank you, goodbye.",recipientQuote:"Nina Keller is booked for that time."})}}});
    h.live.receive({type:"response.event",event:{type:"response.completed",response:{id:"application-review",status:"completed",output:[]}}});
    for(let i=0;i<8;i++)await flush();
    expect(JSON.parse(h.live.sent.find(e=>e.item?.call_id==="review-end").item.output)).toMatchObject({ok:true});
  });
  it("preloads all approved sources and tools, sends no TTS or consent handoff and preserves the first audio frame",async()=>{
    const h=await fixture();expect(h.snapshot.version).toBe(7);
    const start=h.live.sent.find(e=>e.type==="session.start").session;
    expect(start.store).toBe(false);expect(start.delegation.responses.tools.map((t:any)=>t.name)).toEqual(["end_call","stop_and_discard"]);
    expect(JSON.stringify(start.input)).toContain("Application sent: 12 July");
    expect(start.instructions).toContain("<|SpawnThinking|>");expect(JSON.stringify(start.input)).toContain("Pause for the answer");
    h.live.receive({type:"session.output_audio.delta",delta:speech});expect(h.twilio.sent).toEqual([]);
    await h.attach();h.live.receive({type:"session.output_audio.delta",delta:speech});
    expect(h.twilio.sent.find(e=>e.event==="media").media.payload).toBe(speech);
    await flush();
    const lifecycle=(await h.repository.get(h.brief.id))!.brief.lifecycle!;
    expect(lifecycle.conversationStartedAt).not.toBeNull();
    expect(lifecycle.consent).not.toBe("granted");
    expect(h.tts).not.toHaveBeenCalled();expect(h.live.sent.filter(e=>e.type==="session.update")).toHaveLength(0);
    expect(h.live.sent.filter(e=>e.type==="session.commentary.append")).toHaveLength(1);
    for(let i=0;i<50;i++)h.twilio.receive({event:"media",media:{payload:silence}});
    await vi.advanceTimersByTimeAsync(6000);
    expect(h.live.sent.filter(e=>e.type==="response.create")).toHaveLength(0);
  });
  it("closes after an already-spoken main outcome and goodbye without waiting for another phrase",async()=>{
    const h=await fixture();await h.attach();
    h.call.transcript("recipient","Yes, the application has arrived.",0,1000,()=>{});
    h.call.audio(speech);h.call.transcript("assistant","Your application was received. Thank you, goodbye.",1000,2000,()=>{});
    // Slow reasoning must not force a second farewell after the real one.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await h.call.tool({name:"end_call",arguments:JSON.stringify({reason:"objective_resolved",closingQuote:"Your application was received. Thank you, goodbye.",recipientQuote:"Yes, the application has arrived."})},()=>true)).toMatchObject({ok:true});
    await vi.advanceTimersByTimeAsync(1001);
    const mark=h.twilio.sent.find(e=>e.event==="mark");expect(mark).toBeTruthy();
    h.twilio.receive(mark);await vi.advanceTimersByTimeAsync(351);await flush();
    expect(h.hangup).toHaveBeenCalledTimes(1);
    const decisions=(await h.repository.exportCallTextData(h.brief.id)).terminalDecisions!;
    expect(decisions[0]).toMatchObject({version:2,reason:"objective_resolved"});expect(decisions[0].summary).toBeUndefined();
  });
  it("revokes a pending closing mark on a recipient correction",async()=>{
    const h=await fixture();await h.attach();h.call.transcript("recipient","Yes.",0,1000,()=>{});
    h.call.audio(speech);h.call.transcript("assistant","Thank you, goodbye.",1000,2000,()=>{});
    await h.call.tool({name:"end_call",arguments:JSON.stringify({reason:"objective_resolved",closingQuote:"Thank you, goodbye.",recipientQuote:"Yes."})},()=>true);
    await vi.advanceTimersByTimeAsync(1001);const mark=h.twilio.sent.find(e=>e.event==="mark");
    h.call.transcript("recipient","Wait, I need to correct that.",2000,3000,()=>{});h.twilio.receive(mark);
    await vi.advanceTimersByTimeAsync(1500);expect(h.hangup).not.toHaveBeenCalled();
  });
  it("executes an attributed refusal at output_item.done before response completion, despite newer speech",async()=>{
    const h=await fixture();await h.attach();
    const discard=vi.spyOn(h.service,"discardNativeConversation").mockImplementation(async(_call,attempt,reason)=>h.repository.nativeLive.discard(attempt,reason));
    h.live.receive({type:"response.event",delegation_id:"refusal",event:{type:"response.created",response:{id:"refusal-response"}}});
    h.live.receive({type:"session.input_transcript.delta",event_id:"refusal-text",delta:"Do not record this.",start_ms:0,end_ms:500});
    h.twilio.receive({event:"media",media:{payload:speech}});
    h.live.receive({type:"response.event",delegation_id:"refusal",event:{type:"response.output_item.done",response_id:"refusal-response",
      item:{type:"function_call",call_id:"discard-1",name:"stop_and_discard",arguments:'{"reason":"recording_refused"}'}}});
    await flush();expect(discard).toHaveBeenCalledTimes(1);
    expect((await h.repository.nativeLive.get(h.attempt.id))?.state).toBe("discard_requested");
    expect(h.call.closed).toBe(true);
  });
  it("keeps the complete original context while retrieving only optional approved appendix sections",async()=>{
    const h=await fixture();if(h.snapshot.version!==7)throw Error("fixture");
    const snapshot=structuredClone(h.snapshot);snapshot.taskSources.context="я".repeat(4000);snapshot.taskSources.allowedFacts=["Critical original fact"];
    snapshot.contextAppendix=[{id:"reference",title:"Reference",description:"Optional reference",content:"Optional text"}];
    const session=nativeV2Session(snapshot),data=JSON.parse((session.input.find((item:any)=>item.role==="user") as any).content[0].text);
    expect(data.sourceMaterial.context).toHaveLength(4000);expect(data.sourceMaterial.allowedFacts).toEqual(["Critical original fact"]);
    expect(data.appendixIndex).toEqual([{id:"reference",title:"Reference",description:"Optional reference"}]);
    expect(JSON.stringify(session.input)).not.toContain("Optional text");
    expect(session.backendInstructions).not.toContain("Optional text");
    expect(await h.call.tool({name:"get_task_context",arguments:'{"sectionId":"unknown"}'},()=>true)).toMatchObject({ok:false,reason:"unknown_section"});
  });
  it("executes an approved appointment through Live tools and blocks a premature success hangup",async()=>{
    const h=await fixture(true);await h.attach();h.call.transcript("recipient","There is a slot at three.",0,500,()=>{});
    expect(await h.call.tool({name:"end_call",arguments:'{"reason":"objective_resolved"}'},()=>true)).toMatchObject({reason:"appointment_result_unconfirmed"});
    const prepare=await h.call.tool({name:"prepare_appointment",arguments:JSON.stringify({proposal:{...nativeProposal,alternativeId:"approved"},intent:"request"})},()=>true);
    expect(prepare).toMatchObject({ok:true});const action=prepare.action as any;
    h.call.transcript("assistant","Please book Nina Keller for 16 September 2099 at 15:00.",1000,3000,()=>{});h.call.audio(speech);
    h.call.activity("started");h.call.transcript("recipient","Nina Keller is booked for that time.",3100,4000,()=>{});h.call.activity("stopped");
    await vi.advanceTimersByTimeAsync(1001);const mark=h.twilio.sent.find(e=>e.event==="mark"&&e.mark.name.startsWith("native-action:"));expect(mark).toBeTruthy();h.twilio.receive(mark);await flush();
    expect(await h.call.tool({name:"record_appointment_result",arguments:JSON.stringify({actionId:action.id,episode:action.episode,outcome:"confirmed",assistantQuote:"Please book Nina Keller for 16 September 2099 at 15:00.",recipientQuote:"Nina Keller is booked for that time.",latestRecipientQuote:"Nina Keller is booked for that time.",detailsMatch:true,previousAppointmentReleased:false})},()=>true)).toMatchObject({ok:true});
    expect((await h.repository.get(h.brief.id))?.nativeAppointmentAction).toMatchObject({state:"confirmed",representedPerson:"Nina Keller"});
    expect(h.live.sent.some(e=>e.type==="response.item.create"&&e.item?.role==="developer"&&e.item.content[0].text.includes('"delivery":"played"'))).toBe(true);
    h.call.transcript("assistant"," Nina Keller is booked. Thank you, goodbye.",4100,5000,()=>{});h.call.audio(speech);
    expect(await h.call.tool({name:"end_call",arguments:JSON.stringify({reason:"objective_resolved",closingQuote:"Nina Keller is booked. Thank you, goodbye.",recipientQuote:"Nina Keller is booked for that time."})},()=>true)).toMatchObject({ok:true});expect(h.tts).not.toHaveBeenCalled();
  });
  it("selects the same explicit native runtime in development and production",()=>{
    const env={VOICE_RUNTIME_LIVE_EXPERIMENT:"native_v2"};
    expect(voiceRuntimeMode(env)).toBe("live_native_v2");expect(voiceRuntimeMode({...env,NODE_ENV:"production"})).toBe("live_native_v2");
  });
});
it("traces text and tool events separately, omits audio/credentials, and reports a bounded queue gap",async()=>{
  const store=new MemoryNativeLiveStore();await store.reserve("call","attempt");
  let release!:()=>void;const original=store.append.bind(store);let first=true;
  vi.spyOn(store,"append").mockImplementation(async(...args)=>{if(first){first=false;await new Promise<void>(resolve=>{release=resolve;});}await original(...args);});
  const trace=new LiveProtocolTrace(store,"attempt");
  trace.event("in",{type:"session.input_transcript.delta",delta:"Useful words",authorization:"secret"});
  for(let i=0;i<300;i++)trace.event("host",{type:"test.event",i});
  trace.event("in",{type:"session.output_audio.delta",delta:speech});release();await trace.close();
  const rows=store.traces.get("attempt")!,text=JSON.stringify(rows);
  expect(text).toContain("Useful words");expect(text).not.toContain("secret");expect(text).not.toContain(speech);
  expect(rows.at(-1)?.payload).toMatchObject({complete:false,dropped:expect.any(Number)});
  await store.discard("attempt","conversation_refused");await store.append("attempt",rows);expect(store.traces.has("attempt")).toBe(false);
});
