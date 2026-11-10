import { randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import { planOnlyExecutionSnapshotSchema, type CallSnapshot, type TerminalDecision } from "@callassist/contracts";
import type { OpenAILiveBridgeOptions, LiveLifecycle } from "./openai-live-bridge";
import { OpenAILiveConversation } from "./live-conversation";
import type { VoiceConversationContext } from "./voice-runtime";
import type { CallAttemptRecord } from "../storage/call-repository";
import { nativeV2Session, nativeActionAuthority, NATIVE_V2_PROMPT_VERSION } from "./live-task-context";
import { nativeConfigurationIdentity, NATIVE_TRACE_DRAIN_MS } from "./live-native-configuration";
import { decodePcmu, pcmuHasSpeech } from "./pcmu-activity";
import { LiveNativeClosing, closingEvidence } from "./live-native-closing";
import { LiveProtocolTrace } from "./live-protocol-trace";
import { liveRuntimeDescriptor } from "./runtime-descriptor";
import { object } from "./live-usage";
import { NativeAppointmentCall } from "./native-appointment-call";
import type { NativeSession } from "./live-native-prompts";
import { hasNativeFarewellCue, NATIVE_CLOSING_REVIEW, NATIVE_COMPLETION_TIMING, NATIVE_INTERRUPTED_CLOSING_REVIEW, NATIVE_CLOSING_SUSPENDED, NATIVE_CLOSING_EMPTY_REVIEW } from "./live-native-completion";

/** A media/session lifecycle, not a conversation scheduler. No consent flow,
 * application TTS, scripted task turns or backend-driven speech permission. */
export class NativeLiveV2Call implements LiveLifecycle {
  #closed=false; #ready=false; #admitted=false; #stream=""; #provider="";
  #socket: WebSocket | undefined; #live: OpenAILiveConversation | undefined;
  #context: VoiceConversationContext | undefined; #session: NativeSession | undefined;
  #trace: LiveProtocolTrace | undefined; #starting: Promise<void> | undefined;
  #observations: Array<{id:string;text:string}>=[]; #inputRevision=0; #decisionRevision=0;
  #suspendedClosing=false; #interruptedReviewRevision:number|null=null; #closingRecoveryNotified=false;
  #decision: TerminalDecision | null=null; #discarding=false; #hangup=false;
  #idle: ReturnType<typeof setTimeout> | undefined; #maximum: ReturnType<typeof setTimeout> | undefined;
  #traceCloseTimer: ReturnType<typeof setTimeout> | undefined;
  #incomplete=false; #speaking=false; #answering: ReturnType<typeof setInterval> | undefined;
  #appointment: NativeAppointmentCall | undefined;
  #admitting=false; #earlyAudio:string[]=[]; #earlyAudioBytes=0;
  #backendFailures=0;
  #firstAudioForwarded=false; #awaitingSpeechAfterInput=false;
  #lastSpeechForwardAt:number|null=null;
  #completionReminder:ReturnType<typeof setTimeout>|undefined;
  #reviewedActionBoundaries=new Set<string>();#actionInputBaseline=0;#inputSpeaking=false;
  #closingReviewedContext:string|null=null;#farewellReviewedContext:string|null=null;
  #assistantReviewText="";#hasRecipientWords=false;#farewellCue=false;
  #backendReviewedText:string|null=null;
  #completionReady=false;#completionDeferred=false;
  #completionCandidate:{kind:"closing"|"result";reason:string;inputRevision:number;reviewContext:string;actionBoundary?:string;farewell:boolean;content:string}|undefined;
  readonly closing: LiveNativeClosing;
  constructor(private readonly options: OpenAILiveBridgeOptions) {
    this.closing=new LiveNativeClosing({ continuous:true,
      mark:name=>this.#send({event:"mark",streamSid:this.#stream,mark:{name}}),
      observe:(phase,revision,mark)=>this.#trace?.event("host",{type:"closing.playback",phase,revision,mark}),
      drained:()=>{ if(this.#decision) void this.#finish(); }, failed:code=>this.#fail(code) });
  }
  get closed() { return this.#closed; }
  dispose() { this.#close("socket_closed"); }
  async preflight(callId:string,attemptId:string) {
    if (this.#starting) return this.#starting;
    this.#starting=(async()=>{
      const snapshot=await this.options.service.get(callId), attempt=await this.options.service.getLatestAttempt(callId);
      if(!snapshot?.compilation || !attempt?.executionSnapshot || attempt.id!==attemptId || !["dialing","in_progress"].includes(attempt.status))
        throw new Error("LIVE_ATTEMPT_UNAVAILABLE");
      await this.#initialize(snapshot,attempt);
      await this.#live!.start(); // Provider rejects over-budget startup before dial.
      if(this.#closed) throw new Error("LIVE_PREFLIGHT_FAILED");
    })();
    try { await this.#starting; } catch(error) { this.dispose(); throw error; }
  }
  async prepare(binding:{callBriefId:string;callAttemptId:string;providerCallId:string;compilationSnapshotHash:string}) {
    await this.preflight(binding.callBriefId,binding.callAttemptId);
  }
  async #initialize(snapshot:CallSnapshot,attempt:CallAttemptRecord) {
    if(attempt.executionSnapshot?.version!==10) throw new Error("LIVE_V2_REAPPROVAL_REQUIRED");
    const execution=planOnlyExecutionSnapshotSchema.parse(attempt.executionSnapshot);
    if(!this.options.agentHangupEnabled) throw new Error("LIVE_V2_HANGUP_REQUIRED");
    this.#session=nativeV2Session(execution);
    const privacy=await this.options.service.repository.nativeLive.get(attempt.id);
    if(!privacy || privacy.state!=="active") throw new Error("LIVE_ATTEMPT_UNAVAILABLE");
    this.#trace=new LiveProtocolTrace(this.options.service.repository.nativeLive,attempt.id,
      code=>this.options.logger?.warn({callAttemptId:attempt.id,code},"Live trace unavailable"));
    const identities=execution.runtime.spokenIdentities;
    const context:VoiceConversationContext={ brief:{id:execution.callBriefId, locale:execution.plan.callLocale, voiceGender:execution.runtime.voiceGender,
      representedPerson:identities!.representedPerson.spoken, recipientName:identities!.recipient.spoken}, snapshot:execution,attemptId:attempt.id,
      sendAudio:payload=>this.audio(payload), clearPlayback:()=>{},requestFarewell:()=>false,interruptFarewell:()=>false,
      isClosing:()=>this.closing.active,
      trace:(direction,event)=>{
        this.#trace?.event(direction,event);
        if(event.type==="session.closed") {clearTimeout(this.#traceCloseTimer);void this.#trace?.close();}
      },
      telemetry:(key,payload)=>{ void this.options.service.recordTelemetry(snapshot.brief.id,{callAttemptId:attempt.id,idempotencyKey:key,payload})
        .catch(()=>this.options.logger?.warn({callAttemptId:attempt.id},"Live lifecycle telemetry unavailable")); },
      fail:()=>this.#fail("LIVE_TRANSPORT_FAILED") };
    this.#context=context;
    const authority=nativeActionAuthority(execution);
    if(authority){
      this.#appointment=new NativeAppointmentCall(authority,{store:this.options.service.repository.nativeLive,
        callId:snapshot.brief.id,attemptId:attempt.id,snapshotHash:execution.compilationSnapshotHash,
        representedPerson:context.brief.representedPerson,locale:execution.plan.callLocale,
        mark:name=>this.#send({event:"mark",streamSid:this.#stream,mark:{name}}),
        trace:event=>this.#trace?.event("host",event),
        changed:record=>this.#actionChanged(record)});
      await this.#appointment.restore();
    }
    const descriptor=liveRuntimeDescriptor(context,snapshot.compilation!,this.#session.instructions,{
      live:this.options.liveModel??"gpt-live-1",delegation:this.options.delegationModel??"gpt-6-luna",speech:"none"});
    descriptor.runtime="live_native_v2";descriptor.runtimeVersion="live-native-v2";descriptor.implementationVersion=NATIVE_V2_PROMPT_VERSION;
    descriptor.disclosureVersion="nativeOpening" in execution?execution.nativeOpening.version:null;
    descriptor.nativeConfiguration=nativeConfigurationIdentity(this.#session,this.options.delegationModel);
    descriptor.experiment={requested:"native_v2",selection:"eligible",briefHash:this.#session.briefHash,
      briefUtf8Bytes:this.#session.briefUtf8Bytes,closing:"native_quiet_tail_v2",interruption:"native"};
    await this.options.service.recordRuntimeDescriptor(snapshot.brief.id,attempt.id,descriptor);
    this.#live=new OpenAILiveConversation(this.options,context,this,this.#session);
  }
  #actionChanged(record:import("@callassist/contracts").NativeAppointmentAction){
    if(this.#closed||this.#discarding||!this.#ready)return;
    if(record.state==="authorized")this.#actionInputBaseline=this.#inputRevision;
    // Boundary update only; never a per-turn report or a speech command.
    const next=record.state==="delivered"
      ? "Playback of the authorized request is observed; this is NOT the provider's result. When the provider answers (or if they already answered), Generate <|SpawnThinking|> for record_appointment_result before announcing completion."
      : record.state==="confirmed"
        ? "The provider's confirmation is recorded for this proposal. No further confirmation question is needed."
        : record.state==="uncertain"
          ? "The outcome is uncertain. Use status_check for the identical proposal; never repeat the commitment."
          : record.state==="declined"
            ? "This proposal was rejected. Do not ask about it again. A replacement may be prepared within the approved authority using the provider's existing offer; the replacement is not yet authorized."
          : "The proposal is authorized, not confirmed. The provider's answer to the authorized request must be recorded before reporting success.";
    this.#live?.nativeState(next+"\n"+JSON.stringify({applicationAppointmentState:{actionId:record.id,proposalHash:record.proposalHash,
      episode:record.episode,revision:record.revision,state:record.state,delivery:record.delivery.status,intent:record.intent,
      proposal:{...record.proposal,requirements:[],unavailableAlternatives:[],termsQuote:null,selectionEvidence:null},
      recovery:"For status_check of this identical proposal, the host reuses its durable validated evidence. Do not repeat the commitment."}}));
    this.#armCompletionReminder();
  }
  #armCompletionReminder(){
    clearTimeout(this.#completionReminder);
    this.#completionReady=false;this.#completionDeferred=false;this.#completionCandidate=undefined;
    if(this.#closed||this.#discarding||this.#decision||!this.#ready||!this.#admitted||this.#inputSpeaking)return;
    const action=this.#appointment?.action;
    const boundary=action?`${action.id}:${action.episode}:${action.state}`:undefined;
    // Deduplicate settled conversation content, not just the recipient's turn.
    // A later assistant conclusion can need recovery without any new input.
    // Punctuation-only caption updates and audio/silence do not change this key;
    // the existing quiet timer still waits for speech to settle before review.
    const reviewContext=`${this.#inputRevision}:${closingEvidence(this.#assistantReviewText)}`;
    const common={inputRevision:this.#inputRevision,reviewContext,farewell:false};
    const fast=!this.#suspendedClosing&&this.#farewellCue&&this.#farewellReviewedContext!==reviewContext;
    let delay:number=NATIVE_COMPLETION_TIMING.actionBoundaryMs;
    if(!this.#suspendedClosing&&!fast&&action?.state==="delivered"&&this.#inputRevision>this.#actionInputBaseline&&!this.#reviewedActionBoundaries.has(boundary!)){
      this.#completionCandidate={...common,kind:"result",actionBoundary:boundary,reason:"delivered_action_without_result",
        content:"The authorized appointment request has been delivered and the recipient has spoken, but no result is recorded. Review the latest observed conversation and current action state. If the provider's result is already available, call record_appointment_result using actual quotes, including all later corrections. Otherwise let Live clarify the missing result. Never repeat the original commitment, claim success from delivery alone, or ask for information already provided. This review itself grants no action or disconnection permission."};
    }else if(this.#hasRecipientWords&&this.#assistantReviewText.trim()){
      const confirmed=action?.state==="confirmed"&&!this.#reviewedActionBoundaries.has(boundary!);
      // Do not immediately re-review the same quiet text just handled by the
      // backend. New speech still enables the language-independent fallback.
      if(!this.#suspendedClosing&&!fast&&!confirmed&&this.#assistantReviewText===this.#backendReviewedText)return;
      if(!fast&&!confirmed&&(this.#closingReviewedContext===reviewContext||this.#farewellReviewedContext===reviewContext))return;
      delay=fast?NATIVE_COMPLETION_TIMING.farewellQuietMs:confirmed?NATIVE_COMPLETION_TIMING.actionBoundaryMs:NATIVE_COMPLETION_TIMING.quietEpisodeMs;
      this.#completionCandidate={...common,kind:"closing",farewell:fast,actionBoundary:confirmed?boundary:undefined,
        reason:this.#suspendedClosing?"interrupted_accepted_closing":fast?"farewell_without_end_call":confirmed?"confirmed_action_without_end_call":"quiet_episode_without_end_call",content:this.#suspendedClosing?NATIVE_INTERRUPTED_CLOSING_REVIEW:NATIVE_CLOSING_REVIEW};
    }else return;
    // Speech resets the timer; backend completion wakes a due check without polling.
    this.#completionReminder=setTimeout(()=>{this.#completionReady=true;this.#flushCompletionReview();},delay);
    this.#completionReminder.unref?.();
  }
  #flushCompletionReview(){
    const candidate=this.#completionCandidate;
    if(!this.#completionReady||!candidate||this.#closed||this.#discarding||this.#decision||this.#inputSpeaking||candidate.inputRevision!==this.#inputRevision)return;
    if(this.#live?.backendPending){
      if(!this.#completionDeferred)this.#trace?.event("host",{type:"completion.review_deferred",reason:"backend_busy",candidate:candidate.reason});
      this.#completionDeferred=true;return;
    }
    if(!this.#live?.nativeReview(candidate.content))return;
    this.#completionReady=false;
    if(candidate.reason==="interrupted_accepted_closing")this.#interruptedReviewRevision=candidate.inputRevision;
    if(candidate.actionBoundary)this.#reviewedActionBoundaries.add(candidate.actionBoundary);
    if(candidate.kind==="closing"){
      this.#closingReviewedContext=candidate.reviewContext;
      if(candidate.farewell)this.#farewellReviewedContext=candidate.reviewContext;
    }
    this.#trace?.event("host",{type:candidate.kind==="closing"?"closing.backend_review":"appointment.backend_review",
      reason:candidate.reason,inputRevision:this.#inputRevision,profile:this.#session?.profile});
  }
  attach(socket:WebSocket,initial?:RawData) {
    this.#socket=socket;
    socket.on("message",data=>{void this.#message(data).catch(()=>this.#fail("LIVE_MEDIA_ADMISSION_FAILED"));});
    socket.on("close",()=>this.#close("socket_closed"));socket.on("error",()=>this.#close("socket_closed"));
    if(initial) void this.#message(initial).catch(()=>this.#fail("LIVE_MEDIA_ADMISSION_FAILED"));
  }
  async #message(raw:RawData) {
    if(this.#closed) return;
    const event=object(JSON.parse(raw.toString()));
    if(event.event==="start") {
      if(this.#admitted||this.#admitting) throw new Error("LIVE_DUPLICATE_STREAM_START");
      const start=object(event.start),p=object(start.customParameters);
      if(typeof p.callBriefId!=="string"||typeof p.callAttemptId!=="string"||typeof p.compilationSnapshotHash!=="string"||
        typeof p.streamToken!=="string"||typeof start.callSid!=="string"||typeof(start.streamSid??event.streamSid)!=="string"||
        !this.options.validateStreamToken({callBriefId:p.callBriefId,callAttemptId:p.callAttemptId,compilationSnapshotHash:p.compilationSnapshotHash},p.streamToken))
        throw new Error("LIVE_STREAM_BINDING_INVALID");
      this.#admitting=true;
      const attempt=await this.options.service.getLatestAttempt(p.callBriefId);
      if(!attempt||attempt.id!==p.callAttemptId||attempt.providerCallId!==start.callSid||attempt.provider!=="twilio"||
        attempt.compilationSnapshotHash!==p.compilationSnapshotHash||!["dialing","in_progress"].includes(attempt.status)) throw new Error("LIVE_ATTEMPT_UNAVAILABLE");
      await this.preflight(p.callBriefId,attempt.id);
      const admitted=await this.options.service.transitionAnswering(p.callBriefId,{attemptId:attempt.id,providerCallId:start.callSid,
        snapshotHash:p.compilationSnapshotHash,kind:"admit",now:new Date().toISOString()});
      if(!admitted.applied||admitted.decision!=="consent"||this.#closed) {this.dispose();return;}
      this.#stream=String(start.streamSid??event.streamSid);this.#provider=start.callSid;this.#admitted=true;
      this.#admitting=false;
      this.#trace?.event("host",{type:"media.admitted",streamId:this.#stream});
      if(this.#ready) this.#begin();
      for(const payload of this.#earlyAudio)this.#live?.inputAudio(payload);
      this.#earlyAudio=[];this.#earlyAudioBytes=0;
      this.#answering=setInterval(()=>{void this.#checkAnswering().catch(()=>this.#fail("LIVE_ANSWERING_FAILED"));},1000);
      this.#answering.unref?.();
    } else if(event.event==="media" && !this.#discarding) {
      const audio=object(event.media).payload;
      if(typeof audio!=="string")return;
      if(this.#admitted)this.#live?.inputAudio(audio);
      else if(this.#admitting){
        const bytes=decodePcmu(audio);if(!bytes)throw new Error("LIVE_INVALID_INPUT_AUDIO");
        this.#earlyAudioBytes+=bytes.length;
        if(this.#earlyAudioBytes>128_000)throw new Error("LIVE_ADMISSION_AUDIO_LIMIT");
        this.#earlyAudio.push(audio);
      }
    } else if(event.event==="mark") {const name=object(event.mark).name;if(typeof name==="string"&&!this.#appointment?.acknowledge(name))this.closing.acknowledge(name);}
    else if(event.event==="dtmf" && this.#admitted) { this.#trace?.event("host",{type:"input.dtmf_ignored",reason:"voice_only_profile"}); }
    else if(event.event==="stop") this.#close("stream_stopped");
  }
  async #checkAnswering() {
    if(this.#closed||!this.#context)return;
    const snapshot=await this.options.service.get(this.#context.brief.id),state=snapshot?.brief.lifecycle?.answering;
    if(!state||state.phase==="pending")return;
    clearInterval(this.#answering);this.#answering=undefined;
    if(state.decision!=="consent") {
      this.#admitted=false;this.#live?.close();
      this.#send({event:"clear",streamSid:this.#stream});
      await this.options.service.dispatchAsyncAnswering(this.#context.brief.id,{attemptId:this.#context.attemptId,providerCallId:this.#provider,
        snapshotHash:this.#context.snapshot.compilationSnapshotHash,now:new Date().toISOString()});
    }
  }
  startup(){return {instructions:this.#session!.instructions,input:this.#session!.input};}
  ready(){this.#ready=true;if(this.#appointment?.action)this.#actionChanged(this.#appointment.action);if(this.#admitted)this.#begin();}
  #begun=false;
  #begin(){if(this.#begun||this.#closed)return;this.#begun=true;
    this.#trace?.event("host",{type:"startup.context",briefUtf8Bytes:this.#session!.briefUtf8Bytes,instructionCharacters:this.#session!.instructions.length});
    this.#live!.commentary(this.#session!.opening!);this.#touch();
    this.#maximum=setTimeout(()=>this.#fail("LIVE_DURATION_LIMIT"),10*60_000);this.#maximum.unref?.();}
  #touch(){clearTimeout(this.#idle);this.#idle=setTimeout(()=>this.#fail("LIVE_IDLE_TIMEOUT"),90_000);this.#idle.unref?.();}
  audio(payload:string){if(!this.#admitted||this.#closed||this.#discarding)return;
    this.#send({event:"media",streamSid:this.#stream,media:{payload}});this.closing.audio(payload);this.#appointment?.audio(payload);
    if(pcmuHasSpeech(Buffer.from(payload,"base64"))){
      this.#lastSpeechForwardAt=performance.now();
      if(!this.#firstAudioForwarded){this.#firstAudioForwarded=true;this.#trace?.event("host",{type:"output.first_speech_forwarded"});}
      if(this.#awaitingSpeechAfterInput){this.#awaitingSpeechAfterInput=false;this.#trace?.event("host",{type:"output.next_speech_forwarded"});}
      this.#armCompletionReminder();
    }
    if(!this.#speaking){this.#speaking=true;this.#context!.telemetry("live:v2:conversation:started",{name:"conversation.started",metadata:{}});}}
  activity(event:"started"|"stopped"|null){if(event){this.#inputSpeaking=event==="started";this.#awaitingSpeechAfterInput=event==="stopped";this.#trace?.event("host",{type:"input.activity",activity:event});this.#armCompletionReminder();}this.closing.activity(event);if(event==="started"){this.#touch();}}
  transcript(role:"recipient"|"assistant",text:string,_start:number,_end:number,_persist:()=>void){
    if(!this.#admitted||this.#discarding||this.#closed)return false;
    this.#appointment?.transcript(role,text,_start,_end);
    if(!text)return true;if(text.trim())this.#touch();
    if(role==="assistant"){
      this.closing.caption(text);this.#assistantReviewText=(this.#assistantReviewText+text).slice(-1600);
      this.#farewellCue=hasNativeFarewellCue(this.#assistantReviewText);
    }
    else{this.#inputRevision++;if(text.trim()){
      if(this.#decision&&!this.#suspendedClosing){
        this.#suspendedClosing=true;this.#closingRecoveryNotified=false;
        this.#live?.nativeState(NATIVE_CLOSING_SUSPENDED);
      }
      this.#decision=null;this.closing.pause();}
      if(/[\p{L}\p{N}]/u.test(text))this.#hasRecipientWords=true;
      this.#observations.push({id:`fragment-${this.#inputRevision}`,text:text.slice(0,8000)});this.#observations=this.#observations.slice(-8);}
    if(text.trim())this.#armCompletionReminder();
    return true;
  }
  async tool(call:{name:string;arguments:string},current:()=>boolean):Promise<Record<string,unknown>>{
    let args:Record<string,unknown>;try{args=object(JSON.parse(call.arguments));}catch{return{ok:false,reason:"invalid_arguments"};}
    const context=this.#context!;
    if(call.name==="stop_and_discard"){
      if(Object.keys(args).join()!=="reason"||!["conversation_refused","recording_refused","transcription_refused"].includes(String(args.reason)))return{ok:false,reason:"invalid_arguments"};
      if(this.#discarding)return{ok:true,state:"discard_requested"};
      this.#appointment?.close();this.#discarding=true;this.#decision=null;this.closing.cancel();this.#trace?.discard();
      this.#send({event:"clear",streamSid:this.#stream});
      try{await this.options.service.discardNativeConversation(context.brief.id,context.attemptId,String(args.reason));}
      finally{this.#close("stream_stopped");}
      return{ok:true,state:"discard_requested"};
    }
    if(!current()||this.#closed||this.#discarding)return{ok:false,reason:"stale_request"};
    if(call.name==="get_task_context"){
      if(Object.keys(args).join()!=="sectionId"||typeof args.sectionId!=="string")return{ok:false,reason:"invalid_arguments"};
      const section="contextAppendix" in context.snapshot?context.snapshot.contextAppendix.find(s=>s.id===args.sectionId):undefined;
      return section?{ok:true,section}:{ok:false,reason:"unknown_section"};
    }
    if(call.name==="prepare_appointment"||call.name==="record_appointment_result"){
      if(!this.#appointment)return{ok:false,reason:"appointment_not_authorized"};
      const action=this.#appointment.action;
      if(call.name==="record_appointment_result"&&action&&args.actionId===action.id&&args.episode===action.episode){
        // The backend is already handling this boundary, including any argument
        // repair. The missing-result watchdog must not duplicate that work.
        this.#reviewedActionBoundaries.add(`${action.id}:${action.episode}:${action.state}`);
        this.#armCompletionReminder();
      }
      return this.#appointment.tool(call.name,args,current);
    }
    if(call.name!=="end_call"||Object.keys(args).some(k=>!["reason","closingQuote","recipientQuote","noActionRequired"].includes(k))||!["objective_resolved","cannot_proceed","recipient_requested_end"].includes(String(args.reason)))return{ok:false,reason:"invalid_arguments"};
    if(!this.#appointment&&args.noActionRequired!=null)
      return{ok:false,reason:"no_action_required_not_applicable",instruction:"For this general task, retry end_call with noActionRequired: null, preserving the actual closingQuote and latest recipientQuote. This field is only for conditional appointment authority; do not repeat an already spoken closing."};
    const action=await this.#appointment?.settled(true);
    let noActionRequired:{conditionPlanPath:string;conditionPlanQuote:string;recipientQuote:string}|undefined;
    if(args.noActionRequired!=null){
      const evidence=object(args.noActionRequired);
      const path=typeof evidence.conditionPlanPath==="string"?evidence.conditionPlanPath:"";
      const match=/^(?:successCriteria\.(\d+)|conditionalFollowUps\.(\d+)\.condition)$/.exec(path);
      const plan=context.snapshot.plan;
      const condition=path==="localizedObjective"?plan.localizedObjective:match?.[1]!==undefined?plan.successCriteria[Number(match[1])]:match?.[2]!==undefined?plan.conditionalFollowUps[Number(match[2])]?.condition:undefined;
      if(!this.#appointment||action||args.reason!=="objective_resolved"||Object.keys(evidence).some(k=>!["conditionPlanPath","conditionPlanQuote","recipientQuote"].includes(k))||
        typeof evidence.conditionPlanQuote!=="string"||evidence.conditionPlanQuote.trim().length<2||evidence.conditionPlanQuote.length>2000||!condition?.includes(evidence.conditionPlanQuote)||
        typeof evidence.recipientQuote!=="string"||evidence.recipientQuote.length>2000||!this.#appointment.observesRecipient(evidence.recipientQuote))
        return {ok:false,reason:"conditional_resolution_evidence_required",instruction:"Use an actual conditional instruction in the approved task and its observed recipient answer. An unknown or attempted action is not not_required."};
      noActionRequired={conditionPlanPath:path,conditionPlanQuote:evidence.conditionPlanQuote,recipientQuote:evidence.recipientQuote};
    }
    if(this.#appointment&&args.reason==="objective_resolved"&&action?.state!=="confirmed"&&!noActionRequired)
      return {ok:false,reason:"appointment_result_unconfirmed",instruction:"Do not report success. Clarify the same proposal, or finish with its uncertainty and cannot_proceed."};
    if(!this.#observations.length)return{ok:false,reason:"recipient_evidence_required"};
    if(typeof args.closingQuote!=="string"||args.closingQuote.length>1600||!this.closing.observed(args.closingQuote))
      return{ok:false,reason:"closing_quote_not_observed",observedAssistantTail:this.closing.observedTail,instruction:"Use a literal observed span of the actual concluding speech. The outcome may precede thanks and goodbye. Wait for captions; do not invent a joined quote or repeat a delivered farewell."};
    if(typeof args.recipientQuote!=="string"||!closingEvidence(args.recipientQuote)||args.recipientQuote.length>1600||
      !closingEvidence(this.#observations.map(o=>o.text).join("")).endsWith(closingEvidence(args.recipientQuote)))
      return{ok:false,reason:"latest_recipient_evidence_required",observedRecipientTail:this.#observations.map(o=>o.text).join("").slice(-1600),instruction:"Re-evaluate the latest recipient speech. A reciprocal goodbye permits the same closing quote; a new question requires an answer."};
    if(this.#decision&&this.closing.active)return{ok:true,state:"closing_requested"};
    const inputRevision=this.#inputRevision;
    const decision:TerminalDecision={version:3,callBriefId:context.brief.id,callAttemptId:context.attemptId,snapshotHash:context.snapshot.compilationSnapshotHash,
      revision:++this.#decisionRevision,reason:args.reason as TerminalDecision["reason"],evidence:this.#observations.map(o=>o.id),observations:[...this.#observations],actionState:action?.state==="authorized"?"sending":action?.state==="declined"?null:action?.state??null,locale:context.snapshot.plan.callLocale,...(noActionRequired?{noActionRequired}:{})};
    await this.options.service.repository.recordTerminalDecision(decision);
    if(!current()||inputRevision!==this.#inputRevision||this.#discarding)return{ok:false,reason:"stale_request"};
    if(!this.closing.request(args.closingQuote))return{ok:false,reason:"closing_quote_not_observed"};
    this.#decision=decision;this.#suspendedClosing=false;this.#interruptedReviewRevision=null;this.#closingRecoveryNotified=false;
    return{ok:true,state:"closing_requested",instruction:"The spoken closing is observed. Listen quietly for corrections; no further farewell, tool acknowledgment or spoken confirmation is needed."};
  }
  async #finish(){if(this.#hangup||this.#closed||!this.#context)return;this.#hangup=true;
    this.#trace?.event("host",{type:"closing.hangup_requested",sinceLastSpeechForwardMs:this.#lastSpeechForwardAt===null?null:Math.round(performance.now()-this.#lastSpeechForwardAt)});
    this.#context.telemetry(`live:v2:closing:${this.#decisionRevision}`,{name:"conversation.hangup",metadata:{phase:"playback_complete",reason:this.#decision!.reason,generation:this.#decisionRevision,trigger:"playback_complete"}});
    try{await this.options.service.prepareAgentHangup(this.#context.brief.id,this.#context.attemptId,this.#provider);this.#trace?.event("host",{type:"closing.hangup_completed"});this.#close("agent_hangup");}
    catch{this.#fail("LIVE_HANGUP_FAILED");}}
  backendProgress(){this.#backendFailures=0;this.#flushCompletionReview();}
  backendIdle(result?:{usefulMessage:boolean;current:boolean;continuation:boolean}){
    if(this.#suspendedClosing&&result?.current){
      if(result.usefulMessage){
        // A current answer may arrive directly or after an approved tool lookup.
        // Other pending work must not preserve the obsolete closing deadline.
        this.#suspendedClosing=false;this.#interruptedReviewRevision=null;this.closing.cancel(true);
      }else if(!result.continuation&&!this.#live?.backendPending&&this.#interruptedReviewRevision!==null){
        const revision=this.#interruptedReviewRevision;this.#interruptedReviewRevision=null;
        if(revision===this.#inputRevision){
          this.closing.boundRecovery();
          if(!this.#closingRecoveryNotified){
            this.#closingRecoveryNotified=true;this.#live?.nativeState(NATIVE_CLOSING_EMPTY_REVIEW);
            this.#trace?.event("host",{type:"closing.empty_review_recovery",inputRevision:revision});
          }
        }
      }
    }
    if(!this.#live?.backendPending&&this.#completionReady&&this.#completionDeferred&&this.#completionCandidate?.reason==="quiet_episode_without_end_call"){
      this.#backendReviewedText=this.#assistantReviewText;
      this.#armCompletionReminder();
    }
    this.#flushCompletionReview();
  }
  backendFailed(current?:()=>boolean,code="LIVE_BACKEND_FAILED"){
    if(current&&!current())return;this.#trace?.event("host",{type:"backend.failure",code});
    if(code.includes("TIMEOUT")||++this.#backendFailures>2){this.#fail(code);return;}
    this.#live?.thinking("Backend work failed. Do not claim an unrecorded action succeeded. Preserve existing action state; use a fresh delegation only if still needed. Never repeat a commitment blindly.");
  }
  transcriptCaptureComplete(){return !this.#incomplete&&!this.#discarding;}
  #fail(code:string){this.#incomplete=true;this.#trace?.event("host",{type:"runtime.failure",code});this.#close("openai_error");}
  #send(event:object){if(this.#socket?.readyState===WebSocket.OPEN)this.#socket.send(JSON.stringify(event));}
  #close(reason:"socket_closed"|"stream_stopped"|"openai_error"|"agent_hangup"){
    if(this.#closed)return;this.#closed=true;this.#appointment?.close();this.closing.cancel();clearTimeout(this.#idle);clearTimeout(this.#maximum);clearInterval(this.#answering);clearTimeout(this.#completionReminder);
    if(this.#context&&this.#admitted)this.#context.telemetry(`live:v2:ended:${randomUUID()}`,{name:"conversation.ended",metadata:{reason}});
    this.#live?.close();if(this.#socket?.readyState===WebSocket.OPEN)this.#socket.close();
    this.#observations=[];
    this.#admitting=false;this.#earlyAudio=[];this.#earlyAudioBytes=0;
    this.#traceCloseTimer=setTimeout(()=>{this.#trace?.event("host",{type:"trace.drain_timeout"});void this.#trace?.close();},NATIVE_TRACE_DRAIN_MS);
    this.#traceCloseTimer.unref?.();
  }
}
