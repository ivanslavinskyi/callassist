// Replays an existing private capture entirely offline, in memory.
// Never sends its contents to a provider or changes a saved call/approval.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {NativeAppointmentCall,nativeAppointmentPrepareSchema} from '../src/voice/native-appointment-call.ts';
import {MemoryNativeLiveStore} from '../src/storage/native-live-store.ts';
import {nativeV2Session} from '../src/voice/live-task-context.ts';
import {validateNativeAppointment} from '../src/appointments/native-appointment-authorization.ts';

import {NATIVE_CONFIGURATION_VERSION} from '../src/voice/live-native-configuration.ts';
if(process.argv.includes('--live'))throw Error('PRIVATE_CAPTURE_OFFLINE_ONLY');
const capture=process.argv[process.argv.indexOf('--capture')+1];
if(!process.argv.includes('--capture')||!capture)throw Error('Use --capture PATH');
const source=JSON.parse(await readFile(capture,'utf8'));
const snapshot=source.attempt.executionSnapshot,authority=snapshot.plan.nativeAppointmentAuthorization;
assert.equal(snapshot.version,10);assert.ok(authority);
const session=nativeV2Session(snapshot);
const sent=source.trace.find(e=>e.event_type==='session.start'&&e.direction==='out').payload.session;
assert.deepEqual(session.input,sent.input,'Full approved startup task must remain unchanged');
const output=new URL(`../../../.tools/runtime/appointment-contract-${new Date().toISOString().replace(/[:.]/g,'-')}/`,import.meta.url);
await mkdir(output,{recursive:true});
const observations=[],cases=[];
for(const entry of source.trace) {
  if(['session.input_transcript.delta','session.output_transcript.delta'].includes(entry.event_type))observations.push({
    role:entry.event_type==='session.input_transcript.delta'?'recipient':'assistant',text:entry.payload.delta,
    start:entry.payload.start_ms,end:entry.payload.end_ms});
  const event=entry.payload?.event,item=event?.item;
  if(entry.event_type==='response.event'&&event?.type==='response.output_item.done'&&item?.type==='function_call'&&item.name==='prepare_appointment')
    cases.push({id:`repair-${cases.length+1}`,item,at:entry.observed_at,observations:structuredClone(observations)});
}
assert.equal(cases.length,5,'Expected the five captured refusals');
async function fixture(observed) {
  const store=new MemoryNativeLiveStore(),callId=randomUUID(),attemptId=randomUUID(),marks=[];
  await store.reserve(callId,attemptId);
  const call=new NativeAppointmentCall(authority,{store,callId,attemptId,snapshotHash:snapshot.compilationSnapshotHash,
    representedPerson:snapshot.runtime.spokenIdentities.representedPerson.spoken,locale:snapshot.plan.callLocale,
    mark:mark=>marks.push(mark),trace:()=>{}});
  await call.restore();for(const o of observed)call.transcript(o.role,o.text,o.start,o.end);
  return {call,marks};
}
const results=[];
for(const c of cases) {
  // Validate at the captured instant, so a historical replay does not expire.
  mock.timers.enable({apis:['Date'],now:new Date(c.at)});
  const {call}=await fixture(c.observations);
  try {
    const args=JSON.parse(c.item.arguments);
    assert.equal(nativeAppointmentPrepareSchema(authority).safeParse(args).success,false);
    const rejected=await call.tool('prepare_appointment',args,()=>true);
    assert.equal(rejected.reason,'invalid_evidence_ids');assert.equal(rejected.validation.category,'arguments');
    assert.deepEqual(rejected.validation.expectedIds,[]);assert.equal(call.action,null);
    const corrected={...args,proposal:{...args.proposal,requirements:[]}};
    const accepted=await call.tool('prepare_appointment',corrected,()=>true);assert.equal(accepted.ok,true);
    results.push({id:c.id,pass:true,schemaRejectsInventedIds:true,rejected,acceptedWithoutNewRecipientWords:true});
  } finally {call.close();await call.settled();mock.timers.reset();}
}
const first=cases[0],base=JSON.parse(first.item.arguments).proposal;
base.requirements=[];
const recipient=first.observations.filter(o=>o.role==='recipient').map(o=>o.text).join('');
const controls=[
  ['price',{...base,totalPrice:{amount:110,currency:'CHF'},termsQuote:'110 франков'},recipient+' 110 франков'],
  ['day',{...base,date:'2026-11-24'},recipient],['time',{...base,startTime:'19:00'},recipient],
  ['terms',{...base,requiresUnapprovedTerms:true},recipient],['quote',{...base,termsQuote:'Полная стоимость точно 90 франков'},recipient],
  ['operation',{...base,operation:'cancel'},recipient]
].map(([id,p,text])=>({id,result:validateNativeAppointment(authority,p,text,new Date(first.at))}));
controls.push({id:'required_condition',result:validateNativeAppointment({...authority,requirements:[{id:'requirement_1',description:'Original part'}]},base,recipient,new Date(first.at))});
for(const c of controls)assert.equal(c.result.ok,false);
const summary={version:NATIVE_CONFIGURATION_VERSION,sourceAttempt:source.attempt.id,fullStartupContextUnchanged:true,
  toolsHash:createHash('sha256').update(JSON.stringify(session.tools)).digest('hex'),backendHash:createHash('sha256').update(session.backendInstructions).digest('hex'),
  tests:results.length,passed:results.filter(r=>r.pass).length,failures:results.filter(r=>!r.pass).map(r=>r.id),
  controls:controls.map(c=>({id:c.id,reason:c.result.reason})),requests:0,reservedUsdMicros:0,
  audioModelExercised:false,callsPlaced:0,savedCallsChanged:false};
await writeFile(new URL('offline.json',output),JSON.stringify(results,null,2));
await writeFile(new URL('summary.json',output),JSON.stringify(summary,null,2));console.log(JSON.stringify({output:output.pathname,...summary}));
