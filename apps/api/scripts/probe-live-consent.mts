/** Opt-in paid native Live consent probe. Synthetic PCMU only, in-memory call,
 * simulated Twilio playback and recording; no telephone call or customer audio.
 * Run from repository root with --audio=<path> --expected=affirmative|negative|unclear.
 */
﻿import '../src/config/load-env.ts';
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import WebSocket from 'ws';
import {InMemoryCallRepository} from '../src/storage/in-memory-call-repository.ts';
import {CallService} from '../src/call-service.ts';
import {DeterministicBriefCompiler} from '../src/brief-compiler/brief-compiler.ts';
import {originalPlanReview} from '../src/test-helpers/original-plan-review.ts';
import {OpenAILiveBridge} from '../src/voice/openai-live-bridge.ts';
const audioPath = process.argv.find(arg => arg.startsWith("--audio="))?.slice(8);
const expected = process.argv.find(arg => arg.startsWith("--expected="))?.slice(11) ?? "affirmative";
if (!audioPath || !["affirmative", "negative", "unclear"].includes(expected)) throw new Error("Use --audio=<synthetic PCMU file> --expected=affirmative|negative|unclear");
const thenPath = process.argv.find(arg => arg.startsWith("--then-audio="))?.slice(13);
const clips = await Promise.all([audioPath, ...(thenPath ? [thenPath] : [])].map(path => readFile(path)));
let clip = clips[0];
const decisions: string[] = [];
let decision: string | null = null;
const repository=new InMemoryCallRepository();
const service=new CallService(repository,undefined,undefined,undefined,new DeterministicBriefCompiler());
const brief=await service.create({recipientName:'Example',phoneNumber:'+41710000001',objective:'Ask what the recipient would like for lunch',assistantProfileId:'sebastian',representedPersonFirstName:'Test',representedPersonLastName:'Caller',assistanceReason:'speech_impairment',locale:'de-CH',audioRetentionDays:0,allowLanguageSwitch:false,allowedFacts:[]});
await service.approveCompilation(brief.id,await originalPlanReview(service,brief.id));
const {attempt}=await repository.startAttempt(brief.id,{provider:'twilio'});
await repository.attachProviderCall(attempt.id,'CA-SYNTHETIC','in-progress');
await repository.transitionAnswering(brief.id,{attemptId:attempt.id,providerCallId:'CA-SYNTHETIC',snapshotHash:attempt.compilationSnapshotHash,kind:'resolve',answeredBy:'human',now:new Date().toISOString()});
let granted=false,queueEnd=0,offset=clip.length,marks=0;
service.startRecordingAfterConsent=async()=>{granted=true; console.log('CONSENT_GRANTED'); return (await service.get(brief.id));};
service.prepareAgentHangup=async()=>true;
class Telephone extends EventEmitter {
 readyState=WebSocket.OPEN;
 send(raw){const e=JSON.parse(raw);
 if(e.event==='clear') queueEnd=Date.now();
 if(e.event==='media') queueEnd=Math.max(Date.now(),queueEnd)+Buffer.from(e.media.payload,'base64').length/8;
 if(e.event==='mark') setTimeout(()=>{this.emit('message',Buffer.from(JSON.stringify({event:'mark',mark:e.mark}))); console.log(JSON.stringify({mark:++marks})); if(marks<=clips.length) setTimeout(()=>{clip=clips[marks-1];offset=0;},400);},Math.max(0,queueEnd-Date.now()));
 }
 close(){if(this.readyState===WebSocket.CLOSED)return; this.readyState=WebSocket.CLOSED;this.emit('close');}
}
const phone=new Telephone();
const bridge=new OpenAILiveBridge({apiKey:process.env.OPENAI_API_KEY,service,agentHangupEnabled:true,validateStreamToken:()=>true,
 semanticFetch:async(url,init)=>{const body=JSON.parse(init.body); const response=await fetch(url,init);const result=await response.clone().json(); console.log(JSON.stringify({syntheticInput:JSON.parse(body.input[0].content),output:result.output?.filter(i=>i.type==="message"),status:result.status}));return response;},
 createLiveSocket:(url,key)=>{const socket=new WebSocket(url,{headers:{Authorization:'Bearer '+key}});socket.on('message',raw=>{const e=JSON.parse(raw.toString());if(e.type==='response.event' && ['response.output_item.done','response.completed'].includes(e.event?.type)) console.log(JSON.stringify({backend:e.event.type,items:(e.event.response?.output??[e.event.item]).filter(i=>i?.type==='function_call')}));if(e.type?.includes('transcript.delta'))console.log(JSON.stringify({type:e.type,delta:e.delta,start:e.start_ms,end:e.end_ms}));});return socket;},logger:{info:(metadata, message)=>{
 console.log(JSON.stringify({message, ...metadata}));
 if(message === "Live delegated consent decision") {decision=metadata.decision; decisions.push(decision!); if(decision===expected || decision==="negative" || !thenPath) setTimeout(()=>phone.close(),1000);}
},warn:console.warn,error:console.error}});
bridge.handleTwilioSocket(phone);
phone.emit('message',Buffer.from(JSON.stringify({event:'start',start:{callSid:'CA-SYNTHETIC',streamSid:'MZ-SYNTHETIC',customParameters:{callBriefId:brief.id,callAttemptId:attempt.id,compilationSnapshotHash:attempt.compilationSnapshotHash,streamToken:'synthetic'}}})));
const feed=setInterval(()=>{const packet=offset<clip.length?clip.subarray(offset,offset+=160):Buffer.alloc(160,255);phone.emit('message',Buffer.from(JSON.stringify({event:'media',media:{payload:packet.toString('base64')}})));},20);
await new Promise(resolve=>{const timer=setTimeout(()=>phone.close(),70000);phone.on('close',()=>{clearTimeout(timer);resolve();});});
clearInterval(feed);bridge.close();await new Promise(r=>setTimeout(r,2000));await service.close();console.log(JSON.stringify({expected,decision,decisions,granted,marks}));if(decision!==expected || granted!==(expected==="affirmative"))process.exitCode=1;
