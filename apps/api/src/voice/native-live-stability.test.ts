import { afterEach, describe, expect, it, vi } from "vitest";
import { approvedPlanOnlyCall as approvedCall, flush, speech, TestSocket } from "./voice-test-helpers";
import { NativeLiveV2Call } from "./native-live-v2-call";
import { LiveNativeClosing } from "./live-native-closing";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.useRealTimers(); });
async function settle() { for (let i = 0; i < 8; i++) await flush(); }
async function fixture(delayAdmission = false) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  const h = await approvedCall();
  const live = new TestSocket(), twilio = new TestSocket(); live.autoAcknowledge = true;
  await h.repository.nativeLive.reserve(h.brief.id, h.attempt.id);
  await h.repository.nativeLive.bind(h.attempt.id, "CA-LIVE");
  const hangup = vi.spyOn(h.service, "prepareAgentHangup").mockResolvedValue(true);
  const call = new NativeLiveV2Call({ service: h.service, apiKey: "fixture", agentHangupEnabled: true, nativeV2: true,
    createLiveSocket: () => live.ws, speechFetch: vi.fn(), validateStreamToken: (_binding, token) => token === "valid" });
  cleanup.push(async () => { call.dispose(); live.receive({ type: "session.closed", reason: "close_requested", usage: { seconds: 2 } }); await settle(); await h.service.close(); });
  const preflight = call.preflight(h.brief.id, h.attempt.id); await flush(); live.emit("open"); live.startLive("stability-session"); await preflight;
  await h.repository.transitionAnswering(h.brief.id, { attemptId: h.attempt.id, providerCallId: "CA-LIVE", snapshotHash: h.snapshot.compilationSnapshotHash,
    kind: "resolve", answeredBy: "human", now: new Date().toISOString() });
  let releaseAdmission = () => {};
  if (delayAdmission) {
    const barrier = new Promise<void>(resolve => { releaseAdmission = resolve; });
    const original = h.service.transitionAnswering.bind(h.service);
    vi.spyOn(h.service, "transitionAnswering").mockImplementation(async (...args) => { if (args[1].kind === "admit") await barrier; return original(...args); });
  }
  const start={ event: "start", start: { callSid: "CA-LIVE", streamSid: "MZ", customParameters: {
    callBriefId: h.brief.id, callAttemptId: h.attempt.id, compilationSnapshotHash: h.snapshot.compilationSnapshotHash, streamToken: "valid" } } };
  call.attach(twilio.ws); twilio.receive(start); await settle();
  return { ...h, live, twilio, call, hangup, releaseAdmission, start };
}
function event(live: TestSocket, delegation: string, e: object) { live.receive({ type: "response.event", delegation_id: delegation, event: e }); }
const conclusion="Nina Keller's application arrived. Thank you, goodbye.";
const end=(recipientQuote="Yes, it arrived.")=>({name:"end_call",arguments:JSON.stringify({reason:"objective_resolved",closingQuote:conclusion,recipientQuote})});
function conversation(h:Awaited<ReturnType<typeof fixture>>){
  h.live.receive({type:"session.input_transcript.delta",event_id:"input-1",delta:"Yes, it arrived.",start_ms:0,end_ms:1000});
  h.live.receive({type:"session.output_audio.delta",delta:speech});
  h.live.receive({type:"session.output_transcript.delta",event_id:"output-1",delta:conclusion,start_ms:1000,end_ms:2000});
}
describe("native stability boundaries", () => {
  it("retains early audio in order while admission awaits storage", async () => {
    const h = await fixture(true), second=Buffer.alloc(800,130).toString("base64");
    h.twilio.receive({ event: "media", media: { payload: speech } }); h.twilio.receive({ event: "media", media: { payload: second } });
    expect(h.live.sent.filter(e => e.type === "session.input_audio.append")).toHaveLength(0);
    h.releaseAdmission(); await settle();
    expect(h.live.sent.filter(e => e.type === "session.input_audio.append").map(e=>e.audio)).toEqual([speech,second]);
    h.twilio.receive({ event: "media", media: { payload: speech } }); await settle();
    expect(h.live.sent.filter(e => e.type === "session.input_audio.append")).toHaveLength(3);
  });
  it("bounds admission buffering and never drains after failure",async()=>{
    const h=await fixture(true);for(let i=0;i<161;i++)h.twilio.receive({event:"media",media:{payload:speech}});
    await settle();expect(h.call.closed).toBe(true);h.releaseAdmission();await settle();
    expect(h.live.sent.filter(e=>e.type==="session.input_audio.append")).toHaveLength(0);
  });
  it("does not accept duplicate starts during admission",async()=>{
    const h=await fixture(true);h.twilio.receive(h.start);await settle();expect(h.call.closed).toBe(true);h.releaseAdmission();await settle();
  });
  it("cannot qualify arbitrary old speech without an observed closing quote", async () => {
    vi.useFakeTimers();const ports={mark:vi.fn(),drained:vi.fn(),failed:vi.fn(),continuous:true};const closing=new LiveNativeClosing(ports);
    closing.audio(speech);closing.caption("One moment, I will check that.");await vi.advanceTimersByTimeAsync(10000);
    expect(closing.request()).toBe(false);expect(closing.request(conclusion)).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);expect(ports.mark).not.toHaveBeenCalled();closing.cancel();
  });
  it("reuses the spoken farewell after reciprocal goodbye without another phrase or timeout", async () => {
    const h=await fixture();conversation(h);expect(await h.call.tool(end(),()=>true)).toMatchObject({ok:true});
    await vi.advanceTimersByTimeAsync(1001);const old=h.twilio.sent.find(e=>e.event==="mark");
    h.call.transcript("recipient","Thank you, goodbye.",2100,3000,()=>{});h.twilio.receive(old);
    expect(await h.call.tool(end(),()=>true)).toMatchObject({reason:"latest_recipient_evidence_required"});
    expect(await h.call.tool(end("Thank you, goodbye."),()=>true)).toMatchObject({ok:true});
    await vi.advanceTimersByTimeAsync(1001);h.twilio.receive(h.twilio.sent.filter(e=>e.event==="mark").at(-1));
    await vi.advanceTimersByTimeAsync(351);await settle();expect(h.hangup).toHaveBeenCalledOnce();
  });
  it("retains exact whitespace across transcript fragments for closing evidence",async()=>{
    const h=await fixture();h.call.audio(speech);
    for(const text of ["Nina's application arrived."," ","Thank you, goodbye."])h.call.transcript("assistant",text,1000,2000,()=>{});
    for(const text of ["Yes,", " ", "it arrived."])h.call.transcript("recipient",text,0,1000,()=>{});
    expect(await h.call.tool({name:"end_call",arguments:JSON.stringify({reason:"objective_resolved",closingQuote:"Nina's application arrived. Thank you, goodbye.",recipientQuote:"Yes, it arrived."})},()=>true)).toMatchObject({ok:true});
  });
  it("rejects punctuation-only recipient evidence",async()=>{
    const h=await fixture();conversation(h);
    expect(await h.call.tool(end("..."),()=>true)).toMatchObject({ok:false,reason:"latest_recipient_evidence_required"});
    expect(h.hangup).not.toHaveBeenCalled();
  });
  it("includes a trailing acknowledgment in playback without erasing the selected conclusion",async()=>{
    const h=await fixture();conversation(h);
    h.call.transcript("assistant"," All right, stopping now.",2100,2500,()=>{});h.call.audio(speech);
    expect(await h.call.tool(end(),()=>true)).toMatchObject({ok:true});
    await vi.advanceTimersByTimeAsync(1001);h.twilio.receive(h.twilio.sent.filter(e=>e.event==="mark").at(-1));
    await vi.advanceTimersByTimeAsync(351);await settle();expect(h.hangup).toHaveBeenCalledOnce();
  });
  it("refreshes stale continuation only after supplying all newer observed speech",async()=>{
    const h=await fixture();conversation(h);event(h.live,"ending",{type:"response.created",response:{id:"old-ending"}});
    h.live.receive({type:"session.input_transcript.delta",event_id:"input-2",delta:" Thank you, goodbye",start_ms:2100,end_ms:3000});
    event(h.live,"ending",{type:"response.output_item.done",response_id:"old-ending",item:{type:"function_call",call_id:"old-call",...end("Thank you, goodbye.")}});
    event(h.live,"ending",{type:"response.completed",response:{id:"old-ending",status:"completed",output:[]}});await settle();
    expect(JSON.parse(h.live.sent.find(e=>e.item?.call_id==="old-call").item.output)).toMatchObject({ok:false,reason:"stale_request",actionExecuted:false});
    expect(h.live.sent.some(e=>e.type==="response.create")).toBe(false);
    await vi.advanceTimersByTimeAsync(751);await settle();
    const update=h.live.sent.findIndex(e=>e.item?.role==="developer"&&e.item.content?.[0]?.text.startsWith("Newer observed"));
    expect(update).toBeGreaterThan(-1);expect(h.live.sent.slice(update+1).some(e=>e.type==="response.create")).toBe(true);
    event(h.live,"ending",{type:"response.created",response:{id:"fresh-ending"}});
    event(h.live,"ending",{type:"response.output_item.done",response_id:"fresh-ending",item:{type:"function_call",call_id:"fresh-call",...end("Thank you, goodbye.")}});
    event(h.live,"ending",{type:"response.completed",response:{id:"fresh-ending",status:"completed",output:[]}});await settle();
    expect(JSON.parse(h.live.sent.find(e=>e.item?.call_id==="fresh-call").item.output)).toMatchObject({ok:true});
  });
  it("does not delay a native tool behind provider accounting, while preserving accounting order",async()=>{
    const h=await fixture();conversation(h);let release!:()=>void;
    const barrier=new Promise<void>(resolve=>{release=resolve;});
    const record=h.service.recordRealtimeProviderOperation.bind(h.service),complete=h.service.completeProviderOperation.bind(h.service);
    const ordered:string[]=[];
    vi.spyOn(h.service,"recordRealtimeProviderOperation").mockImplementation(async args=>{await barrier;ordered.push("record");return record(args);});
    vi.spyOn(h.service,"completeProviderOperation").mockImplementation(async args=>{ordered.push("complete");return complete(args);});
    event(h.live,"closing",{type:"response.created",response:{id:"ending"}});
    event(h.live,"closing",{type:"response.output_item.done",response_id:"ending",item:{type:"function_call",call_id:"ending-call",...end()}});
    event(h.live,"closing",{type:"response.completed",response:{id:"ending",status:"completed",output:[]}});await settle();
    try {
      expect(JSON.parse(h.live.sent.find(e=>e.item?.call_id==="ending-call").item.output)).toMatchObject({ok:true});
      expect(ordered).toEqual([]);
    } finally { release();await settle(); }
    expect(ordered).toEqual(["record","complete"]);
  });
  it.each(["none","incomplete","failed","cancelled"])("continues after a successful tool with preceding %s response",async failure=>{
    const h=await fixture();conversation(h);
    if(failure!=="none"){
      event(h.live,"bad",{type:"response.created",response:{id:"bad-response"}});
      event(h.live,"bad",{type:"response.output_item.added",response_id:"bad-response",item:{type:"function_call",call_id:"unfinished",name:"end_call",arguments:""}});
      event(h.live,"bad",{type:`response.${failure}`,response:{id:"bad-response",status:failure,output:[]}});await settle();
      const error=h.live.sent.find(e=>e.type==="response.item.create"&&e.item?.call_id==="unfinished");
      expect(JSON.parse(error.item.output)).toMatchObject({ok:false,actionExecuted:false});expect(h.hangup).not.toHaveBeenCalled();
    }
    event(h.live,"good",{type:"response.created",response:{id:"good-response"}});
    event(h.live,"good",{type:"response.output_item.done",response_id:"good-response",item:{type:"function_call",call_id:"completed",...end()}});
    event(h.live,"good",{type:"response.completed",response:{id:"good-response",status:"completed",output:[]}});await settle();
    const output=h.live.sent.find(e=>e.type==="response.item.create"&&e.item?.call_id==="completed");expect(JSON.parse(output.item.output)).toMatchObject({ok:true});
    expect(h.live.sent.filter(e=>e.type==="response.create")).toHaveLength(failure==="none"?1:2);
  });
  it("bounds repeated backend failure recovery",async()=>{
    const h=await fixture();conversation(h);
    for(let i=0;i<3;i++){
      event(h.live,`d${i}`,{type:"response.created",response:{id:`r${i}`}});
      event(h.live,`d${i}`,{type:"response.incomplete",response:{id:`r${i}`,status:"incomplete",output:[]}});await settle();
    }
    expect(h.call.closed).toBe(true);
  });
  it("ends a timed-out physical backend run without authorizing a duplicate action",async()=>{
    const h=await fixture();conversation(h);event(h.live,"slow",{type:"response.created",response:{id:"slow-response"}});
    await vi.advanceTimersByTimeAsync(30001);await settle();expect(h.call.closed).toBe(true);expect(h.hangup).not.toHaveBeenCalled();
  });
});
