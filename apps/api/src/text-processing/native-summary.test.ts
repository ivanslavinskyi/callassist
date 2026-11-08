import {randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import type {CallSummaryPayload,NativeAppointmentOperation,SummarySourceContext,CallTextArtifact} from "@callassist/contracts";
import {summarySourceContextSchema} from "@callassist/contracts";
import {preparationTransportDiagnosticsSchema} from "@callassist/contracts";
import {nativeAction,nativeAuthority} from "../test-helpers/native-appointment";
import {OpenAITextProcessor} from "./openai-text-processor";
import {composeCalendarSummary,assertSummaryArtifactOutput} from "./summary-calendar";
import {textOutputJsonSchema,validateTextProcessingOutput} from "./text-validation";
import {textPayloadHash} from "../storage/call-text-repository";
import type {TextProcessingInput} from "./text-processor";
import type {TextProcessingProviderRequestResult} from "./text-processor";

function fixture(operation:NativeAppointmentOperation="book") {
 const now="2026-11-07T11:00:00.000Z",attempt=randomUUID(),hash="a".repeat(64);
 const action=nativeAction(randomUUID(),attempt,hash),authority=structuredClone(nativeAuthority);
 authority.operation=operation;action.proposal.operation=operation;
 if(operation!=="book")authority.existingAppointment={date:operation==="reschedule"?"2099-09-15":action.proposal.date,startTime:action.proposal.startTime,reference:null};
 if(operation==="cancel"||operation==="confirm_existing"){authority.alternatives=[];action.proposal.alternativeId=null;}
 Object.assign(action,{state:"confirmed",delivery:{status:"played",mark:"native",assistantQuote:"Requested operation?",observedAt:now},
  confirmation:{source:"recipient_statement",independentlyVerified:false,recipientQuote:"Yes, confirmed.",observedAt:now}});
 const context:Extract<SummarySourceContext,{version:2}>={version:2,callAttemptId:attempt,compilationId:randomUUID(),compilationSnapshotHash:hash,
  transcriptRevisionId:randomUUID(),transcriptSourceHash:"b".repeat(64),callCreatedAt:now,callConnectedAt:now,callEndedAt:now,approvedAt:now,
  appointmentAuthorization:null,actionEvidence:null,nativeAppointmentAuthorization:authority,nativeAppointmentAction:action};
 const input:Extract<TextProcessingInput,{kind:"call_summary"}>={kind:"call_summary",nativeFormat:"native-summary-v1",sourceContext:context,targetLanguage:"en",assessmentMode:"evaluate",
  context:{objective:"Perform the approved operation if its conditions hold",taskType:"appointment_coordination",recipient:"Office",representedPerson:"Nina Keller"},
  checks:[{id:"goal",text:"Perform the approved task"},{id:"criterion.0",text:"Complete the requested operation"}],
  segments:[{id:"ask",role:"assistant",text:"Requested operation?",startSeconds:0,endSeconds:1},{id:"answer",role:"recipient",text:"Yes, confirmed.",startSeconds:2,endSeconds:3}]};
 const payload:CallSummaryPayload={schemaVersion:3,overview:[{label:"Result",text:"The recipient confirmed the operation.",findingIds:["goal"]}],
  findings:input.checks.map(c=>({id:c.id,label:"Result",text:"The recipient confirmed the operation.",certainty:"reported",sourceSegmentIds:["ask","answer"]})),nextSteps:[],unresolved:[],unresolvedDetails:[],
  appointmentExtraction:{candidates:[{id:"slot",date:action.proposal.date,startTime:action.proposal.startTime,timeZone:authority.timeZone,zoneSource:"approved_plan",status:"reported_confirmed",supersedes:[],sourceSegmentIds:["ask","answer"]}],conditions:[],
   nativeOutcome:{operation,disposition:"confirmed",candidateId:"slot",previousAppointmentReleased:operation==="reschedule"?true:null,sourceSegmentIds:["ask","answer"]}},
  assessment:{conversation:{status:"confirmed",category:"task_answer",questionSegmentId:"ask",answerSegmentId:"answer",answerQuote:"Yes, confirmed."},goal:{status:"achieved",sourceSegmentIds:["answer"]},criteria:[{id:"criterion.0",status:"achieved",sourceSegmentIds:["answer"]}]}};
 const parsed=summarySourceContextSchema.parse(context) as typeof context;
 input.sourceContext=parsed;
 return {input,context:parsed,payload,action:parsed.nativeAppointmentAction!,authority:parsed.nativeAppointmentAuthorization!};
}
const project=(f:ReturnType<typeof fixture>)=>composeCalendarSummary(f.payload,f.context,"en","summary-v6:grounded-v3:text-processing-v2:openai:gpt-6-luna");

describe("native summary end-to-end contract",()=>{
 it("gives a general native task full instructions and one accountable grounding repair",async()=>{
  const f=fixture();f.input.nativeFormat="native-summary-v3";
  f.context.nativeAppointmentAuthorization=null;f.context.nativeAppointmentAction=null;
  f.input.context.taskType="receipt_confirmation";
  f.input.nativeTaskSources={objective:"Ask whether the application arrived",context:"Ask for the reference only if it arrived.",allowedFacts:["Owner: Nina Keller"],clarificationAnswers:[],deliveryInstruction:""};
  f.payload.appointmentExtraction={candidates:[],conditions:[]};
  const bad=structuredClone(f.payload);bad.findings[0]!.text="Application 999 arrived.";
  const fetchImplementation=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({output_text:JSON.stringify(bad)})).mockResolvedValueOnce(Response.json({output_text:JSON.stringify(f.payload)}));
  const outcomes:TextProcessingProviderRequestResult[]=[];
  expect(await new OpenAITextProcessor({apiKey:"test",fetchImplementation}).process(f.input,{maxProviderRequests:2,beforeProviderRequest:async()=>true,afterProviderRequest:async r=>{outcomes.push(r);}})).toEqual(f.payload);
  expect(outcomes).toHaveLength(2);
  expect(outcomes[0]?.diagnostics?.textValidation).toMatchObject({nativeFormat:"native-summary-v3",repair:"none",validationCode:"TEXT_INVALID_GROUNDING",validationFieldPath:"findings.0"});
  expect(outcomes[1]?.diagnostics?.textValidation).toMatchObject({repair:"grounding",repairFieldPath:"findings.0",validationCode:null});
  for(const result of outcomes){expect(preparationTransportDiagnosticsSchema.safeParse(result.diagnostics).success).toBe(true);expect(Buffer.byteLength(JSON.stringify(result.diagnostics))).toBeLessThan(2048);}
  const request=JSON.parse(String(fetchImplementation.mock.calls[0]![1]!.body));
  expect(request.input[0].content).toContain("original");expect(JSON.parse(request.input[1].content).nativeTaskSources).toEqual(f.input.nativeTaskSources);
  expect(()=>validateTextProcessingOutput(f.input,{...f.payload,appointmentExtraction:{...f.payload.appointmentExtraction,nativeOutcome:{operation:"book",disposition:"not_required",candidateId:null,previousAppointmentReleased:null,sourceSegmentIds:["answer"]}}})).toThrow();
 });
 it("repairs one precisely identified grounding error with separately accounted requests and unchanged evidence guards",async()=>{
  const f=fixture();f.input.nativeFormat="native-summary-v2";
  f.input.checks[1]!.text="If the price exceeds 100 francs, do not book.";
  f.input.segments[1]!.text="90 francs. Yes, confirmed.";
  f.payload.assessment!.conversation.answerQuote=f.input.segments[1]!.text;
  f.payload.findings[1]!.text="90 francs; the refusal condition did not apply.";
  const bad=structuredClone(f.payload);bad.findings[1]!.text="90 francs; the condition above 100 francs did not apply.";
  expect(()=>validateTextProcessingOutput(f.input,bad)).toThrow(expect.objectContaining({validationCode:"TEXT_INVALID_GROUNDING",fieldPath:"findings.1"}));
  const fetchImplementation=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({output_text:JSON.stringify(bad)})).mockResolvedValueOnce(Response.json({output_text:JSON.stringify(f.payload)}));
  const outcomes:TextProcessingProviderRequestResult[]=[],reservations:string[]=[];
  const processor=new OpenAITextProcessor({apiKey:"test",fetchImplementation});
  expect(await processor.process(f.input,{maxProviderRequests:2,beforeProviderRequest:async r=>{reservations.push(r.clientRequestId);return true;},afterProviderRequest:async r=>{outcomes.push(r);}})).toEqual(f.payload);
  expect(new Set(reservations).size).toBe(2);
  expect(outcomes.map(r=>r.outcome)).toEqual(["invalid_response","succeeded"]);
  const requests=fetchImplementation.mock.calls.map(c=>JSON.parse(String(c[1]!.body)));
  expect(requests[0].input[0].content).toContain("Do not repeat a budget");
  expect(requests[1].input[0].content).toContain("evidence check at findings.1");
  expect(requests[1].input[1]).toEqual(requests[0].input[1]);
  expect(()=>validateTextProcessingOutput(f.input,bad)).toThrow();
 });
 it.each(["legacy","one_request","repeat_failure","reservation_denied","cancelled","foreign_reference"])("bounds grounding recovery: %s",async scenario=>{
  const f=fixture();f.input.nativeFormat=scenario==="legacy"?"native-summary-v1":"native-summary-v2";
  f.payload.findings[0]!.text="Invented price 999.";
  if(scenario==="foreign_reference")f.payload.findings[0]!.sourceSegmentIds=["foreign"];
  const fetchImplementation=vi.fn<typeof fetch>(async()=>Response.json({output_text:JSON.stringify(f.payload)}));
  const processor=new OpenAITextProcessor({apiKey:"test",fetchImplementation}),controller=new AbortController();let reserved=0;
  await expect(processor.process(f.input,{maxProviderRequests:scenario==="one_request"?1:2,signal:controller.signal,
   beforeProviderRequest:async()=>{reserved++;return scenario!=="reservation_denied"||reserved===1;},
   afterProviderRequest:async()=>{if(scenario==="cancelled")controller.abort();}})).rejects.toThrow();
  expect(fetchImplementation).toHaveBeenCalledTimes(scenario==="repeat_failure"?2:1);
 });
 it.each(["book","confirm_existing","reschedule","cancel"] as const)("extracts and publishes an evidenced %s with null legacy authority",async operation=>{
  const f=fixture(operation),fetchImplementation=vi.fn<typeof fetch>(async()=>Response.json({output_text:JSON.stringify(f.payload)}));
  const processor=new OpenAITextProcessor({apiKey:"test",fetchImplementation});
  const result=await processor.process(f.input);
  const request=JSON.parse(String(fetchImplementation.mock.calls[0]![1]!.body));
  expect(request.text.format.schema.properties.appointmentExtraction.properties.candidates.maxItems).toBe(10);
  expect(request.input[0].content).not.toContain("Do not create candidates or conditions without appointmentAuthorization");
  expect(result).toEqual(f.payload);
  const final=project(f);expect(final.assessment?.goal.status).toBe("achieved");
  if(operation==="cancel")expect(final.calendar).toBeUndefined();
  else expect(final.calendar).toMatchObject({eligibility:"within",actionState:"confirmed",contextHash:textPayloadHash(f.context)});
  if(operation==="book")expect(final.calendar?.sourceText).toContain("09:00–17:00");
  expect(composeCalendarSummary(final,f.context,"en","summary-v6:")).toEqual(final);
  expect(()=>assertSummaryArtifactOutput({kind:"call_summary",generatorVersion:"summary-v6:grounded-v3:test",sourceContext:f.context,contextHash:textPayloadHash(f.context),compilationId:f.context.compilationId,transcriptRevisionId:f.context.transcriptRevisionId,sourceHash:f.context.transcriptSourceHash,targetLanguage:"en"} as CallTextArtifact,final)).not.toThrow();
 });
 it("preserves the v5 extraction contract for queued native work",()=>{
  const f=fixture();delete f.input.nativeFormat;
  expect((textOutputJsonSchema(f.input) as any).properties.appointmentExtraction.properties.candidates.maxItems).toBe(0);
  expect(()=>validateTextProcessingOutput(f.input,f.payload)).toThrow();
 });
 it.each(["foreign_attempt","foreign_snapshot","offered","wrong_slot","unconfirmed","competing_confirmation","excluded_date","past"])("does not promote %s to success",problem=>{
  const f=fixture(),candidate=f.payload.appointmentExtraction!.candidates[0]!;
  if(problem==="foreign_attempt")f.action.callAttemptId=randomUUID();
  if(problem==="foreign_snapshot")f.action.snapshotHash="c".repeat(64);
  if(problem==="offered")candidate.status="offered";
  if(problem==="wrong_slot")candidate.startTime="16:00";
  if(problem==="unconfirmed")f.action.state="uncertain";
  if(problem==="competing_confirmation")f.payload.appointmentExtraction!.candidates.push({...candidate,id:"other",startTime:"16:00"});
  if(problem==="excluded_date")f.authority.alternatives[0]!.rules[0]!.excludedDates=[candidate.date!];
  if(problem==="past")f.context.callConnectedAt="2099-10-01T10:00:00.000Z";
  expect(project(f).assessment?.goal.status).toBe("partial");
 });
 it("requires independently extracted release of the old appointment on reschedule",()=>{
  const f=fixture("reschedule");f.payload.appointmentExtraction!.nativeOutcome!.previousAppointmentReleased=false;
  expect(project(f).assessment?.goal.status).toBe("partial");
 });
 it("does not fill missing cancellation evidence from a confirmed journal",()=>{
  const f=fixture("cancel");f.payload.appointmentExtraction!.nativeOutcome!.disposition="unconfirmed";
  expect(project(f).assessment?.goal.status).toBe("partial");
  expect(project(f).calendar).toBeUndefined();
 });
 it("allows a conditional task to succeed when its action correctly was not required",()=>{
  const f=fixture();f.context.nativeAppointmentAction=null;f.payload.appointmentExtraction!.candidates=[];
  Object.assign(f.payload.appointmentExtraction!.nativeOutcome!,{disposition:"not_required",candidateId:null});
  expect(()=>validateTextProcessingOutput(f.input,f.payload)).not.toThrow();
  expect(project(f)).toMatchObject({assessment:{goal:{status:"achieved"}}});expect(project(f).calendar).toBeUndefined();
  f.payload.assessment!.criteria[0]!.status="uncertain";expect(project(f).assessment?.goal.status).toBe("partial");
 });
 it.each(["wrong_operation","foreign_citation","assistant_only","missing_outcome","skip_existing_action","wrong_zone"])("rejects invalid native extraction: %s",problem=>{
  const f=fixture(),outcome=f.payload.appointmentExtraction!.nativeOutcome!;
  if(problem==="wrong_operation")outcome.operation="cancel";
  if(problem==="foreign_citation")outcome.sourceSegmentIds=["foreign"];
  if(problem==="assistant_only")outcome.sourceSegmentIds=["ask"];
  if(problem==="missing_outcome")delete f.payload.appointmentExtraction!.nativeOutcome;
  if(problem==="skip_existing_action"){outcome.disposition="not_required";outcome.candidateId=null;f.payload.appointmentExtraction!.candidates=[];}
  if(problem==="wrong_zone")f.payload.appointmentExtraction!.candidates[0]!.timeZone="Europe/London";
  expect(()=>validateTextProcessingOutput(f.input,f.payload)).toThrow();
 });
});
