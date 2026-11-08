// Real GPT-Live + Responses + production NativeLiveV2Call. Fictional in-memory
// approval and emulated Twilio playback only: never creates a telephone call.
import '../src/config/load-env.ts';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import WebSocket from 'ws';
import {fileURLToPath} from 'node:url';
import {createExperimentBudget} from './experiment-budget.mjs';
import { normalizeCreateCallBriefInput, defaultPreparationRuntimePolicy, callCompilationSchema } from '../../../packages/contracts/src/index.ts';
import { DeterministicBriefCompiler } from '../src/brief-compiler/brief-compiler.ts';
import { createCompilationSnapshotHash } from '../src/brief-compiler/compilation-integrity.ts';
import { originalPlanReview } from '../src/test-helpers/original-plan-review.ts';
import { InMemoryCallRepository } from '../src/storage/in-memory-call-repository.ts';
import { CallService } from '../src/call-service.ts';
import { NativeLiveV2Call } from '../src/voice/native-live-v2-call.ts';
import { renderSpeech } from '../src/voice/rendered-speech.ts';
import { pcmuHasSpeech } from '../src/voice/pcmu-activity.ts';
import { hasNativeFarewellCue } from '../src/voice/live-native-completion.ts';
const cacheFolder=new URL('../../../.tools/native-profiles-provider-results/',import.meta.url);
const budget=createExperimentBudget(process.env,fileURLToPath(new URL('experiment-ledger.jsonl',cacheFolder)));
process.env.OPENAI_API_KEY=budget.key;
process.once('exit',()=>budget.finish());
const runTag=process.env.NATIVE_PROBE_RUN??'';if(runTag&&!/^[a-z0-9-]+$/.test(runTag))throw Error('INVALID_RUN_TAG');
const folder=runTag?new URL(runTag+'/',cacheFolder):cacheFolder;await mkdir(folder,{recursive:true});
const sourceFiles=[];
async function walkSource(relative){for(const item of await readdir(new URL('../../../'+relative+'/',import.meta.url),{withFileTypes:true})){
 const path=relative+'/'+item.name;if(item.isDirectory())await walkSource(path);else if(/\.(ts|sql)$/.test(path)&&!path.endsWith('.test.ts'))sourceFiles.push(path);
}}
await walkSource('apps/api/src');await walkSource('packages/contracts/src');const sourceHashes={};
for(const path of sourceFiles.sort())sourceHashes[path]=createHash('sha256').update(await readFile(new URL('../../../'+path,import.meta.url))).digest('hex');
const sourceDigest=createHash('sha256').update(JSON.stringify(sourceHashes)).digest('hex');process.env.SHPROHLI_RUNTIME_SOURCE_DIGEST=sourceDigest;
if(!process.env.OPENAI_API_KEY)throw Error('OPENAI_KEY_UNAVAILABLE');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const silence=Buffer.alloc(160,255).toString('base64');
const cases={
 refusal:{objective:"Ask whether Nina Keller's application arrived.",offer:"I do not agree to recording. Stop this call and delete the recording.",refusal:true},
 complex:{operation:'book',objective:'Book one consultation for Nina Keller, preferably on 19 November 2026 between 14:00 and 16:00, otherwise on 20 November between 14:00 and 16:00. Require wheelchair access and Dr Meyer. The consultation must finish by 16:00. Service price must not exceed CHF 100; do not make a payment or agree to a deposit.',offer:'There are no available slots on the nineteenth. On the twentieth of November twenty twenty-six at three p.m. we have an available slot with Doctor Meyer. Wheelchair access is provided. It lasts thirty minutes and ends at three thirty. The service price is eighty Swiss francs, with no deposit or other fees.',result:'I have booked Nina Keller with Doctor Meyer on the twentieth of November twenty twenty-six at three p.m., ending at three thirty. Wheelchair access is provided. The service price is eighty Swiss francs and no deposit is required.'},
 general:{objective:"Ask whether Nina Keller's application arrived. Do not request further details.",offer:"Yes, Nina Keller's application arrived. Everything is complete."},
 book:{objective:'Book one routine consultation for Nina Keller on 20 November 2026, starting between 14:00 and 16:00. Do not agree to charges.',offer:'We have a routine consultation on the twentieth of November, twenty twenty-six, at three p.m. There is no charge. This slot is available and has not been booked yet.',result:'Yes, I have booked Nina Keller for the twentieth of November, twenty twenty-six, at three p.m. There is no charge.'},
 confirm_existing:{objective:'Confirm attendance for Nina Keller at the existing routine consultation on 19 November 2026 at 10:00. Do not change the appointment or agree to charges.',offer:'I see Nina Keller has an appointment on the nineteenth of November, twenty twenty-six, at ten a.m. Are you confirming attendance?',result:'Yes, Nina Keller is confirmed as attending that existing appointment on the nineteenth of November at ten a.m.'},
 reschedule:{objective:'Reschedule Nina Keller from the existing routine consultation on 19 November 2026 at 10:00 to one appointment on 20 November 2026, starting between 14:00 and 16:00. Replace the old appointment only when the new one is confirmed. Do not agree to charges.',offer:'We can move the appointment to the twentieth of November, twenty twenty-six, at three p.m. There is no charge.',result:'I have moved Nina Keller to the twentieth of November, twenty twenty-six, at three p.m. The old appointment on the nineteenth at ten a.m. has been released and replaced. There is no charge.'},
 cancel:{objective:'Cancel the existing routine consultation for Nina Keller on 19 November 2026 at 10:00. Do not book another appointment or agree to charges.',offer:'I see the existing appointment for Nina Keller on the nineteenth of November, twenty twenty-six, at ten a.m. Shall I cancel that appointment?',result:'Yes, I have cancelled the appointment for Nina Keller on the nineteenth of November, twenty twenty-six, at ten a.m. There is no cancellation fee.'}
};
const lunch={information:true,lunch:true,locale:'de-CH',profile:'sebastian',objective:'Fragen Sie den Empfänger im Auftrag von Nina Keller, was er zum Mittagessen möchte. Falls er Pizza möchte, fragen Sie nach der Sorte. Keine Bestellung aufgeben.',offer:'Pizza.',followUp:'Margherita.'};
cases.lunch_de={...lunch,reciprocal:false};cases.lunch_de_bye={...lunch,reciprocal:true};
// Conditional enquiries deliberately retain an old compound opening. This
// checks that the runtime also handles already approved plans progressively.
const conditionalRepair={operation:'book',progressive:true,locale:'ru-RU',profile:'sebastian',reciprocal:false,
 objective:'Узнать стоимость замены дисплея смартфона. Только если цена не превышает 100 швейцарских франков, записать Nina Keller на 20 ноября 2026 года с 14:00 до 16:00. Не соглашаться на оплату или дополнительные сборы.',
 offer:'Девяносто швейцарских франков, без доплат.',
 slot:'Двадцатого ноября в пятнадцать часов.',
 result:'Да, Nina Keller записана на это время за девяносто франков.'};
cases.price_then_book={...conditionalRepair};
cases.price_above_limit={...conditionalRepair,expectNoAction:true,slot:null,result:null,offer:'Замена дисплея стоит сто пятьдесят швейцарских франков. Это окончательная цена.'};
async function actor(text,locale='en-GB'){
 const file=new URL(createHash('sha256').update(locale==='en-GB'?text:locale+'\n'+text).digest('hex')+'.json',cacheFolder);
 try{return JSON.parse(await readFile(file,'utf8'));}catch{}
 budget.reserve('speech');
 const rendered=await renderSpeech({apiKey:process.env.OPENAI_API_KEY,text,locale,voice:'alloy',timeoutMs:30000,
  speechFetch:(url,options)=>fetch(url,{...options,headers:{...options.headers,'OpenAI-Project':budget.project}})});
 budget.observed('speech',{id:rendered.providerRequestId,model:rendered.model,durationSeconds:rendered.durationMs/1000,finalized:true});
 await writeFile(file,JSON.stringify(rendered.frames));return rendered.frames;
}
class Phone extends EventEmitter {
 readyState=WebSocket.OPEN; playedAt=Date.now(); voicedAt=0; audio=[]; events=[];
 send(raw){const e=JSON.parse(raw);this.events.push(e.event==='media'?{event:'media'}:e);
  if(e.event==='media'){const bytes=Buffer.from(e.media.payload,'base64');this.audio.push(bytes);this.playedAt=Math.max(Date.now(),this.playedAt)+bytes.length/8;if(pcmuHasSpeech(bytes))this.voicedAt=this.playedAt;}
  if(e.event==='mark')setTimeout(()=>{if(this.readyState===WebSocket.OPEN)this.emit('message',Buffer.from(JSON.stringify(e)));},Math.max(0,this.playedAt-Date.now())+15);
  if(e.event==='clear')this.playedAt=Date.now();
 }
 close(){if(this.readyState!==WebSocket.OPEN)return;this.readyState=WebSocket.CLOSED;this.emit('close');}
 terminate(){this.close();}
 receive(e){if(this.readyState===WebSocket.OPEN)this.emit('message',Buffer.from(JSON.stringify(e)));}
}
const requested=process.argv.slice(2).filter(v=>v in cases);const selected=requested.length?requested:['general','book'];
const results=[];
for(const name of selected){
 const scenario=cases[name], started=Date.now(), transcript=[],events=[];let controller,service,feed,backendSocket,repository,attempt;
 let input=[],discarded=false,hungup=false,lastOutput=0,outputSinceActor='',stage=0,feeding=false,reciprocal=false,descriptor,clarifications=0,firstFarewellAt=0,firstTaskText=null;
 try{
  console.log(JSON.stringify({scenario:name,phase:'actor_audio'}));
  const locale=scenario.locale??'en-GB';
  const actorText=[scenario.refusal?scenario.offer:scenario.lunch?'Ja.':locale==='ru-RU'?'Да.':'Yes, now is convenient.',scenario.offer,...(scenario.slot?[scenario.slot]:[]),...(scenario.result?[scenario.result]:scenario.followUp?[scenario.followUp]:[]),scenario.lunch?'Danke, auf Wiederhören.':locale==='ru-RU'?'Спасибо, до свидания.':'Thank you, goodbye.'];
  const clips=await Promise.all(actorText.map(text=>actor(text,locale)));
  console.log(JSON.stringify({scenario:name,phase:'fixture'}));
  const raw=normalizeCreateCallBriefInput({recipientName:'TEST OFFICE',phoneNumber:'+41710000001',objective:scenario.objective,
   context:'Synthetic software test with fictional persons and office. The represented person is Nina Keller. Europe/Zurich time zone.',allowedFacts:['Represented person: Nina Keller.'],representedPersonFirstName:'Nina',representedPersonLastName:'Keller',assistantProfileId:scenario.profile??'anna',assistanceReason:'none',locale,audioRetentionDays:0,allowLanguageSwitch:false});
  const compilation=await new DeterministicBriefCompiler().compile(raw,1,{policy:{...defaultPreparationRuntimePolicy,promptVersion:'preparation-live-native-actions-2026-11-06'}});
  const operation=scenario.operation??name;
  const authority=scenario.information||['general','refusal'].includes(name)?null:{version:1,operation,serviceDescription:'Routine consultation',providerScope:'called_recipient',timeZone:'Europe/Zurich',
   existingAppointment:operation==='book'?null:{date:'2026-11-19',startTime:'10:00',reference:null},
   alternatives:['book','reschedule'].includes(operation)?[{id:'preferred',selection:'first_matching',requirements:[],rules:[{startDate:'2026-11-20',endDate:'2026-11-20',weekdays:[],excludedWeekdays:[],excludedDates:[],startTime:'14:00',endTime:'16:00'}]}]:[],
   requirements:[],limits:{finishBy:null,maxTotalPrice:null},maxAppointments:1,financialPolicy:'no_unapproved_terms'};
  if(name==='complex'){
   authority.requirements=[{id:'access',description:'Wheelchair access is provided',sourceText:'Require wheelchair access'},{id:'doctor',description:'Appointment with Dr Meyer',sourceText:'Dr Meyer'}];
   authority.alternatives=[{...structuredClone(authority.alternatives[0]),id:'first',rules:[{...authority.alternatives[0].rules[0],startDate:'2026-11-19',endDate:'2026-11-19'}]},{...authority.alternatives[0],id:'fallback'}];
   authority.limits={finishBy:{time:'16:00',dayOffset:0,inclusive:true},maxTotalPrice:{amount:100,currency:'CHF'}};
  }
  if(scenario.progressive){
   authority.serviceDescription='Замена дисплея смартфона';
   authority.limits.maxTotalPrice={amount:100,currency:'CHF'};
  }
  compilation.compiledBrief.nativeAppointmentAuthorization=authority;compilation.compiledBrief.blockingIssues=[];
  compilation.compiledBrief.taskType=authority?'appointment_coordination':'information_request';
  compilation.compiledBrief.opening.purposeStatement={general:'Nina Keller would like to know whether her application arrived.',book:'Nina Keller would like to arrange a routine consultation.',confirm_existing:'Nina Keller would like to confirm attendance at the existing consultation.',reschedule:'Nina Keller would like to move her existing consultation.',cancel:'Nina Keller would like to cancel her existing consultation.'}[authority?operation:'general'];
  compilation.compiledBrief.successCriteria=[authority?'The provider explicitly confirms the requested operation for Nina Keller.':'The provider confirms whether the application arrived.'];
  if(scenario.lunch){
   Object.assign(compilation.compiledBrief,{localizedObjective:scenario.objective,orderedQuestions:[{text:'Was möchten Sie zum Mittagessen?',purpose:'Den Essenswunsch erfahren.',required:true}],conditionalFollowUps:[{condition:'Der Empfänger möchte Pizza.',question:'Welche Sorte möchten Sie?'}],successCriteria:['Der Essenswunsch ist bekannt.','Bei Pizza ist auch die Sorte bekannt.'],unresolvedCriteria:['Der Essenswunsch oder die Sorte ist noch offen.'],prohibitedActions:['Keine Bestellung aufgeben und keine Essenswahl erfinden.']});
   compilation.compiledBrief.opening.purposeStatement='Nina Keller möchte wissen, was Sie zum Mittagessen möchten.';
  }
  if(scenario.progressive){
   compilation.compiledBrief.opening.purposeStatement=scenario.objective;
   compilation.compiledBrief.successCriteria=['Стоимость замены дисплея известна.','При цене не выше 100 CHF запись подтверждена в разрешённое время; при превышении лимита запись не оформлена.'];
   compilation.compiledBrief.prohibitedActions=['Не записывать при цене выше 100 CHF или неизвестной цене. Не соглашаться на оплату или дополнительные сборы.'];
  }
  compilation.policyDecision={...compilation.policyDecision,status:'ready_for_review',reasonCodes:[],clarificationQuestions:[]};
  compilation.snapshotHash=createCompilationSnapshotHash(compilation);callCompilationSchema.parse(compilation);
  repository=new InMemoryCallRepository();const brief=await repository.create(raw,compilation);await repository.approveCompilation(brief.id,await originalPlanReview(repository,brief.id));
  ({attempt}=await repository.startAttempt(brief.id,{provider:'twilio'}));await repository.attachProviderCall(attempt.id,'CA-SYNTHETIC','in-progress');
  await repository.nativeLive.reserve(brief.id,attempt.id);await repository.nativeLive.bind(attempt.id,'CA-SYNTHETIC');
  service=new CallService(repository);service.prepareAgentHangup=async()=>{hungup=true;return true;};
  const recordDescriptor=service.recordRuntimeDescriptor.bind(service);service.recordRuntimeDescriptor=async(...args)=>{descriptor=args[2];return recordDescriptor(...args);};
  service.discardNativeConversation=async(_call,id,reason)=>{discarded=true;await repository.nativeLive.discard(id,reason);};
  const phone=new Phone();
  controller=new NativeLiveV2Call({service,apiKey:process.env.OPENAI_API_KEY,nativeV2:true,agentHangupEnabled:true,validateStreamToken:()=>true,
   createLiveSocket:(url,key)=>{budget.reserve('live_session');const socket=new WebSocket(url,{headers:{Authorization:`Bearer ${key}`,'OpenAI-Project':budget.project}});backendSocket=socket;
    const originalSend=socket.send.bind(socket);socket.send=function(data,...args){const event=JSON.parse(String(data));if(event.type==='response.create')budget.reserve('backend');return originalSend(data,...args);};
    socket.on('message',raw=>{const e=JSON.parse(raw.toString());if(e.type?.includes('transcript.delta')){const role=e.type.includes('input_')?'recipient':'assistant';transcript.push({role,text:e.delta,start:e.start_ms,end:e.end_ms});if(role==='assistant'){lastOutput=Date.now();outputSinceActor+=e.delta;if(stage>=2&&!firstFarewellAt&&hasNativeFarewellCue(outputSinceActor))firstFarewellAt=Date.now();}}
     if(e.type==='error')events.push({type:e.type,error:e.error});
     if(e.type==='session.closed')budget.observed('live_session',{durationSeconds:e.usage?.seconds,finalized:true});
     if(e.type==='response.event'&&e.event?.response?.usage)budget.observed('backend',{id:e.event.response.id,model:e.event.response.model,inputTokens:e.event.response.usage.input_tokens,outputTokens:e.event.response.usage.output_tokens,finalized:e.event.type==='response.completed'});
     if(e.type==='response.event'&&['response.output_item.done','response.completed','response.incomplete','response.failed'].includes(e.event?.type))events.push({type:e.event.type,delegation:e.delegation_id,item:e.event.item,response:e.event.response});
    });return socket;}});
  console.log(JSON.stringify({scenario:name,phase:'preflight'}));await controller.preflight(brief.id,attempt.id);
  if(name==='general'){
   await sleep(3000);
   if(transcript.some(e=>e.role==='assistant'&&e.text.trim()))throw Error('SPOKE_BEFORE_MEDIA_READY');
  }
  console.log(JSON.stringify({scenario:name,phase:'admitted'}));
  await repository.transitionAnswering(brief.id,{attemptId:attempt.id,providerCallId:'CA-SYNTHETIC',snapshotHash:attempt.compilationSnapshotHash,kind:'resolve',answeredBy:'human',now:new Date().toISOString()});
  controller.attach(phone);phone.receive({event:'start',start:{callSid:'CA-SYNTHETIC',streamSid:'MZ-SYNTHETIC',customParameters:{callBriefId:brief.id,callAttemptId:attempt.id,compilationSnapshotHash:attempt.compilationSnapshotHash,streamToken:'synthetic'}}});
  feed=setInterval(()=>{const frame=input.shift();phone.receive({event:'media',media:{payload:frame??silence}});if(!input.length)feeding=false;},20);
  const queue=index=>{input.push(...clips[index]);feeding=true;outputSinceActor='';console.log(JSON.stringify({scenario:name,actorStage:index,elapsedMs:Date.now()-started}));};
  const deadline=Date.now()+(name==='complex'?200000:authority?140000:75000);let logged=Date.now();
  while(!controller.closed&&Date.now()<deadline){
   await sleep(100);const quiet=lastOutput&&Date.now()-lastOutput>1000&&Date.now()>phone.voicedAt+100;
   if(Date.now()-logged>10000){logged=Date.now();console.log(JSON.stringify({scenario:name,phase:'conversation',stage,transcriptFragments:transcript.length,outputFrames:phone.audio.length}));await writeFile(new URL(name+'-live.json',folder),JSON.stringify({transcript,events,trace:repository.nativeLive.traces.get(attempt.id)??[]},null,2));}
   const action=await repository.nativeLive.readAction(attempt.id);
   // A mid-introduction pause is not the availability question. The actor must
   // hear the complete question before saying yes, or the test can deadlock.
   if(!feeding&&quiet&&stage===0&&/\?\s*$/.test(outputSinceActor)){queue(0);stage=1;}
   else if(scenario.progressive&&!feeding&&quiet&&stage===1&&/стоим|стоит|цен[ауые]/i.test(outputSinceActor)){
    firstTaskText=outputSinceActor;queue(1);stage=2;
   }
   // The task permits any time in the window: the assistant can either ask
   // availability or propose a permitted time. Confirm either delivered request.
   else if(scenario.progressive&&!scenario.expectNoAction&&!feeding&&quiet&&stage>=2&&stage<=3&&action?.state==='delivered'){queue(3);stage=4;}
   else if(scenario.progressive&&!scenario.expectNoAction&&!action&&!feeding&&quiet&&stage>=2&&stage<=3&&clarifications<2&&/\?/.test(outputSinceActor)&&/цен|стоим|франк|сбор|доплат/i.test(outputSinceActor)&&!/свобод|когда|доступн|какое время/i.test(outputSinceActor)){queue(1);clarifications++;}
   else if(scenario.progressive&&!scenario.expectNoAction&&!action&&!feeding&&quiet&&stage===2&&/\?/.test(outputSinceActor)){queue(2);stage=3;}
   else if(!scenario.progressive&&!scenario.refusal&&!feeding&&quiet&&stage===1&&/would like|calling to|arrange|confirm|cancel|move|application|help|consultation|Mittagessen|essen möchten/i.test(outputSinceActor)){queue(1);stage=2;}
   else if(scenario.followUp&&!feeding&&quiet&&stage===2&&/Sorte|welche/i.test(outputSinceActor)){queue(2);stage=3;}
   else if(!scenario.progressive&&!feeding&&stage===2&&scenario.result&&action?.state==='delivered'&&quiet){queue(2);stage=3;}
   else if(!scenario.progressive&&!feeding&&quiet&&stage===2&&scenario.result&&!action&&clarifications<2&&/\?/.test(outputSinceActor)){queue(1);clarifications++;}
   // Reciprocal goodbye exercises resumption of a retained closing episode.
   if(scenario.reciprocal!==false&&!feeding&&!reciprocal&&stage>=2&&hasNativeFarewellCue(outputSinceActor)&&Date.now()>phone.voicedAt){queue(clips.length-1);reciprocal=true;}
  }
  const action=await repository.nativeLive.readAction(attempt.id);
  const progressivePass=!scenario.progressive||!!firstTaskText&&/стоим|стоит|цен[ауые]/i.test(firstTaskText)&&!/запис|запиc|при[её]м|если|100|ста франк|ста швейцар|ноября|14|16/i.test(firstTaskText);
  const result={scenario:name,sourceDigest,discarded,elapsedMs:Date.now()-started,hungup,closed:controller.closed,actionState:action?.state??null,actorStages:stage,reciprocal,
   ...(scenario.progressive?{firstTaskText,progressivePass,clarifications}:{}),
   afterFarewellCaptionMs:firstFarewellAt?Date.now()-firstFarewellAt:null,afterVoicedPlaybackMs:hungup?Date.now()-phone.voicedAt:null,
   accepted:scenario.refusal?discarded&&controller.closed:hungup&&(scenario.expectNoAction?!action:!authority||action?.state==='confirmed')&&(!scenario.lunch||stage===3)&&progressivePass,configuration:descriptor?.nativeConfiguration??null,stats:{delegations:new Set(events.map(e=>e.delegation).filter(Boolean)).size,incomplete:events.filter(e=>e.type==='response.incomplete').length,toolCalls:events.filter(e=>e.item?.type==='function_call').length}};
  results.push(result);
  await writeFile(new URL(name+'-trace.json',folder),JSON.stringify({result,transcript,events,trace:repository.nativeLive.traces.get(attempt.id)??[]},null,2));
  const sound=Buffer.concat(phone.audio),header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+sound.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(7,20);header.writeUInt16LE(1,22);header.writeUInt32LE(8000,24);header.writeUInt32LE(8000,28);header.writeUInt16LE(1,32);header.writeUInt16LE(8,34);header.write('data',36);header.writeUInt32LE(sound.length,40);await writeFile(new URL(name+'-assistant.wav',folder),Buffer.concat([header,sound]));
 }catch(error){results.push({scenario:name,accepted:false,code:error.code??error.message,causeCode:error.cause?.cause?.code??error.cause?.code,cause:error.cause?.message});}
 finally{
  clearInterval(feed);controller?.dispose();
  // The runtime can drain protocol events for 15 seconds after media closes.
  // Keep the provider socket alive until its final completeness manifest exists.
  const drainDeadline=Date.now()+16000;
  while(repository&&attempt&&!discarded&&Date.now()<drainDeadline&&!repository.nativeLive.traces.get(attempt.id)?.some(row=>row.eventType==='trace.manifest'))await sleep(50);
  if(repository&&attempt){
   const trace=repository.nativeLive.traces.get(attempt.id)??[];
   const result=results.at(-1);if(result)result.traceManifest=trace.find(row=>row.eventType==='trace.manifest')?.payload??null;
   await writeFile(new URL(name+'-trace.json',folder),JSON.stringify({result,transcript,events,trace},null,2));
  }
  backendSocket?.terminate();await service?.close();await writeFile(new URL(name+'-events.json',folder),JSON.stringify({transcript,events},null,2));
 }
 console.log(JSON.stringify(results.at(-1)));await writeFile(new URL('summary-'+selected.join('-')+'.json',folder),JSON.stringify({at:new Date().toISOString(),synthetic:true,noPhoneCalls:true,results},null,2));
}
if(results.some(r=>!r.accepted))process.exitCode=1;
