import '../src/config/load-env.ts';
import {readFile,writeFile,appendFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {RELIABLE_PREPARATION_POLICY,normalizeCreateCallBriefInput,createPlanOnlyTaskContext} from '@callassist/contracts';
import {holisticPreparationContract} from '../src/brief-compiler/material-preparation-contract.ts';
import {assembleHolisticCandidate,holisticVerdictJsonSchema,holisticVerdictSchema} from '../src/brief-compiler/holistic-contract.ts';
import {parseOpenAITextTokenUsage} from '../src/brief-compiler/brief-compiler.ts';
import {responseJson} from '../src/brief-compiler/preparation-validation.ts';
import {meetingCandidate,reliabilityInput,reliabilityReferenceTime} from '../src/test-helpers/preparation-reliability.ts';
import {multilingualCorpus} from './preparation-multilingual-corpus.mjs';
import {PreparationEvaluationBudget,reconciledEvaluationBound,usageEstimate} from './preparation-evaluation-budget.mjs';

// Synthetic preparation audits only. Carry every phase of the SAME USD 4 grant.
const limitUsdMicros=4_000_000,base=new URL('../../../.tools/runtime/',import.meta.url);
const verifyContract=process.argv.includes('--verify-contract');
let priorBoundUsdMicros=0;
for(const folder of ['preparation-multilingual-2026-11-13','preparation-multilingual-rechecks-2026-11-13','preparation-multilingual-v2-2026-11-13','preparation-multilingual-v2-followup-2026-11-13','preparation-multilingual-v2-clarification-2026-11-13',...(verifyContract?['preparation-reliable-controls-2026-11-13']:[])]){
 const root=new URL(folder+'/',base),s=JSON.parse(await readFile(new URL('summary.json',root),'utf8'));
 const knownBudgetStop=folder==='preparation-reliable-controls-2026-11-13'&&s.budgetStopped&&s.results.at(-1)?.error==='EVAL_BUDGET_LIMIT';
 if(s.limitUsdMicros!==limitUsdMicros||(!knownBudgetStop&&(s.completed!==s.runs||s.budgetStopped))||(s.priorBoundUsdMicros??0)!==priorBoundUsdMicros)throw Error('INCOMPLETE_PRIOR_EVALUATION');
 const lines=async name=>(await readFile(new URL(name,root),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
 const reservations=await lines('budget.jsonl'),operations=await lines('operations.jsonl');
 for(const key of new Set(reservations.map(r=>r.key)))priorBoundUsdMicros+=reconciledEvaluationBound(reservations.filter(r=>r.key===key),operations.filter(o=>o.key===key));
 if(priorBoundUsdMicros!==s.settledBoundUsdMicros)throw Error('PRIOR_BUDGET_MISMATCH');
}
const cases=[];
for(const [kind,expected] of [['valid','accept'],['faithful-name-localization','accept'],['conditional-required','accept'],['natural-recipient-check','accept'],['unnecessary-year-clarification','revise'],['missing-fallback','revise'],['wrong-time','revise'],['wrong-party','revise'],['foreign-objective','revise'],['extra-principal-approval','revise'],['missing-existing-clarification','accept']]){
 let raw=reliabilityInput,candidate=await meetingCandidate(kind==='missing-fallback'?'missing':'structured');
 if(kind==='faithful-name-localization')candidate.opening.recipientAddress='Елена, здравствуйте.';
 if(kind==='conditional-required'){
  const followup=candidate.conditionalFollowUps.pop();
  candidate.orderedQuestions.push({text:`${followup.condition} ${followup.question}`,purpose:followup.condition,required:true});
 }
 if(kind==='wrong-time')candidate.appointmentProposal.alternatives[0].rules[0].startTime=candidate.appointmentProposal.alternatives[0].rules[0].endTime='16:00';
 if(kind==='natural-recipient-check')candidate.orderedQuestions.unshift({text:'Правильно ли я понимаю, что говорю с Elena Example, участницей хакатона?',purpose:'Обычное уточнение адресата в разговоре.',required:false});
 if(kind==='unnecessary-year-clarification')candidate.blockingIssues=[{code:'missing_required_reference',question:'Which year do you mean for November 24 and 25?'}];
 if(kind==='wrong-party')candidate.appointmentProposal.serviceDescription='Встреча ИИ-ассистента с участником хакатона. Nina Example не участвует.';
 if(kind==='foreign-objective')candidate.localizedObjective=raw.objective;
 if(kind==='extra-principal-approval')candidate.appointmentProposal.alternatives[1].requirements.push({description:'До согласования альтернативы отдельно связаться с Nina Example и получить её новое одобрение; выданного поручения недостаточно.'});
 if(kind==='missing-existing-clarification'){
  raw=normalizeCreateCallBriefInput({...reliabilityInput,objective:multilingualCorpus.find(c=>c.id==='missing-cancel-en-ru').objective});
  candidate={...candidate,localizedObjective:'Отменить существующую запись Nina Example после уточнения даты и времени у пользователя.',
   opening:{recipientAddress:'Здравствуйте.',purposeStatement:'Звоню от имени Nina Example по поводу отмены записи.',readinessQuestion:'Удобно поговорить?'},
   backgroundSummary:'Дата и время отменяемой записи пока не указаны.',orderedQuestions:[{text:'Можно отменить указанную запись?',purpose:'Отмена после уточнения записи у пользователя.',required:true}],
   conditionalFollowUps:[],successCriteria:['Указанная пользователем запись отменена.'],unresolvedCriteria:[],stopConditions:[],approvedFacts:[],prohibitedActions:[],appointmentProposal:null,
   blockingIssues:[{code:'missing_required_reference',question:'What are the exact date and time of the appointment to cancel?'}]};
 }
 cases.push({kind,expected,raw,candidate});
}
const observed=JSON.parse(await readFile(new URL('preparation-multilingual-v2-2026-11-13/meeting-ru-en-0.json',base),'utf8'));
cases.push({kind:'observed-principal-approval',expected:'revise',raw:normalizeCreateCallBriefInput({...reliabilityInput,...multilingualCorpus.find(c=>c.id==='meeting-ru-en'),allowedFacts:[]}),candidate:observed.events.findLast(e=>e.metadata.code==='CANDIDATE_VALID').detail.candidate});
const info=JSON.parse(await readFile(new URL('preparation-multilingual-v2-followup-2026-11-13/third-party-info-pl-it-2.json',base),'utf8'));
cases.push({kind:'observed-unnecessary-info-clarification',expected:'revise',raw:normalizeCreateCallBriefInput({...reliabilityInput,...multilingualCorpus.find(c=>c.id==='third-party-info-pl-it'),allowedFacts:[]}),candidate:info.events.findLast(e=>e.metadata.code==='CANDIDATE_VALID').detail.candidate});
// Use the captured real price candidate, preserving its redundant cap on purpose.
const priceRaw=normalizeCreateCallBriefInput({...reliabilityInput,...multilingualCorpus.find(c=>c.id==='price-fr-en'),allowedFacts:[]});
const priceRun=JSON.parse(await readFile(new URL('preparation-multilingual-v2-2026-11-13/price-fr-en-0.json',base),'utf8'));
const priceCandidate=priceRun.events.findLast(e=>e.metadata.code==='CANDIDATE_VALID').detail.candidate;
for(const [kind,expected] of [['duplicate-price-cap','accept'],['missing-typed-price-cap','revise']]){
 const candidate=structuredClone(priceCandidate);
 if(kind==='missing-typed-price-cap')candidate.appointmentProposal.limits.maxTotalPrice=null;
 cases.push({kind,expected,raw:priceRaw,candidate});
}
const model='gpt-5.6',tier='default',hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const selectedCases=verifyContract?cases.filter(c=>['valid','wrong-time'].includes(c.kind)):cases;
// Short diagnostic verdicts only; production auditing retains its 2048-token cap.
const maxOutputTokens=verifyContract?512:2048;
const metadata={limitUsdMicros,priorBoundUsdMicros,runs:selectedCases.length,maxOutputTokens,policy:RELIABLE_PREPARATION_POLICY,model,tier,corpusHash:hash(selectedCases),
 promptHashes:Object.fromEntries([...new Set(cases.map(c=>c.raw.locale))].map(locale=>[locale,hash(holisticPreparationContract(RELIABLE_PREPARATION_POLICY,locale).audit)]))};
if(!process.argv.includes('--live')){console.log(JSON.stringify({...metadata,providerRequests:0}));process.exit(0);}
const root=new URL(verifyContract?'preparation-reliable-contract-recheck-2026-11-13/':'preparation-reliable-controls-2026-11-13/',base);await mkdir(root,{recursive:true});
await writeFile(new URL('run.json',root),JSON.stringify(metadata,null,2),{flag:'wx'});
let settledBoundUsdMicros=priorBoundUsdMicros,estimatedUsageUsdMicros=0,budgetStopped=false;const results=[];
for(const {kind:key,expected,raw,candidate} of selectedCases){
 const contract=holisticPreparationContract(RELIABLE_PREPARATION_POLICY,raw.locale);
 const execution=createPlanOnlyTaskContext(assembleHolisticCandidate(candidate,raw,reliabilityReferenceTime),raw,'female');
 const trusted={callLocale:raw.locale,recipientName:raw.recipientName,representedPerson:raw.representedPerson,addressingMode:raw.addressingMode,tonePreference:raw.tonePreference,resultHandling:raw.resultHandling,voicemailPolicy:raw.voicemailPolicy,assistanceReason:raw.assistanceReason,voiceGender:'female',allowLanguageSwitch:raw.allowLanguageSwitch,fallbackLocale:null,referenceTime:reliabilityReferenceTime.toISOString(),defaultTimeZone:'Europe/Zurich'};
 const body={model,service_tier:tier,store:false,max_output_tokens:maxOutputTokens,reasoning:{effort:'low'},instructions:contract.audit,
  input:JSON.stringify({trusted,sources:{objective:raw.objective,context:raw.context,allowedFacts:raw.allowedFacts,clarificationAnswers:raw.clarificationAnswers,deliveryInstruction:raw.deliveryInstruction},execution,proposedBlockingQuestions:candidate.blockingIssues,taskPolicy:{taskType:candidate.taskType,riskCategories:candidate.riskCategories}}),
  text:{verbosity:'low',format:{type:'json_schema',name:'callassist_holistic_review',strict:true,schema:holisticVerdictJsonSchema}}};
 const budget=new PreparationEvaluationBudget(limitUsdMicros-settledBoundUsdMicros),operations=[];let verdict,error;
 try{
  const reservation=budget.reserve(body);await appendFile(new URL('budget.jsonl',root),JSON.stringify({key,...reservation})+'\n');
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(35000)});
  if(!response.ok)throw Error(`HTTP_${response.status}`);
  const payload=await response.json(),usage=parseOpenAITextTokenUsage(payload.usage),actualServiceTier=payload.service_tier??tier;
  const operation={stage:'control_audit',statusCode:200,pricedModel:model,actualServiceTier,usage,estimatedUsdMicros:usageEstimate(usage,model,actualServiceTier)};
  operations.push(operation);await appendFile(new URL('operations.jsonl',root),JSON.stringify({key,...operation})+'\n');
  verdict=holisticVerdictSchema.parse(responseJson(payload,'language_audit'));
 }catch(e){error=e.code??e.message;if(error==='EVAL_BUDGET_LIMIT')budgetStopped=true;}
 settledBoundUsdMicros+=reconciledEvaluationBound(budget.requests,operations);
 estimatedUsageUsdMicros+=operations.reduce((s,o)=>s+(o.estimatedUsdMicros??0),0);
 const result={key,expected,verdict,error,pass:verdict?.verdict===expected};results.push(result);
 await writeFile(new URL(key+'.json',root),JSON.stringify({...result,raw,candidate,execution},null,2));
 await writeFile(new URL('summary.json',root),JSON.stringify({...metadata,settledBoundUsdMicros,estimatedUsageUsdMicros,budgetStopped,completed:results.length,results},null,2));
 console.log(JSON.stringify({...result,settledBoundUsdMicros}));if(budgetStopped)break;
}
