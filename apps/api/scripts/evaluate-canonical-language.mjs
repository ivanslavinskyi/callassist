import '../src/config/load-env.ts';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {normalizeCreateCallBriefInput,createPlanOnlyTaskContext,defaultPreparationRuntimePolicy,HOLISTIC_PREPARATION_POLICY} from '@callassist/contracts';
import {OpenAIBriefCompiler} from '../src/brief-compiler/brief-compiler.ts';
import {prepareHolistic} from '../src/brief-compiler/holistic-preparation.ts';
import {HOLISTIC_GENERATION_INSTRUCTIONS,HOLISTIC_AUDIT_INSTRUCTIONS} from '../src/brief-compiler/holistic-contract.ts';
import {readProviderResponse} from '../src/brief-compiler/response-reader.ts';
import {responseJson} from '../src/brief-compiler/preparation-validation.ts';
import {preparationRequestReserve} from '../src/config/preparation-pricing.ts';
import {canonicalLanguageInput,canonicalGermanCandidate,foreignCanonicalProse} from '../src/test-helpers/canonical-language.ts';

if(!process.argv.includes('--live'))throw Error('Pass --live for synthetic model evaluation. No calls or deployment changes.');
const root=new URL(`../../../.tools/runtime/canonical-language-${new Date().toISOString().replace(/[:.]/g,'-')}/`,import.meta.url);
await mkdir(root,{recursive:true});
const policy={...defaultPreparationRuntimePolicy,promptVersion:HOLISTIC_PREPARATION_POLICY,generation:{model:'gpt-6-luna',serviceTier:'default'}};
const referenceTime=new Date('2026-11-11T12:00:00Z');
let reserved=0,cursor=0;
const reserve=amount=>{if(reserved+amount>12_000_000)throw Error('EVAL_RESERVATION_LIMIT');reserved+=amount;};
const hash=value=>createHash('sha256').update(value).digest('hex');
const tasks=[],results=[];
for(const locale of ['de-CH','de-DE','en-GB','en-US','fr-CH','it-CH','ru-RU'])for(let repetition=0;repetition<3;repetition++)tasks.push({kind:'generation',locale,repetition});
for(const mutation of [null,...foreignCanonicalProse,['all_nonspoken',null]])for(let repetition=0;repetition<3;repetition++)tasks.push({kind:'audit',mutation,repetition});
const change=(candidate,path,text)=>{const parts=path.split('.');let node=candidate;for(const key of parts.slice(0,-1))node=node[key];node[parts.at(-1)]=text;};
async function run(task,index){
 const key=`${index}-${task.kind}`,start=Date.now();let result={...task,key};
 try{
  if(task.kind==='generation'){
   const input=normalizeCreateCallBriefInput({...canonicalLanguageInput,locale:task.locale,
    ...(task.locale==='ru-RU'?{objective:'Ask whether my application AB-17 arrived. If not, ask how to send it again. Do not submit anything or accept new payments. Stop discussing the application if passport details are requested.',context:'The application was already sent. Reference AB-17. If needed: the envelope was blue and sent by ordinary mail.'}:{}),
    ...(task.repetition===2?{objective:`${task.locale==='ru-RU'?'Please call on my behalf.':'Позвони от моего имени.'} ${task.locale==='ru-RU'?'Ask whether my application AB-17 arrived. If not, ask how to resend it. Do not submit anything or accept payments. Stop if passport details are requested.':canonicalLanguageInput.objective}`}:{})});
   const events=[];
   const compilation=await new OpenAIBriefCompiler({apiKey:process.env.OPENAI_API_KEY,now:()=>referenceTime}).compile(input,1,{policy,
    beforeProviderRequest:async request=>{reserve(request.reserveUsdMicros??0);return true;},diagnostic:async e=>{events.push(e);}});
   const execution=compilation.compiledBrief?createPlanOnlyTaskContext(compilation.compiledBrief,compilation.rawBrief,input.voiceGender):null;
   result={...result,status:compilation.policyDecision.status,execution,events,
    // Fixture-only smoke oracle. Language acceptance is also manually reviewed; this is NOT an application detector.
    unexpectedCyrillic:task.locale!=='ru-RU'&&/\p{Script=Cyrillic}/u.test(JSON.stringify(execution))};
  }else{
   const candidate=structuredClone(canonicalGermanCandidate);
   if(task.mutation?.[0]==='all_nonspoken')for(const [path,text]of foreignCanonicalProse.slice(0,12))change(candidate,path,text);
   else if(task.mutation)change(candidate,...task.mutation);
   let auditBody;
   await prepareHolistic(canonicalLanguageInput,1,{policy,referenceTime,voiceGender:canonicalLanguageInput.voiceGender,
    moderate:async()=>({flagged:false,categories:[]}),diagnostic:async()=>{},request:async(body,stage)=>{
     if(stage==='language_audit'){auditBody=body;return {status:'completed',output_text:JSON.stringify({verdict:'accept',message:''})};}
     return {status:'completed',output_text:JSON.stringify(candidate)};
    }});
   const body=JSON.stringify({...auditBody,stream:true,service_tier:policy.audit.serviceTier});
   reserve(preparationRequestReserve(policy.audit,Buffer.byteLength(body),auditBody.max_output_tokens));
   const signal=AbortSignal.timeout(policy.requestTimeoutMs);
   const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body,signal});
   if(!response.ok)throw Error(`HTTP_${response.status}`);
   const verdict=responseJson(await readProviderResponse(response,signal),'language_audit');
   result={...result,expected:task.mutation?'revise':'accept',verdict,pass:verdict.verdict===(task.mutation?'revise':'accept'),auditInput:JSON.parse(auditBody.input)};
  }
 }catch(error){result={...result,error:{code:error.code,validationCode:error.validationCode,message:error.message}};}
 result.durationMs=Date.now()-start;results.push(result);await writeFile(new URL(key+'.json',root),JSON.stringify(result,null,2));
 console.log(JSON.stringify({key,locale:task.locale,mutation:task.mutation?.[0],status:result.status,unexpectedCyrillic:result.unexpectedCyrillic,pass:result.pass,error:result.error}));
}
await Promise.all(Array.from({length:2},async()=>{while(cursor<tasks.length){const index=cursor++;await run(tasks[index],index);}}));
const summary={generationInstructionsHash:hash(HOLISTIC_GENERATION_INSTRUCTIONS),auditInstructionsHash:hash(HOLISTIC_AUDIT_INSTRUCTIONS),policy,reservedUsdMicros:reserved,
 generations:results.filter(r=>r.kind==='generation').length,ready:results.filter(r=>r.status==='ready_for_review').length,
 unexpectedCyrillic:results.filter(r=>r.unexpectedCyrillic).length,audits:results.filter(r=>r.kind==='audit').length,auditFailures:results.filter(r=>r.kind==='audit'&&r.pass!==true).map(r=>r.key),errors:results.filter(r=>r.error).map(r=>r.key)};
await writeFile(new URL('summary.json',root),JSON.stringify(summary,null,2));console.log(JSON.stringify({root:root.pathname,...summary}));
if(summary.ready!==summary.generations||summary.unexpectedCyrillic||summary.auditFailures.length||summary.errors.length)process.exitCode=1;
