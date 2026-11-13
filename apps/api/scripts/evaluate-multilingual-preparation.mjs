import '../src/config/load-env.ts';
import {mkdir,writeFile,appendFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {defaultPreparationRuntimePolicy,MATERIAL_PREPARATION_POLICY,RELIABLE_PREPARATION_POLICY,normalizeCreateCallBriefInput,nativeAppointmentRuleContains} from '@callassist/contracts';
import {OpenAIBriefCompiler} from '../src/brief-compiler/brief-compiler.ts';
import {holisticPreparationContract} from '../src/brief-compiler/material-preparation-contract.ts';
import {validateNativeAppointment} from '../src/appointments/native-appointment-authorization.ts';
import {nativeProposal} from '../src/test-helpers/native-appointment.ts';
import {reliabilityInput,reliabilityReferenceTime} from '../src/test-helpers/preparation-reliability.ts';
import {PreparationEvaluationBudget,usageEstimate,reconciledEvaluationBound} from './preparation-evaluation-budget.mjs';
import {multilingualCorpus,multilingualTasks} from './preparation-multilingual-corpus.mjs';

// A distinct, explicitly authorized USD 4 evaluation; no app DB or telephony.
const limitUsdMicros=4_000_000;
const recheck=process.argv.includes('--recheck');
const candidate=process.argv.includes('--candidate');
const followup=process.argv.includes('--followup');
const clarificationRecheck=process.argv.includes('--clarification-recheck');
if([candidate,recheck,followup,clarificationRecheck].filter(Boolean).length>1)throw Error('SELECT_ONE_EVALUATION_PHASE');
const mainRoot=new URL('../../../.tools/runtime/preparation-multilingual-2026-11-13/',import.meta.url);
let priorBoundUsdMicros=0;
const priorRoots=followup||clarificationRecheck?[mainRoot,new URL('../preparation-multilingual-rechecks-2026-11-13/',mainRoot),new URL('../preparation-multilingual-v2-2026-11-13/',mainRoot),...(clarificationRecheck?[new URL('../preparation-multilingual-v2-followup-2026-11-13/',mainRoot)]:[])]:candidate?[mainRoot,new URL('../preparation-multilingual-rechecks-2026-11-13/',mainRoot)]:recheck?[mainRoot]:[];
for(const previousRoot of priorRoots){
 const previous=JSON.parse(await readFile(new URL('summary.json',previousRoot),'utf8'));
 if(previous.completed!==previous.runs||previous.budgetStopped||previous.limitUsdMicros!==limitUsdMicros||(previous.priorBoundUsdMicros??0)!==priorBoundUsdMicros)throw Error('INCOMPLETE_PRIOR_EVALUATION');
 const jsonl=async name=>(await readFile(new URL(name,previousRoot),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
 const reservations=await jsonl('budget.jsonl'),operations=await jsonl('operations.jsonl');
 for(const key of new Set(reservations.map(r=>r.key)))priorBoundUsdMicros+=reconciledEvaluationBound(reservations.filter(r=>r.key===key),operations.filter(r=>r.key===key));
 if(priorBoundUsdMicros!==previous.settledBoundUsdMicros)throw Error('PRIOR_BUDGET_MISMATCH');
}
const recheckIds=['meeting-fr-it','price-fr-en','missing-cancel-en-ru','mixed-en-ru-de','third-party-info-pl-it'];
const recheckTasks=[1,2].flatMap(repetition=>recheckIds.map(id=>({...multilingualCorpus.find(c=>c.id===id),repetition})));
const evaluationTasks=clarificationRecheck?[0,1,2].map(repetition=>({...multilingualCorpus.find(c=>c.id==='third-party-info-pl-it'),repetition})):candidate||followup?[...multilingualTasks,...recheckTasks]:recheck?recheckTasks:multilingualTasks;
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const policy={...defaultPreparationRuntimePolicy,promptVersion:candidate||followup||clarificationRecheck?RELIABLE_PREPARATION_POLICY:MATERIAL_PREPARATION_POLICY,
 generation:{model:'gpt-6-luna',serviceTier:'fast'},audit:{model:'gpt-5.6',serviceTier:'default'}};
const contract=holisticPreparationContract(policy.promptVersion);
const metadata={limitUsdMicros,priorBoundUsdMicros,phase:clarificationRecheck?'general_enquiry_recheck':followup?'delegation_followup':candidate?'candidate_replay':recheck?'targeted_rechecks':'primary',policy,referenceTime:reliabilityReferenceTime,corpusHash:hash(evaluationTasks),
 generationHash:hash(contract.generation),auditHash:hash(contract.audit),cases:new Set(evaluationTasks.map(c=>c.id)).size,runs:evaluationTasks.length,
 callLocales:[...new Set(evaluationTasks.map(c=>c.locale))],inputLanguages:[...new Set(evaluationTasks.map(c=>c.inputLanguage))],
 localePromptHashes:Object.fromEntries([...new Set(evaluationTasks.map(c=>c.locale))].map(locale=>{
  const c=holisticPreparationContract(policy.promptVersion,locale);return [locale,{generation:hash(c.generation),audit:hash(c.audit)}];
 }))};
// Validate all input shapes before any spending, including dry-run.
for(const task of evaluationTasks)normalizeCreateCallBriefInput({...reliabilityInput,...task,allowedFacts:[]});
if(!process.argv.includes('--live')){console.log(JSON.stringify({...metadata,providerRequests:0}));process.exit(0);}
const root=clarificationRecheck?new URL('../preparation-multilingual-v2-clarification-2026-11-13/',mainRoot):followup?new URL('../preparation-multilingual-v2-followup-2026-11-13/',mainRoot):candidate?new URL('../preparation-multilingual-v2-2026-11-13/',mainRoot):recheck?new URL('../preparation-multilingual-rechecks-2026-11-13/',mainRoot):mainRoot;
await mkdir(root,{recursive:true});
// Refuse accidental second invocation of the same USD 4 allocation.
await writeFile(new URL('run.json',root),JSON.stringify(metadata,null,2),{flag:'wx'});
await writeFile(new URL('corpus.json',root),JSON.stringify(evaluationTasks,null,2));
let settledBound=priorBoundUsdMicros,providerRequests=0,estimatedUsageUsdMicros=0,budgetStopped=false;
const results=[];
const writeSummary=async()=>{
 const summary={...metadata,settledBoundUsdMicros:settledBound,providerRequests,estimatedUsageUsdMicros,budgetStopped,
  completed:results.length,results:results.map(({compilation,events,operations,...r})=>r)};
 await writeFile(new URL('summary.json',root),JSON.stringify(summary,null,2));return summary;
};

function checkGenerated(task,compilation,events){
 const checks={expectedStatus:task.expectedStatuses.includes(compilation?.policyDecision.status)};
 const plan=compilation?.compiledBrief,a=plan?.nativeAppointmentAuthorization,expected=task.checks;
 if(task.expectedStatuses[0]!=='ready_for_review')return checks;
 checks.hasPlan=!!plan;
 if(!plan)return checks;
 checks.operation=(a?.operation??null)===expected.operation;
 const allows=(date,time)=>!!a?.alternatives.some(b=>b.rules.some(r=>nativeAppointmentRuleContains(r,date,time)));
 for(const [date,time] of expected.allowed??[])checks[`allows ${date} ${time}`]=allows(date,time);
 for(const [date,time] of expected.denied??[])checks[`denies ${date} ${time}`]=!allows(date,time);
 if(expected.existing)checks.existing=Object.entries(expected.existing).every(([k,v])=>a?.existingAppointment?.[k]===v);
 if(['cancel','confirm_existing'].includes(expected.operation))checks.noNewSlots=a?.alternatives.length===0;
 if(expected.unrankedInitial)checks.equivalentSlotsGrouped=!!a?.alternatives.some(b=>[['2026-11-24','14:00'],['2026-11-25','10:00']].every(([d,t])=>b.rules.some(r=>nativeAppointmentRuleContains(r,d,t))));
 if(expected.earliest)checks.earliestSelection=!!a?.alternatives.length&&a.alternatives.every(b=>b.selection==='earliest_available');
 if(expected.price)checks.priceLimit=a?.limits.maxTotalPrice?.amount===expected.price&&a?.limits.maxTotalPrice?.currency==='CHF';
 const sourceLanguage=[...events].reverse().find(e=>e.metadata?.code==='CANDIDATE_VALID')?.detail?.candidate?.sourceLanguage;
 if(sourceLanguage)checks.sourceLanguage=(task.sourceLanguages??[task.inputLanguage]).includes(sourceLanguage.split('-')[0]);
 if(expected.fallback&&a){
  const [date,time]=expected.allowed.at(-1),fallback=a.alternatives.find(b=>b.rules.some(r=>nativeAppointmentRuleContains(r,date,time)));
  const index=a.alternatives.indexOf(fallback);
  checks.conditionalFallback=index>0&&fallback.requirements.length>0;
  checks.noUnrequestedCommonRequirements=a.requirements.length===0;
  const quote='Neither initial option works. I propose this other time.';
  if(fallback){
   const proposal={...nativeProposal,alternativeId:fallback.id,date,startTime:time,timeZone:a.timeZone,
    requirements:[...a.requirements,...fallback.requirements].map(r=>({id:r.id,recipientQuote:quote})),
    unavailableAlternatives:a.alternatives.slice(0,index).map(b=>({id:b.id,recipientQuote:quote}))};
   checks.fallbackValidator=validateNativeAppointment(a,proposal,quote,reliabilityReferenceTime).ok;
   checks.fallbackRequiresEarlierEvidence=!validateNativeAppointment(a,{...proposal,unavailableAlternatives:[]},quote,reliabilityReferenceTime).ok;
   checks.fallbackRequiresProposalEvidence=!validateNativeAppointment(a,{...proposal,requirements:[]},quote,reliabilityReferenceTime).ok;
  }
  const [d,t]=expected.allowed[0],initial=a.alternatives.find(b=>b.rules.some(r=>nativeAppointmentRuleContains(r,d,t)));
  checks.initialValidator=!!initial&&validateNativeAppointment(a,{...nativeProposal,alternativeId:initial.id,date:d,startTime:t,timeZone:a.timeZone},'',reliabilityReferenceTime).ok;
 }
 return checks;
}

for(const task of evaluationTasks){
 if(limitUsdMicros-settledBound<1){budgetStopped=true;break;}
 const key=`${task.id}-${task.repetition}`,budget=new PreparationEvaluationBudget(limitUsdMicros-settledBound),operations=[],events=[];
 const meteredFetch=async(url,init)=>{
  if(!['https://api.openai.com/v1/responses','https://api.openai.com/v1/moderations'].includes(String(url)))throw Error('UNEXPECTED_EVAL_ENDPOINT');
  let reservation;
  try{reservation=budget.reserve(JSON.parse(String(init.body)));}catch(e){if(e.message==='EVAL_BUDGET_LIMIT')budgetStopped=true;throw e;}
  await appendFile(new URL('budget.jsonl',root),JSON.stringify({key,...reservation})+'\n');
  await writeFile(new URL('budget-state.json',root),JSON.stringify({limitUsdMicros,settledBoundUsdMicros:settledBound,inFlightReservedUsdMicros:budget.reservedUsdMicros,totalMaximumUsdMicros:settledBound+budget.reservedUsdMicros}));
  providerRequests++;
  return fetch(url,init);
 };
 const raw=normalizeCreateCallBriefInput({...reliabilityInput,...task,allowedFacts:[]}),started=Date.now();let compilation,error;
 try{
  compilation=await new OpenAIBriefCompiler({apiKey:process.env.OPENAI_API_KEY,fetchImplementation:meteredFetch,now:()=>reliabilityReferenceTime}).compile(raw,1,{
   policy,diagnostic:async event=>{events.push(event);},afterProviderRequest:async result=>{
    const profile=result.stage==='language_audit'?policy.audit:policy.generation;
    const operation={...result,pricedModel:profile.model,estimatedUsdMicros:usageEstimate(result.usage,profile.model,result.actualServiceTier??profile.serviceTier)};
    operations.push(operation);await appendFile(new URL('operations.jsonl',root),JSON.stringify({key,...operation})+'\n');
   }
  });
 }catch(e){error={code:e.code??e.message,validationCode:e.validationCode,stage:e.stage};}
 // Release only the difference proven by fully matching completed usage. Any
 // timeout, unmatched response, unknown usage/model or non-200 retains its reserve.
 const caseBound=reconciledEvaluationBound(budget.requests,operations);
 settledBound+=caseBound;estimatedUsageUsdMicros+=operations.reduce((s,o)=>s+(o.estimatedUsdMicros??0),0);
 const checks=checkGenerated(task,compilation,events),failedChecks=Object.entries(checks).filter(([,ok])=>!ok).map(([k])=>k);
 const result={key,inputLanguage:task.inputLanguage,locale:task.locale,expectedStatuses:task.expectedStatuses,status:compilation?.policyDecision.status??'error',
  checks,failedChecks,durationMs:Date.now()-started,caseBoundUsdMicros:caseBound,reservedUsdMicros:budget.reservedUsdMicros,
  auditRevisions:events.filter(e=>e.metadata?.code==='AUDIT_REVISE').map(e=>e.detail?.verdict?.message),
  recoveryUsed:events.some(e=>e.metadata?.recoveryUsed),error,compilation,events,operations};
 results.push(result);await writeFile(new URL(`${key}.json`,root),JSON.stringify(result,null,2));await writeSummary();
 console.log(JSON.stringify({key,status:result.status,failedChecks,recoveryUsed:result.recoveryUsed,durationMs:result.durationMs,settledBoundUsdMicros:settledBound}));
 if(budgetStopped)break;
}
const summary=await writeSummary();
console.log(JSON.stringify({complete:true,root:root.pathname,completed:summary.completed,runs:metadata.runs,providerRequests,settledBoundUsdMicros:settledBound,estimatedUsageUsdMicros,budgetStopped,
 failures:results.filter(r=>r.failedChecks.length||r.error).map(r=>r.key)}));
