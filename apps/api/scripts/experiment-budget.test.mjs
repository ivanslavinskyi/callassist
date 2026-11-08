import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {createExperimentBudget} from './experiment-budget.mjs';
const folders=[];
afterEach(()=>{for(const directory of folders.splice(0)){if(!directory.startsWith(join(tmpdir(),'native-budget-test-')))throw Error('UNEXPECTED_TEST_PATH');rmSync(directory,{recursive:true,force:true});}});
it('requires a distinct diagnostic key and explicit budget before dispatch',()=>{
 const env={NATIVE_PROBE_RUN:'test',OPENAI_DIAGNOSTIC_PROJECT_ID:'proj_fixture',OPENAI_DIAGNOSTIC_API_KEY:'fixture-diagnostic-secret',OPENAI_API_KEY:'application'};
 expect(()=>createExperimentBudget({},'unused')).toThrow('DIAGNOSTIC_PROJECT_AND_DISTINCT_KEY_REQUIRED');
 expect(()=>createExperimentBudget(env,'unused')).toThrow('EXPLICIT_DIAGNOSTIC_BUDGET_REQUIRED');
 expect(()=>createExperimentBudget({...env,OPENAI_DIAGNOSTIC_API_KEY:'application'},'unused')).toThrow('DIAGNOSTIC_PROJECT_AND_DISTINCT_KEY_REQUIRED');
 const directory=mkdtempSync(join(tmpdir(),'native-budget-test-'));folders.push(directory);
 const file=join(directory,'journal.jsonl'),budget=createExperimentBudget({...env,NATIVE_PROBE_MAX_USD:'6',NATIVE_PROBE_MAX_REQUESTS:'2'},file);
 budget.reserve('live_session');budget.reserve('backend');expect(()=>budget.reserve('speech')).toThrow('DIAGNOSTIC_BUDGET_EXHAUSTED');budget.finish();
 expect(()=>createExperimentBudget({...env,NATIVE_PROBE_MAX_USD:'6',NATIVE_PROBE_MAX_REQUESTS:'2'},file)).toThrow('DIAGNOSTIC_RUN_ALREADY_EXISTS');
 const journal=readFileSync(file,'utf8');expect(journal).not.toContain('application');expect(journal).not.toContain(env.OPENAI_DIAGNOSTIC_API_KEY);
 const rows=journal.trim().split('\n').map(JSON.parse);expect(rows.at(-1)).toMatchObject({kind:'finished',reservedUsd:6,requests:2,actualCost:'reconcile_diagnostic_project_billing'});
});
