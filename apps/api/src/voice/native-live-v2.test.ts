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

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0))await close();vi.useRealTimers();});
async function fixture(withAppointment=false,objective?:string){
  vi.useFakeTimers({toFake:["setTimeout","clearTimeout","setInterval","clearInterval"]});
  const h=await approvedCall(withAppointment?authorization:undefined,undefined,undefined,undefined,undefined,undefined,undefined,objective);const live=new TestSocket(),twilio=new TestSocket();live.autoAcknowledge=true;
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
  it("recovers a missed general delegation after German goodbye, then waits for playback and hangs up exactly once",async()=>{
    const h=await fixture();await h.attach();
    const quote="Sie möchten Pizza Margherita. Vielen Dank und auf Wiederhören.";
    h.live.receive({type:"session.input_transcript.delta",event_id:"recipient-answer",delta:"Margherita.",start_ms:0,end_ms:900});
    h.live.receive({type:"session.output_transcript.delta",event_id:"farewell",delta:quote,start_ms:1000,end_ms:5000});
    h.live.receive({type:"session.output_audio.delta",delta:speech});
    await vi.advanceTimersByTimeAsync(NATIVE_COMPLETION_TIMING.farewellQuietMs-1);
    expect(h.live.sent.filter(e=>e.type==="response.create")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);expect(h.live.sent.filter(e=>e.type==="response.create")).toHaveLength(1);
    expect(h.hangup).not.toHaveBeenCalled();
    await backendReply(h,"closing-review",{closingQuote:quote,recipientQuote:"Margherita."});
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
    expect(input).toContain("return no tool call and no spoken message");
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
  it("requires explicit local configuration and rejects production",()=>{
    const env={VOICE_RUNTIME_LIVE_EXPERIMENT:"native_v2",VOICE_RUNTIME_NATIVE_V2_LOCAL:"true"};
    expect(voiceRuntimeMode(env)).toBe("live_native_v2");expect(()=>voiceRuntimeMode({...env,NODE_ENV:"production"})).toThrow();
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
