import {appendFileSync, mkdirSync,openSync,closeSync} from 'node:fs';
import {dirname,join} from 'node:path';

// Diagnostic project usage is deliberately separate from customer operations.
// Reservations are conservative local admission limits, not a provider invoice.
export function createExperimentBudget(env, journalPath) {
 const id=env.NATIVE_PROBE_RUN, project=env.OPENAI_DIAGNOSTIC_PROJECT_ID, key=env.OPENAI_DIAGNOSTIC_API_KEY;
 const limit=Number(env.NATIVE_PROBE_MAX_USD), requestLimit=Number(env.NATIVE_PROBE_MAX_REQUESTS);
 if(!id || !/^[a-z0-9-]{1,80}$/.test(id) || !project || !/^proj_[a-zA-Z0-9_-]{1,100}$/.test(project) || project===env.OPENAI_PROJECT_ID || !key || key===env.OPENAI_API_KEY)
  throw Error('DIAGNOSTIC_PROJECT_AND_DISTINCT_KEY_REQUIRED');
 if(!Number.isFinite(limit)||limit<=0||limit>100||!Number.isInteger(requestLimit)||requestLimit<1||requestLimit>100)
  throw Error('EXPLICIT_DIAGNOSTIC_BUDGET_REQUIRED');
 mkdirSync(dirname(journalPath),{recursive:true});
 try{closeSync(openSync(join(dirname(journalPath),`${id}.run`),'wx'));}catch(error){if(error.code==='EEXIST')throw Error('DIAGNOSTIC_RUN_ALREADY_EXISTS');throw error;}
 let reserved=0, requests=0;
 const record=data=>appendFileSync(journalPath,JSON.stringify({version:1,experimentId:id,project,at:new Date().toISOString(),...data})+'\n');
 record({kind:'started',limitUsd:limit,requestLimit,classification:'diagnostic',costBasis:'reservation_not_invoice'});
 return {key,project, reserve(kind) {
   const amount={speech:1,backend:5,live_session:1}[kind];
   if(!amount||requests+1>requestLimit||reserved+amount>limit){record({kind:'budget_rejected',requestKind:kind,reservedUsd:reserved,requests});throw Error('DIAGNOSTIC_BUDGET_EXHAUSTED');}
   reserved+=amount;requests++;record({kind:'reserved',requestKind:kind,reservedUsd:reserved,requests});
  }, observed(requestKind,values){
   const safe={};for(const name of ['inputTokens','outputTokens','durationSeconds'])if(typeof values[name]==='number'&&Number.isFinite(values[name])&&values[name]>=0)safe[name]=values[name];
   for(const name of ['id','model'])if(typeof values[name]==='string'&&/^[a-zA-Z0-9_.:-]{1,160}$/.test(values[name]))safe[name]=values[name];
   if(typeof values.finalized==='boolean')safe.finalized=values.finalized;
   record({kind:'observed',requestKind,...safe});
  }, finish(){record({kind:'finished',reservedUsd:reserved,requests,actualCost:'reconcile_diagnostic_project_billing'});} };
}
