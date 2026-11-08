export const exportTimingEvents = new Set(["session.started","media.admitted","output.first_speech_forwarded","input.activity","output.next_speech_forwarded","closing.playback","response.event","response.item.create","closing.backend_review","appointment.backend_review","completion.review_deferred","startup.context","closing.hangup_requested","closing.hangup_completed"]);
/** Host-observed intervals. Forwarding audio does not prove recipient playback. */
export class ExportTiming {
 private admitted:number|null=null;private inputStopped:number|null=null;
 private marks=new Map<string,number>();private requests=new Map<string,number>();
 private tools=new Map<string,number>();private hangupRequested:number|null=null;private playbackDrained:number|null=null;
 private counters={closingRecovery:0,appointmentRecovery:0,backendBusyDeferrals:0,cancelledClosingPlayback:0};
 private context={briefUtf8Bytes:null as number|null,instructionCharacters:null as number|null,maxBackendInputTokens:null as number|null};
 private omittedSamples=0;
 readonly samples={traceStartToSessionStartedMs:[] as number[],admissionToFirstSpeechForwardMs:[] as number[],inputStopToNextSpeechForwardMs:[] as number[],closingMarkRoundTripMs:[] as number[],backendResponseMs:[] as number[],toolReadyToOutputMs:[] as number[],lastSpeechForwardToHangupRequestMs:[] as number[],playbackDrainedToHangupRequestMs:[] as number[],hangupRequestMs:[] as number[]};
 private add(key:keyof ExportTiming["samples"],start:number|null|undefined,end:number){if(start!=null&&end>=start){if(this.samples[key].length<256)this.samples[key].push(end-start);else this.omittedSamples++;}}
 observe(type:string,at:number,payload:Record<string,unknown>){
  if(type==="session.started")this.add("traceStartToSessionStartedMs",0,at);
  if(type==="closing.backend_review")this.counters.closingRecovery++;
  if(type==="appointment.backend_review")this.counters.appointmentRecovery++;
  if(type==="completion.review_deferred")this.counters.backendBusyDeferrals++;
  if(type==="startup.context")for(const key of ["briefUtf8Bytes","instructionCharacters"] as const)if(typeof payload[key]==="number")this.context[key]=payload[key];
  if(type==="closing.hangup_requested"){
   this.hangupRequested=at;this.add("playbackDrainedToHangupRequestMs",this.playbackDrained,at);
   if(typeof payload.sinceLastSpeechForwardMs==="number")this.add("lastSpeechForwardToHangupRequestMs",0,payload.sinceLastSpeechForwardMs);
  }
  if(type==="closing.hangup_completed")this.add("hangupRequestMs",this.hangupRequested,at);
  if(type==="media.admitted")this.admitted=at;
  if(type==="output.first_speech_forwarded")this.add("admissionToFirstSpeechForwardMs",this.admitted,at);
  if(type==="input.activity")this.inputStopped=payload.activity==="stopped"?at:null;
  if(type==="output.next_speech_forwarded"){this.add("inputStopToNextSpeechForwardMs",this.inputStopped,at);this.inputStopped=null;}
  if(type==="closing.playback"){
   if(payload.phase==="cancelled"){this.counters.cancelledClosingPlayback++;this.marks.clear();}
   if(payload.phase==="drained")this.playbackDrained=at;
  }
  if(type==="closing.playback"&&typeof payload.mark==="string"){
   if(payload.phase==="mark_sent")this.marks.set(payload.mark,at);
   if(payload.phase==="mark_acknowledged"){this.add("closingMarkRoundTripMs",this.marks.get(payload.mark),at);this.marks.delete(payload.mark);}
   if(payload.phase==="cancelled")this.marks.delete(payload.mark);
  }
  if(type==="response.event"){
   const event=payload.event as {type?:string;response?:{id?:string;usage?:{input_tokens?:number}};item?:{type?:string;call_id?:string}}|undefined,id=event?.response?.id;
   if(id&&event?.type==="response.created")this.requests.set(id,at);
   if(id&&["response.completed","response.failed","response.cancelled","response.incomplete"].includes(event?.type??"")){this.add("backendResponseMs",this.requests.get(id),at);this.requests.delete(id);}
   if(event?.type==="response.output_item.done"&&event.item?.type==="function_call"&&event.item.call_id&&!this.tools.has(event.item.call_id))this.tools.set(event.item.call_id,at);
   const tokens=event?.response?.usage?.input_tokens;
   if(typeof tokens==="number")this.context.maxBackendInputTokens=Math.max(this.context.maxBackendInputTokens??0,tokens);
  }
  if(type==="response.item.create"){
   const item=payload.item as {type?:string;call_id?:string}|undefined;
   if(item?.type==="function_call_output"&&item.call_id){this.add("toolReadyToOutputMs",this.tools.get(item.call_id),at);this.tools.delete(item.call_id);}
  }
 }
 result(){return {version:1,clock:"trace_elapsed_ms",sampleLimitPerMetric:256,omittedSamples:this.omittedSamples,missing:"unknown",audiblePlaybackMeasured:false,counters:this.counters,context:this.context,...this.samples};}
}
