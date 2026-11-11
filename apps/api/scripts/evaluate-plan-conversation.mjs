// Synthetic preparation + existing reasoning backend; no phone calls or database writes.
import '../src/config/load-env.ts';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {normalizeCreateCallBriefInput,createPlanOnlyTaskContext,createApprovedExecutionSnapshot} from '@callassist/contracts';
import {OpenAIBriefCompiler} from '../src/brief-compiler/brief-compiler.ts';
import {prepareHolistic} from '../src/brief-compiler/holistic-preparation.ts';
import {assembleHolisticCandidate,HOLISTIC_GENERATION_INSTRUCTIONS,HOLISTIC_AUDIT_INSTRUCTIONS} from '../src/brief-compiler/holistic-contract.ts';
import {readProviderResponse} from '../src/brief-compiler/response-reader.ts';
import {responseJson} from '../src/brief-compiler/preparation-validation.ts';
import {preparationRequestReserve} from '../src/config/preparation-pricing.ts';
import {holisticCandidate,holisticPolicy} from '../src/test-helpers/holistic-candidate.ts';
import {createCompilationSnapshotHash} from '../src/brief-compiler/compilation-integrity.ts';
import {InMemoryCallRepository} from '../src/storage/in-memory-call-repository.ts';
import {originalPlanReview} from '../src/test-helpers/original-plan-review.ts';
import {nativeV2Session} from '../src/voice/live-task-context.ts';
import {nativeResponsesConfiguration,NATIVE_CONFIGURATION_VERSION} from '../src/voice/live-native-configuration.ts';
import {validateNativeAppointment} from '../src/appointments/native-appointment-authorization.ts';

if(!process.argv.includes('--live'))throw Error('Use --live for bounded synthetic model evaluation.');
const output=new URL(`../../../.tools/runtime/plan-conversation-${new Date().toISOString().replace(/[:.]/g,'-')}/`,import.meta.url);
await mkdir(output,{recursive:true});
const time=new Date('2026-11-11T12:00:00Z');
const policy={...holisticPolicy,generation:{model:'gpt-6-luna',serviceTier:'default'}};
let reserved=0,requests=0;
function reserve(amount){if(++requests>90||reserved+amount>8_000_000)throw Error('EVALUATION_BUDGET_EXHAUSTED');reserved+=amount;}
async function response(body){
 const wire={...body,store:false,stream:true},encoded=JSON.stringify(wire);
 reserve(preparationRequestReserve({model:body.model,serviceTier:'default'},Buffer.byteLength(encoded),body.max_output_tokens));
 const signal=AbortSignal.timeout(90000);
 const res=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:encoded,signal});
 if(!res.ok)throw Error(`MODEL_HTTP_${res.status}`);
 return readProviderResponse(res,signal);
}
const input=(objective,locale='ru-RU')=>normalizeCreateCallBriefInput({recipientName:'Office',representedPersonFirstName:'Nina',representedPersonLastName:'Keller',phoneNumber:'+41710000001',assistantProfileId:'sebastian',assistanceReason:'none',locale,objective,allowedFacts:[]});
const raw=input('Узнай стоимость замены дисплея iPhone 17. Если не больше 100 франков, запиши меня на любой день следующей недели с 9 до 18.');
const candidate=await holisticCandidate(raw);
Object.assign(candidate,{taskType:'appointment_coordination',localizedObjective:'Узнать стоимость замены дисплея iPhone 17. Если она не превышает 100 CHF, записать Нину Келлер на любой день следующей недели с 09:00 до 18:00.',
 opening:{recipientAddress:'Здравствуйте.',purposeStatement:'Звоню узнать стоимость замены дисплея.',readinessQuestion:'Вам удобно говорить?'},backgroundSummary:'Нине Келлер нужна замена дисплея.',
 orderedQuestions:[{text:'Сколько стоит замена дисплея?',purpose:'Узнать стоимость.',required:true}],conditionalFollowUps:[{condition:'Стоимость не превышает 100 CHF.',question:'Запишите Нину Келлер на любое доступное время следующей недели с 09:00 до 18:00.'}],
 successCriteria:['Стоимость известна.','При стоимости не выше 100 CHF запись подтверждена.'],unresolvedCriteria:['Стоимость не установлена либо при цене не выше 100 CHF не удалось оформить запись.'],prohibitedActions:['Не записывать при стоимости выше 100 CHF.'],stopConditions:[],approvedFacts:[],blockingIssues:[],contextAppendix:[],
 appointmentProposal:{operation:'book',serviceDescription:'Замена дисплея iPhone 17',timeZone:null,existingAppointment:null,alternatives:[{selection:'first_matching',rules:[{dates:{kind:'next_calendar_week'},weekdays:[],excludedWeekdays:[],excludedDates:[],startTime:'09:00',endTime:'18:00'}],requirements:[]}],requirements:[],limits:{finishBy:null,maxTotalPrice:{amount:100,currency:'CHF'}}}});
async function session(){
 const compiledBrief=assembleHolisticCandidate(candidate,raw,time);
 const c={rawBrief:raw,compiledBrief,compilerVersion:'brief-compiler-17',compilerModel:'gpt-6-luna',compilerResponseId:null,revision:1,compiledAt:time.toISOString(),approvedAt:null,
  policyDecision:{policyVersion:'callassist-policy-3',status:'ready_for_review',riskLevel:'low',reasonCodes:[],clarificationQuestions:[]}};
 c.snapshotHash=createCompilationSnapshotHash(c);
 const repo=new InMemoryCallRepository(),brief=await repo.create(raw,c);await repo.approveCompilation(brief.id,await originalPlanReview(repo,brief.id));
 return nativeV2Session(createApprovedExecutionSnapshot(await repo.get(brief.id)));
}
const voice=await session(),backend=nativeResponsesConfiguration(voice);
const proposal={operation:'book',alternativeId:'alternative_1',date:'2026-11-17',startTime:'10:00',timeZone:'Europe/Zurich',serviceMatches:true,recipientMatches:true,requiresUnapprovedTerms:false,totalPrice:{amount:90,currency:'CHF'},durationMinutes:null,termsQuote:'90 CHF total.',requirements:[],unavailableAlternatives:[],selectionEvidence:null};
const action={actionId:'11111111-1111-4111-8111-111111111111',episode:1,revision:2,state:'delivered',delivery:'played',intent:'request',proposal};
const prepared=[{role:'user',content:'Observed recipient: 90 CHF total. 17 November at 10:00 is available.'},
 {type:'function_call',call_id:'synthetic_prepare',name:'prepare_appointment',arguments:JSON.stringify({proposal,intent:'request'})},
 {type:'function_call_output',call_id:'synthetic_prepare',output:JSON.stringify({ok:true,action:{id:action.actionId,...action,state:'authorized',delivery:{status:'not_observed',mark:null,assistantQuote:null,observedAt:null}},instruction:'This exact operation and its person, date, time and conditions are authorized, not completed. The provider\'s result must be recorded before success is reported.'})}];
const tasks=[];
for(const repair of [false,true])tasks.push({id:repair?'repair_invented_conditions':'prepare_without_extra_confirmation',kind:'backend',run:async()=>{
 const observed=[{role:'assistant',text:'Сколько стоит замена дисплея?'},{role:'recipient',text:'90 франков.'},
  {role:'assistant',text:'Когда можно прийти на следующей неделе?'},{role:'recipient',text:'Давайте во вторник в десять.'},
  {role:'assistant',text:'Это полная стоимость?'},{role:'recipient',text:'Да.'}];
 const transcript=observed.filter(o=>o.role==='recipient').map(o=>o.text).join(' ');
 const authority=assembleHolisticCandidate(candidate,raw,time).nativeAppointmentAuthorization;
 const history=[{role:'user',content:JSON.stringify({observedConversation:observed,applicationAppointmentState:null})}];
 if(repair){
  const args={proposal:{...proposal,termsQuote:'90 франков.',requirements:[{id:'full_price_includes_mandatory_costs',recipientQuote:'Да.'}]},intent:'request'};
  const rejected=validateNativeAppointment(authority,args.proposal,transcript,time);
  if(rejected.ok||rejected.reason!=='invalid_evidence_ids')throw Error('Expected precise contract rejection');
  history.push({type:'function_call',name:'prepare_appointment',call_id:'synthetic_contract_failure',arguments:JSON.stringify(args)},
   {type:'function_call_output',call_id:'synthetic_contract_failure',output:JSON.stringify(rejected)});
 }
 let result=await response({...backend,input:history}),calls=(result.output??[]).filter(x=>x.type==='function_call');
 let args;try{args=JSON.parse(calls[0]?.arguments);}catch{}
 let checked=args?.proposal?validateNativeAppointment(authority,args.proposal,transcript,time):null;
 const firstOutput=result.output?.filter(x=>x.type!=='reasoning'),firstPass=checked?.ok===true;
 if(calls.length===1&&calls[0].name==='prepare_appointment'&&checked?.ok===false&&!(result.output??[]).some(x=>x.content?.some(c=>c.text?.trim()))){
  history.push(...firstOutput,{type:'function_call_output',call_id:calls[0].call_id,output:JSON.stringify(checked)});
  result=await response({...backend,input:history});calls=(result.output??[]).filter(x=>x.type==='function_call');
  try{args=JSON.parse(calls[0]?.arguments);}catch{args=null;}
  checked=args?.proposal?validateNativeAppointment(authority,args.proposal,transcript,time):null;
 }
 return{pass:calls.length===1&&calls[0].name==='prepare_appointment'&&args?.intent==='request'&&args.proposal.requirements.length===0&&checked?.ok===true&&
  !(result.output??[]).some(x=>x.content?.some(c=>c.text?.trim())),firstPass,firstOutput,checked,output:result.output?.filter(x=>x.type!=='reasoning')};
}});
for(const [id,objective,locale,selection] of [
 ['any_ru',raw.objective,'ru-RU','first_matching'],
 ['any_en','Ask the iPhone 17 screen repair price. If at most CHF 100, book me any available day next week between 9 and 18.','en-GB','first_matching'],
 ['any_de','Frage nach dem Preis für den Displaytausch beim iPhone 17. Bis 100 Franken darfst du mich an einem beliebigen Tag nächste Woche von 9 bis 18 Uhr anmelden.','de-CH','first_matching'],
 ['any_fr',"Demande le prix du remplacement de l’écran de l’iPhone 17. Si le prix ne dépasse pas 100 CHF, prends un rendez-vous pour moi n’importe quel jour de la semaine prochaine entre 9h et 18h.",'fr-CH','first_matching'],
 ['any_it','Chiedi il prezzo della sostituzione dello schermo di iPhone 17. Fino a 100 CHF prenota per me un giorno qualsiasi della prossima settimana dalle 9 alle 18.','it-CH','first_matching'],
 ['earliest',raw.objective.replace('любой день','самое раннее доступное время'),'ru-RU','earliest_available'],
 ['corrected',raw.objective+' Сначала хотел самое раннее время, но теперь это не важно: подходит любое в этих пределах.','ru-RU','first_matching']
])tasks.push({id,kind:'generation',run:async()=>{
 const compilation=await new OpenAIBriefCompiler({apiKey:process.env.OPENAI_API_KEY,now:()=>time}).compile(input(objective,locale),1,{policy,beforeProviderRequest:async r=>{reserve(r.reserveUsdMicros??0);return true;}});
 const a=compilation.compiledBrief?.nativeAppointmentAuthorization;
 return {pass:compilation.policyDecision.status==='ready_for_review'&&a?.alternatives[0]?.selection===selection&&a?.limits.maxTotalPrice?.amount===100&&a.requirements.length===0&&a.alternatives.every(x=>x.requirements.length===0),expectedSelection:selection,compilation};
}});
for(const selection of ['first_matching','earliest_available'])for(let repeat=0;repeat<2;repeat++)tasks.push({id:`audit_${selection}_${repeat}`,kind:'audit',run:async()=>{
 const c=structuredClone(candidate);c.appointmentProposal.alternatives[0].selection=selection;
 if(selection==='earliest_available')c.conditionalFollowUps[0].question='Запишите Нину Келлер на самое раннее доступное время следующей недели с 09:00 до 18:00.';
 let body;await prepareHolistic(raw,1,{policy,referenceTime:time,voiceGender:raw.voiceGender,moderate:async()=>({flagged:false,categories:[]}),diagnostic:async()=>{},request:async(b,stage)=>{if(stage==='language_audit'){body=b;return{status:'completed',output_text:'{"verdict":"accept","message":""}'};}return{status:'completed',output_text:JSON.stringify(c)};}});
 const verdict=responseJson(await response(body),'language_audit');return{pass:verdict.verdict===(selection==='first_matching'?'accept':'revise'),verdict};
}});
const direct='Запишите, пожалуйста, Нину Келлер на замену дисплея во вторник, 17 ноября, в 10:00 за 90 CHF.';
for(const [id,question,reply,outcome] of [
 ['accept_ru',direct,'Да, я оформлю.','confirmed'],
 ['done_ru',direct,'Да, запись оформлена.','confirmed'],
 ['checking_ru',direct,'Я сначала проверю, получится ли оформить.','uncertain'],
 ['capability_ru','Подтвердите, что можете записать Нину Келлер на замену дисплея 17 ноября в 10:00 за 90 CHF.','Подтверждаю.','uncertain'],
 ['fragment_ru',direct,'Запись оформ','wait'],
 ['correction_ru',direct,'Да, записал. Хотя, возможно, я перепутал человека, сейчас не уверен.','uncertain'],
 ['decline_ru',direct,'Нет, это время уже занято, не могу вас записать.','declined'],
 ['status_ru','Нина Келлер уже записана на замену дисплея 17 ноября в 10:00 за 90 CHF?','Да.','confirmed'],
 ['accept_en','Please book Nina Keller for screen repair on 17 November at 10:00 for CHF 90.',"Yes, I'll book that for you.",'confirmed'],
 ['accept_de','Bitte tragen Sie Nina Keller für den Displaytausch am 17. November um 10 Uhr für 90 CHF ein.','Ja, mache ich.','confirmed'],
 ['conditional_en','Please book Nina Keller for screen repair on 17 November at 10:00 for CHF 90.',"I'll book it after she pays the deposit.",'not_confirmed']
])tasks.push({id,kind:'backend',run:async()=>{
 const state={...action,...(id==='status_ru'?{intent:'status_check'}:{})};
 const result=await response({...backend,input:[...prepared,{role:'developer',content:JSON.stringify({applicationAppointmentState:state})},{role:'user',content:JSON.stringify({transcript:[{role:'assistant',text:question},{role:'recipient',text:reply}]})}]});
 const calls=(result.output??[]).filter(x=>x.type==='function_call'),call=calls.find(x=>x.name==='record_appointment_result');let args;try{args=JSON.parse(call?.arguments);}catch{}
 const expected=outcome==='not_confirmed'?['declined','uncertain']:[outcome==='wait'?'uncertain':outcome];
 const recorded=calls.length===1&&expected.includes(args?.outcome)&&args?.actionId===action.actionId&&question.includes(args?.assistantQuote)&&reply.includes(args?.recipientQuote)&&reply.includes(args?.latestRecipientQuote);
 const waiting=outcome==='wait'&&!(result.output??[]).some(x=>x.type==='function_call'||x.content?.some(c=>c.text?.trim()));
 return{pass:recorded||waiting,expected:outcome,output:result.output?.filter(x=>x.type!=='reasoning')};
}});
for(const state of ['authorized','confirmed','uncertain'])tasks.push({id:`silent_${state}`,kind:'backend',run:async()=>{
 const name=state==='authorized'?'prepare_appointment':'record_appointment_result';
 const reply=state==='confirmed'?'Да, запись оформлена.':'Я сначала проверю, получится ли оформить.';
 const history=state==='authorized'?prepared.slice(0,1):[...prepared,{role:'user',content:JSON.stringify({transcript:[{role:'assistant',text:direct},{role:'recipient',text:reply}]})}];
 const args=state==='authorized'?{proposal,intent:'request'}:{actionId:action.actionId,episode:1,outcome:state,assistantQuote:direct,recipientQuote:reply,latestRecipientQuote:reply,detailsMatch:true,previousAppointmentReleased:false};
 const result=await response({...backend,input:[...history,{type:'function_call',call_id:'synthetic_action',name,arguments:JSON.stringify(args)},
  {type:'function_call_output',call_id:'synthetic_action',output:JSON.stringify({ok:true,action:{id:action.actionId,...action,state,delivery:{status:state==='authorized'?'not_observed':state==='uncertain'?'interrupted':'played',mark:null,assistantQuote:state==='authorized'?null:direct,observedAt:state==='authorized'?null:time.toISOString()}},instruction:'The current action state has been published to Live.'})},
  {role:'developer',content:JSON.stringify({applicationAppointmentState:{...action,state,delivery:state==='authorized'?'not_observed':state==='uncertain'?'interrupted':'played',proposal:{...proposal,termsQuote:null}}})}]});
 const calls=(result.output??[]).filter(x=>x.type==='function_call');
 const recovery=calls.length===1&&state==='uncertain'&&calls[0].name==='prepare_appointment'&&JSON.parse(calls[0].arguments).intent==='status_check'&&isDeepStrictEqual(JSON.parse(calls[0].arguments).proposal,proposal);
 return{pass:!(result.output??[]).some(x=>x.content?.some(c=>c.text?.trim()))&&(calls.length===0||recovery),output:result.output?.filter(x=>x.type!=='reasoning')};
}});
// Repeat decision cases to catch wording-sensitive regressions; generation also
// exercises five languages, preference preservation and an explicit correction.
tasks.push(...tasks.filter(t=>t.kind==='backend').map(t=>({...t,id:t.id+'_repeat'})));
if(process.argv.includes('--backend-only'))tasks.splice(0,tasks.length,...tasks.filter(t=>t.kind==='backend'));
const results=[];let cursor=0;
await Promise.all(Array.from({length:2},async()=>{while(cursor<tasks.length){const t=tasks[cursor++];let result;try{result=await t.run();}catch(e){result={pass:false,error:e.message};}
 results.push({id:t.id,kind:t.kind,...result});await writeFile(new URL(t.id+'.json',output),JSON.stringify(result,null,2));console.log(JSON.stringify({id:t.id,pass:result.pass,error:result.error}));}}));
const hash=x=>createHash('sha256').update(x).digest('hex');
const summary={version:NATIVE_CONFIGURATION_VERSION,generationHash:hash(HOLISTIC_GENERATION_INSTRUCTIONS),auditHash:hash(HOLISTIC_AUDIT_INSTRUCTIONS),voiceHash:hash(voice.instructions),backendHash:hash(backend.instructions),reservedUsdMicros:reserved,requests,total:results.length,passed:results.filter(r=>r.pass).length,failures:results.filter(r=>!r.pass).map(r=>r.id),callsPlaced:0};
await writeFile(new URL('summary.json',output),JSON.stringify(summary,null,2));console.log(JSON.stringify({output:output.pathname,...summary}));
if(summary.failures.length)process.exitCode=1;
