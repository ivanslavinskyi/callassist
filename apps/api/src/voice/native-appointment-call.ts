import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { nativeAppointmentProposalSchema, type NativeAppointmentAction, type NativeAppointmentExecutionAuthorization } from "@callassist/contracts";
import type { NativeLiveStore } from "../storage/native-live-store";
import { validateNativeAppointment } from "../appointments/native-appointment-authorization";
import { verifyNativeTerms } from "../appointments/native-terms-evidence";
import { pcmuHasSpeech } from "./pcmu-activity";

const resultSchema=z.strictObject({actionId:z.uuid(),episode:z.number().int().min(1).max(10),
  outcome:z.enum(["confirmed","declined","uncertain"]),
  assistantQuote:z.string().min(1).max(8000).describe("Short exact assistant-only request/readback or status question. Never include recipient words."),
  recipientQuote:z.string().min(1).max(8000).describe("Short exact recipient-only result or correction. Never include the assistant's question, combine speakers or rewrite ASR. A yes answering a clear status question is quoted as just the recipient's yes; put the question in assistantQuote."),
  latestRecipientQuote:z.string().min(1).max(8000).describe("Short exact quote from the latest recipient fragment; may equal recipientQuote. No assistant words."),
  detailsMatch:z.boolean().describe("True when the observed result unambiguously concerns this action/person/proposal after all corrections. For declined, true means this proposal was rejected, including an explicit replacement offer; it does NOT mean the replacement has the same details. For confirmed, all authorized details must be confirmed. False means ambiguous or unrelated evidence."),previousAppointmentReleased:z.boolean()});
const prepareSchema=z.strictObject({proposal:nativeAppointmentProposalSchema.extend({
  operation:nativeAppointmentProposalSchema.shape.operation.describe("Keep the approved operation. confirm_existing commits attendance; it is not an informational status_check."),
  unavailableAlternatives:nativeAppointmentProposalSchema.shape.unavailableAlternatives.describe("Only earlier alternative IDs from the approved ordered alternatives, never the selected alternative itself or a previously rejected date. Use [] for the first/only alternative, including a changed date within it.")
}),intent:z.enum(["request","status_check"])});
export const nativeAppointmentTools=[
  {type:"function",name:"prepare_appointment",strict:true,description:"Check and journal a concrete appointment action BEFORE Live requests the commitment. This grants permission only. Same proposal is idempotent. If delivery or existing booking is uncertain, use status_check for the same proposal; never repeat a booking request. Return exact recipient quotes for conditions and earlier unavailable alternatives.",parameters:z.toJSONSchema(prepareSchema)},
  {type:"function",name:"record_appointment_result",strict:true,description:"Record the provider's result for the current proposal. Use short exact observed quotes, retaining meaningful negation and corrections; do not copy unrelated ASR noise or paraphrase. assistantQuote identifies the request or status question; recipientQuote gives its result; latestRecipientQuote anchors the latest observed reply. detailsMatch binds the outcome to this proposal: true for its explicit rejection as well as its exact confirmation. An explicit counteroffer rejecting this proposal is declined, not uncertain just because the new details differ. Availability or an unrelated yes is not confirmation. Confirmed requires observed playback; reschedule also requires release/replacement of the old appointment. This records a recipient statement, not external calendar verification.",parameters:z.toJSONSchema(resultSchema)}
];
type Fragment={role:"assistant"|"recipient";text:string;start:number;end:number;sequence:number};
type Ports={store:NativeLiveStore;callId:string;attemptId:string;snapshotHash:string;representedPerson:string;locale:string;
  mark(name:string):void;trace(event:Record<string,unknown>):void;changed?(record:NativeAppointmentAction):void};

/** Only action boundaries are journaled. No TTS, task-turn scheduler or per-turn model calls. */
export class NativeAppointmentCall {
  #action:NativeAppointmentAction|null=null;#fragments:Fragment[]=[];#sequence=0;#fromSequence=0;
  #mark:string|null=null;#markSequence=0;#voiceMs=0;#caption=false;#timer:ReturnType<typeof setTimeout>|null=null;
  #queue:Promise<unknown>=Promise.resolve();#closed=false;#generation=0;
  #playbackWaiters=new Set<()=>void>();
  constructor(readonly authority:NativeAppointmentExecutionAuthorization,private readonly ports:Ports){}
  get action(){return this.#action;}
  #checkCurrentTerms(action:NativeAppointmentAction){
    const current=this.#fragments.filter(f=>f.role==="recipient").map(f=>f.text).join("");
    // A restored status check keeps the host-validated original receipt; new
    // observations can invalidate it without asking for the old quote again.
    const saved=action.termsEvidence?.quote;
    const text=saved&&!current.includes(saved)?`${saved}\n${current}`:current;
    return verifyNativeTerms(action.proposal,text,{price:!!this.authority.limits.maxTotalPrice,duration:!!this.authority.limits.finishBy});
  }
  observesRecipient(quote:string){return quote.trim().length>0&&this.#fragments.filter(f=>f.role==="recipient").map(f=>f.text).join("").includes(quote);}
  async restore(){
    this.#action=await this.ports.store.readAction(this.ports.attemptId);
    if(this.#action&&(this.#action.callBriefId!==this.ports.callId||this.#action.callAttemptId!==this.ports.attemptId||this.#action.snapshotHash!==this.ports.snapshotHash))throw Error("LIVE_ACTION_BINDING_INVALID");
    if(this.#action && ["authorized","delivered"].includes(this.#action.state))await this.#save({...this.#action,state:"uncertain",delivery:{...this.#action.delivery,status:"interrupted"}});
  }
  #serialized<T>(work:()=>Promise<T>):Promise<T>{const next=this.#queue.then(work);this.#queue=next.catch(()=>{});return next;}
  async #save(value:NativeAppointmentAction){
    const next={...value,revision:(this.#action?.revision??0)+1,updatedAt:new Date().toISOString()};
    this.#action=await this.ports.store.saveAction(next);this.ports.changed?.(this.#action);
    for(const wake of [...this.#playbackWaiters])wake();
    this.ports.trace({type:"appointment.state",actionId:next.id,revision:next.revision,state:next.state,episode:next.episode});return this.#action;
  }
  transcript(role:Fragment["role"],text:string,start:number,end:number){
    if(this.#closed||!text)return;
    this.#fragments.push({role,text,start,end,sequence:++this.#sequence});
    this.#fragments=this.#fragments.slice(-512);
    if(role==="assistant"&&this.#action?.state==="authorized"){this.#caption=true;this.#arm();}
  }
  audio(payload:string){
    if(this.#closed||this.#action?.state!=="authorized"||!pcmuHasSpeech(Buffer.from(payload,"base64")))return;
    this.#voiceMs+=Buffer.byteLength(payload,"base64")/8;this.#arm();
  }
  #arm(){
    if(this.#timer)clearTimeout(this.#timer);this.#mark=null;
    if(this.#voiceMs<100||!this.#caption)return;
    this.#timer=setTimeout(()=>{
      this.#timer=null;if(this.#closed||this.#action?.state!=="authorized")return;
      this.#mark=`native-action:${this.#action.id}:${this.#action.episode}:${++this.#markSequence}`;
      this.ports.mark(this.#mark);this.ports.trace({type:"appointment.mark_sent",mark:this.#mark});
    },1000);this.#timer.unref?.();
  }
  interrupt(){
    if(this.#closed)return;
    this.#generation++;
    if(this.#timer)clearTimeout(this.#timer);this.#timer=null;this.#mark=null;
    if(this.#action?.state==="authorized"&&this.#voiceMs>0)void this.#serialized(async()=>{
      if(this.#action?.state==="authorized")await this.#save({...this.#action,state:"uncertain",delivery:{...this.#action.delivery,status:"interrupted"}});
    }).catch(()=>this.ports.trace({type:"appointment.persist_failed"}));
  }
  acknowledge(mark:string){
    if(!mark.startsWith("native-action:"))return false;
    if(this.#closed||mark!==this.#mark||this.#action?.state!=="authorized")return true;
    this.#mark=null;const id=this.#action.id,episode=this.#action.episode,generation=this.#generation;
    void this.#serialized(async()=>{
      if(this.#action?.id!==id||this.#action.episode!==episode||this.#action.state!=="authorized"||this.#closed||generation!==this.#generation)return;
      const assistantQuote=this.#episodeText("assistant");
      await this.#save({...this.#action,state:"delivered",delivery:{status:"played",mark,assistantQuote,observedAt:new Date().toISOString()}});
    }).catch(()=>this.ports.trace({type:"appointment.persist_failed"}));return true;
  }
  #episodeText(role:Fragment["role"]){return this.#fragments.filter(f=>f.role===role&&f.sequence>this.#fromSequence).map(f=>f.text).join("");}
  async tool(name:string,args:unknown,current:()=>boolean){
    const pending=name==="record_appointment_result"?resultSchema.safeParse(args):null;
    if(pending?.success&&pending.data.outcome==="confirmed"&&this.#action?.state==="authorized"&&
      pending.data.actionId===this.#action.id&&pending.data.episode===this.#action.episode){
      // Do not hold the mutation queue while the mark callback saves delivery.
      // A fast human confirmation needs neither polling nor another question.
      const id=this.#action.id,episode=this.#action.episode;
      await new Promise<void>(resolve=>{
        const finish=()=>{clearTimeout(timer);this.#playbackWaiters.delete(wake);resolve();};
        const wake=()=>{if(this.#closed||this.#action?.id!==id||this.#action.episode!==episode||this.#action.state!=="authorized")finish();};
        const timer=setTimeout(finish,3000);timer.unref?.();this.#playbackWaiters.add(wake);wake();
      });
    }
    return this.#serialized(async()=>{
    if(this.#closed||!current())return {ok:false,reason:"stale_request"};
    if(name==="prepare_appointment")return this.#prepare(args,current);
    if(name==="record_appointment_result")return this.#result(args,current);
    return {ok:false,reason:"unknown_tool"};
  });}
  async #prepare(args:unknown,current:()=>boolean):Promise<Record<string,unknown>>{
    const parsed=prepareSchema.safeParse(args);if(!parsed.success)return {ok:false,reason:"invalid_arguments"};
    const text=this.#fragments.filter(f=>f.role==="recipient").map(f=>f.text).join("");
    const {requirements:_requirements,unavailableAlternatives:_unavailable,selectionEvidence:_selection,termsQuote:_terms,...identity}=parsed.data.proposal;
    const proposalHash=createHash("sha256").update(JSON.stringify({snapshotHash:this.ports.snapshotHash,proposal:identity})).digest("hex");
    const previous=this.#action;
    // A restored status enquiry reuses the exact durable proposal and its
    // validated evidence. It neither needs the old transcript in memory nor
    // grants permission for a second commitment or altered conditions.
    const recovery=parsed.data.intent==="status_check"&&previous&&previous.state!=="declined"&&previous.proposalHash===proposalHash;
    const checked=recovery?{ok:true as const,proposal:previous.proposal,startsAt:null,termsEvidence:previous.termsEvidence}:
      validateNativeAppointment(this.authority,parsed.data.proposal,text,new Date());
    if(!checked.ok)return checked;
    if(previous && previous.state!=="declined") {
      if(previous.proposalHash!==proposalHash)return {ok:false,reason:"existing_action_requires_resolution",action:previous,instruction:"First record the existing proposal's result from observed evidence. If the provider explicitly rejected it or corrected it to a different offer, record declined with detailsMatch true for that rejection, then prepare the replacement within the approved bounds. Ask a status question only if the old proposal's result is genuinely unknown; never repeat an answered question or create a duplicate arrangement."};
      if(previous.state==="confirmed" || previous.state==="authorized")return {ok:true,action:previous,instruction:previous.state==="confirmed"?"Provider confirmation is already recorded. Do not book again.":"This is the same authorized proposal; do not issue a duplicate request."};
      if(parsed.data.intent!=="status_check")return {ok:false,reason:"status_check_required",action:previous};
      if(previous.episode>=10)return {ok:false,reason:"reconciliation_limit"};
    }
    const now=new Date().toISOString();
    const action:NativeAppointmentAction={schemaVersion:1,id:previous&&previous.state!=="declined"?previous.id:randomUUID(),
      callBriefId:this.ports.callId,callAttemptId:this.ports.attemptId,revision:1,snapshotHash:this.ports.snapshotHash,proposalHash,
      representedPerson:this.ports.representedPerson,proposal:checked.proposal,state:"authorized",intent:parsed.data.intent,
      ...(checked.termsEvidence?{termsEvidence:checked.termsEvidence}:{}),
      episode:previous&&previous.state!=="declined"?previous.episode+1:1,
      delivery:{status:"not_observed",mark:null,assistantQuote:null,observedAt:null},confirmation:null,authorizedAt:now,updatedAt:now};
    this.#generation++;if(this.#timer)clearTimeout(this.#timer);this.#timer=null;this.#voiceMs=0;this.#caption=false;this.#mark=null;
    await this.#save(action);
    this.#fromSequence=this.#sequence;
    if(!current()||this.#closed){await this.#save({...this.#action!,state:"uncertain",delivery:{...action.delivery,status:"interrupted"}});return {ok:false,reason:"stale_request"};}
    return {ok:true,action:this.#action,startsAt:checked.startsAt,
      dateLabel:new Intl.DateTimeFormat(this.ports.locale,{timeZone:"UTC",weekday:"long",year:"numeric",month:"long",day:"numeric"}).format(new Date(`${checked.proposal.date}T12:00:00Z`)),
      instruction:parsed.data.intent==="status_check"?"Only an informational status check of this exact arrangement is authorized, not another commitment.":"This exact operation and its person, date, time and conditions are authorized, not completed. The provider's result must be recorded before success is reported."};
  }
  async #result(args:unknown,current:()=>boolean):Promise<Record<string,unknown>>{
    const parsed=resultSchema.safeParse(args);if(!parsed.success)return {ok:false,reason:"invalid_arguments"};
    const value=parsed.data,action=this.#action;
    if(!action||value.actionId!==action.id||value.episode!==action.episode)return {ok:false,reason:"action_mismatch",
      currentAction:action?{actionId:action.id,episode:action.episode}:null,
      instruction:"Re-evaluate the current action and use its exact actionId and episode. Do not repeat the commitment or apply evidence from another action."};
    const assistant=this.#episodeText("assistant"),recipient=this.#episodeText("recipient");
    if(value.outcome==="confirmed"&&action.termsEvidence){
      const evidence=this.#checkCurrentTerms(action);
      if(!evidence.ok){
        if(action.state==="confirmed")await this.#save({...action,state:"uncertain",confirmation:null});
        return {ok:false,reason:evidence.reason,instruction:"The terms need reconciliation from the latest recipient evidence. Do not repeat the commitment or announce success."};
      }
    }
    if(action.state===value.outcome)return {ok:true,action,instruction:"Already recorded; do not repeat the booking or closing summary."};
    const span=(role:Fragment["role"],quote:string)=>{
      const fragments=this.#fragments.filter(f=>f.role===role&&f.sequence>this.#fromSequence),text=fragments.map(f=>f.text).join("");
      const index=text.lastIndexOf(quote);if(index<0)return null;let offset=0;
      const matched=fragments.filter(f=>{const from=offset;offset+=f.text.length;return offset>index&&from<index+quote.length;});
      return matched.length?{start:Math.min(...matched.map(f=>f.start)),end:Math.max(...matched.map(f=>f.end)),sequence:matched.at(-1)!.sequence}:null;
    };
    const spoken=span("assistant",value.assistantQuote),reply=span("recipient",value.recipientQuote),latest=span("recipient",value.latestRecipientQuote);
    const latestRecipient=this.#fragments.findLast(f=>f.role==="recipient")?.sequence;
    if(!assistant.includes(value.assistantQuote)||!recipient.includes(value.recipientQuote))return {ok:false,reason:"observed_evidence_required",
      observedAssistantReadback:action.delivery.assistantQuote,observedRecipientTail:recipient.slice(-8000),instruction:"Use literal observed readback and result text, not a later closing or paraphrase. Repair arguments without asking for information already supplied."};
    if(value.outcome==="confirmed"&&action.state==="authorized")return {ok:false,reason:"playback_pending",instruction:"Await the playback observation, then retry this result without another spoken question or appointment request."};
    // Fragment intervals are approximate and can overlap in full duplex. Reject
    // a wholly earlier reply; meaning and exact readback remain backend checks.
    if(value.outcome==="confirmed" && (!value.detailsMatch||!spoken||!reply||reply.end<=spoken.start||!latest||latest.sequence!==latestRecipient||action.state!=="delivered"||action.delivery.status!=="played"||
      !action.delivery.assistantQuote?.includes(value.assistantQuote)||(this.authority.operation==="reschedule"&&!value.previousAppointmentReleased)))
      return {ok:false,reason:"confirmation_not_established",action,instruction:"Keep the result uncertain. If necessary ask one status clarification for the same arrangement, never request a duplicate booking."};
    if(value.outcome==="declined" && (!value.detailsMatch||!spoken||!reply||reply.end<=spoken.start||!latest||latest.sequence!==latestRecipient))return {ok:false,reason:"decline_not_established",
      instruction:"detailsMatch must be true when the evidence explicitly rejects THIS proposal, including a correction to a different offer. It does not require the offered replacement to match the rejected details. Use short exact quotes of the request/status question, rejection and latest reply. Re-evaluate existing evidence without another question; retain uncertainty if the rejection is ambiguous."};
    if(value.outcome==="declined"&&action.state==="confirmed")return {ok:false,reason:"confirmed_action_requires_reconciliation",instruction:"A contradiction after confirmation is uncertain. Record uncertainty and clarify the status of the same arrangement before considering another proposal."};
    if(!current())return {ok:false,reason:"stale_request"};
    await this.#save({...action,state:value.outcome,confirmation:value.outcome==="confirmed"?{
      recipientQuote:value.recipientQuote,observedAt:new Date().toISOString(),source:"recipient_statement",independentlyVerified:false}:null,
      delivery:value.outcome==="uncertain"?{...action.delivery,status:"interrupted"}:action.delivery});
    if(!current()&&this.#action?.state==="confirmed"){
      await this.#save({...this.#action,state:"uncertain",confirmation:null});
      return {ok:false,reason:"stale_request",action:this.#action};
    }
    return {ok:true,action:this.#action,instruction:value.outcome==="confirmed"?"The provider's confirmation is recorded for this proposal and represented person. No further confirmation question is required.":"This result is not confirmation. A declined proposal permits preparing a replacement within the approved authority; an uncertain result requires reconciliation."};
  }
  async settled(reconcileTerms=false){
    await this.#queue;
    if(reconcileTerms&&!this.#closed)await this.#serialized(async()=>{
      if(this.#action?.state==="confirmed"&&this.#action.termsEvidence&&!this.#checkCurrentTerms(this.#action).ok)
        await this.#save({...this.#action,state:"uncertain",confirmation:null});
    });
    return this.#action;
  }
  close(){if(this.#closed)return;this.#closed=true;this.#generation++;
    for(const wake of [...this.#playbackWaiters])wake();
    void this.#serialized(async()=>{if(this.#action&&["authorized","delivered"].includes(this.#action.state))
      await this.#save({...this.#action,state:"uncertain",confirmation:null,delivery:{...this.#action.delivery,status:"interrupted"}});
    }).catch(()=>this.ports.trace({type:"appointment.persist_failed"}));if(this.#timer)clearTimeout(this.#timer);this.#timer=null;this.#mark=null;this.#fragments=[];}
}
