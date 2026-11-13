import {randomUUID} from "node:crypto";
import {describe,it,expect} from "vitest";
import type {CallSummaryPayload,NativeAppointmentOperation,SummarySourceContext,CallTextArtifact} from "@callassist/contracts";
import {summarySourceContextSchema} from "@callassist/contracts";
import {nativeAuthority,nativeAction} from "../test-helpers/native-appointment";
import {composeCalendarSummary,assertSummaryArtifactOutput} from "./summary-calendar";
import {providerTextInput,validateTextProcessingOutput} from "./text-validation";
import {nativeSummaryInstructions} from "./native-summary";
import type {TextProcessingInput} from "./text-processor";
import {textPayloadHash} from "../storage/call-text-repository";

const version="summary-v9:grounded-v3:text-processing-v2:openai:test";
function fixture(operation:NativeAppointmentOperation="book") {
 const authority=structuredClone(nativeAuthority);authority.operation=operation;
 if(operation!=="book")authority.existingAppointment={date:operation==="reschedule"?"2099-09-10":"2099-09-16",startTime:"15:00",reference:null};
 if(operation==="cancel"||operation==="confirm_existing")authority.alternatives=[];
 const context=summarySourceContextSchema.parse({version:2,callAttemptId:randomUUID(),compilationId:randomUUID(),compilationSnapshotHash:"a".repeat(64),
  transcriptRevisionId:randomUUID(),transcriptSourceHash:"b".repeat(64),callCreatedAt:"2026-11-13T11:00:00.000Z",callConnectedAt:null,callEndedAt:null,approvedAt:null,
  representedPerson:"Alex Example",appointmentAuthorization:null,actionEvidence:null,nativeAppointmentAuthorization:authority,nativeAppointmentAction:null}) as Extract<SummarySourceContext,{version:2}>;
 const payload:CallSummaryPayload={schemaVersion:3,overview:[],findings:[{id:"criterion.0",label:"Result",text:"Confirmed.",certainty:"reported",sourceSegmentIds:["ask","yes"]}],nextSteps:[],unresolved:[],unresolvedDetails:[],
  appointmentExtraction:{candidates:[{id:"slot",date:"2099-09-16",startTime:"15:00",timeZone:"Europe/Zurich",zoneSource:"approved_plan",status:"reported_confirmed",supersedes:[],sourceSegmentIds:["ask","yes"]}],conditions:[],
   nativeOutcome:{operation,disposition:"confirmed",candidateId:"slot",previousAppointmentReleased:operation==="reschedule"?true:null,sourceSegmentIds:["ask","yes"]}},
  assessment:{conversation:{status:"confirmed",category:"task_answer",questionSegmentId:"ask",answerSegmentId:"yes",answerQuote:"Yes"},goal:{status:"achieved",sourceSegmentIds:["yes"]},criteria:[{id:"criterion.0",status:"achieved",sourceSegmentIds:["yes"]}]}};
 const input:Extract<TextProcessingInput,{kind:"call_summary"}>={kind:"call_summary",assessmentBasis:"conversation",nativeFormat:"native-summary-v3",sourceContext:context,targetLanguage:"en",assessmentMode:"evaluate",
  context:{objective:"Arrange the requested appointment",taskType:"appointment_coordination",representedPerson:"Alex Example",recipient:"Office"},checks:[{id:"criterion.0",text:"Complete the requested operation"}],
  segments:[{id:"ask",role:"assistant",text:"Please confirm the requested appointment.",startSeconds:0,endSeconds:1},{id:"yes",role:"recipient",text:"Yes",startSeconds:2,endSeconds:3}]};
 return {context,authority:context.nativeAppointmentAuthorization!,payload,input};
}
const project=(f:ReturnType<typeof fixture>,v=version)=>composeCalendarSummary(f.payload,f.context,"en",v);

describe("conversation-based final assessment",()=>{
 it.each(["book","confirm_existing","reschedule","cancel"] as const)("confirms %s from conversation without a journal",operation=>{
  const f=fixture(operation);expect(()=>validateTextProcessingOutput(f.input,f.payload)).not.toThrow();
  const output=project(f);expect(output.assessment?.goal.status).toBe("achieved");
  expect(output.appointmentResult).toMatchObject({operation,status:"confirmed",representedPerson:"Alex Example",date:"2099-09-16"});
  if(operation==="cancel")expect(output.calendar).toBeUndefined();else expect(output.calendar).toMatchObject({actionState:"confirmed",eligibility:"within"});
  expect(composeCalendarSummary(output,f.context,"en",version)).toEqual(output);
  expect(()=>assertSummaryArtifactOutput({kind:"call_summary",generatorVersion:version,sourceContext:f.context,contextHash:textPayloadHash(f.context),compilationId:f.context.compilationId,
   transcriptRevisionId:f.context.transcriptRevisionId,sourceHash:f.context.transcriptSourceHash,targetLanguage:"en"} as CallTextArtifact,output)).not.toThrow();
  expect(project(f,"summary-v8:grounded-v3:test").assessment?.goal.status).toBe("partial");
 });
 it.each(["authorized","delivered","uncertain","confirmed","declined","foreign_attempt","foreign_snapshot","wrong_slot"])("does not change evidence-based assessment for journal state %s",state=>{
  const f=fixture();const before=project(f);const providerBefore=providerTextInput(f.input);
  const action=nativeAction(randomUUID(),f.context.callAttemptId,f.context.compilationSnapshotHash);f.context.nativeAppointmentAction=action;
  if(state==="foreign_attempt")action.callAttemptId=randomUUID();else if(state==="foreign_snapshot")action.snapshotHash="c".repeat(64);
  else if(state==="wrong_slot")action.proposal.startTime="16:00";else action.state=state as typeof action.state;
  expect(project(f).assessment).toEqual(before.assessment);expect(project(f).appointmentResult).toEqual(before.appointmentResult);
  expect(providerTextInput(f.input)).toEqual(providerBefore);
  expect(f.context.nativeAppointmentAction).toBe(action);
 });
 it.each(["offered","conditional","ambiguous","competing","wrong_time","excluded_date","past","unconfirmed","reschedule_not_replaced","unmet_condition"])("retains the substantive guard for %s",problem=>{
  const f=fixture(problem==="reschedule_not_replaced"?"reschedule":"book"),candidate=f.payload.appointmentExtraction!.candidates[0]!;
  if(["offered","conditional","ambiguous"].includes(problem))candidate.status=problem as typeof candidate.status;
  if(problem==="competing")f.payload.appointmentExtraction!.candidates.push({...candidate,id:"second",startTime:"16:00"});
  if(problem==="wrong_time")candidate.startTime="20:00";
  if(problem==="excluded_date")f.authority.alternatives[0]!.rules[0]!.excludedDates=[candidate.date!];
  if(problem==="past")f.context.callConnectedAt="2100-01-01T00:00:00.000Z";
  if(problem==="unconfirmed")f.payload.appointmentExtraction!.nativeOutcome!.disposition="unconfirmed";
  if(problem==="reschedule_not_replaced")f.payload.appointmentExtraction!.nativeOutcome!.previousAppointmentReleased=false;
  if(problem==="unmet_condition")f.payload.assessment!.criteria[0]!.status="not_achieved";
  expect(project(f).assessment?.goal.status).toBe("partial");
 });
 it("does not promote an uncertain model assessment or infer missing evidence from the journal",()=>{
  const f=fixture();f.payload.assessment!.goal.status="uncertain";expect(project(f).assessment?.goal.status).toBe("uncertain");
  f.context.nativeAppointmentAction=nativeAction(randomUUID(),f.context.callAttemptId,f.context.compilationSnapshotHash);f.context.nativeAppointmentAction.state="confirmed";
  f.payload.appointmentExtraction!.nativeOutcome!.disposition="unconfirmed";
  expect(project(f).appointmentResult?.status).toBe("unconfirmed");expect(project(f).assessment?.goal.status).toBe("uncertain");
 });
 it("accepts an inactive conditional branch regardless of a diagnostic journal",()=>{
  const f=fixture();f.context.nativeAppointmentAction=nativeAction(randomUUID(),f.context.callAttemptId,f.context.compilationSnapshotHash);
  f.payload.appointmentExtraction!.candidates=[];Object.assign(f.payload.appointmentExtraction!.nativeOutcome!,{disposition:"not_required",candidateId:null});
  expect(()=>validateTextProcessingOutput(f.input,f.payload)).not.toThrow();expect(project(f).assessment?.goal.status).toBe("achieved");
  expect(project(f).appointmentResult).toBeUndefined();expect(project(f).calendar).toBeUndefined();
  delete f.input.assessmentBasis;expect(()=>validateTextProcessingOutput(f.input,f.payload)).toThrow();
 });
 it("requires recipient citations and rejects a model-supplied result card",()=>{
  const f=fixture();const forged=project(f);delete forged.calendar;
  expect(()=>validateTextProcessingOutput(f.input,forged)).toThrow();
  f.payload.appointmentExtraction!.nativeOutcome!.sourceSegmentIds=["ask"];
  expect(()=>validateTextProcessingOutput(f.input,f.payload)).toThrow();
 });
 it("keeps general information requests free of appointment cards",()=>{
  const f=fixture();f.context.nativeAppointmentAuthorization=null;f.payload.appointmentExtraction={candidates:[],conditions:[]};
  expect(()=>validateTextProcessingOutput(f.input,f.payload)).not.toThrow();
  expect(project(f).appointmentResult).toBeUndefined();expect(project(f).calendar).toBeUndefined();expect(project(f).assessment?.goal.status).toBe("achieved");
 });
 it("applies the same rule to legacy appointment authority",()=>{
  const f=fixture();const context:SummarySourceContext={...f.context,version:1,appointmentAuthorization:{operation:"book",serviceDescription:"Meeting",providerScope:"called_recipient",timeZone:"Europe/Zurich",
   windows:[{date:"2099-09-16",startTime:"15:00",endTime:"15:00"}],selection:"first_matching",maxAppointments:1,financialPolicy:"no_new_financial_terms"}};
  delete f.payload.appointmentExtraction!.nativeOutcome;
  expect(composeCalendarSummary(f.payload,context,"en",version)).toMatchObject({assessment:{goal:{status:"achieved"}},appointmentResult:{status:"confirmed"}});
 });
 it("pins historical prompts while the new prompt defines the evidence boundary",()=>{
  const f=fixture();const legacy="When call_summary includes sourceContext, legacy. The user message is a JSON data envelope";
  expect(nativeSummaryInstructions(legacy,f.input)).toContain("Assessment basis: conversation");
  expect(nativeSummaryInstructions(legacy,f.input)).not.toContain("calendar membership and journal consistency");
  delete f.input.assessmentBasis;expect(nativeSummaryInstructions(legacy,f.input)).toContain("calendar membership and journal consistency");
 });
});
