import { describe,it,expect,vi } from "vitest";
vi.mock("./execution-language",()=>({verifyExecutionLanguage:vi.fn(async()=>[])}));
import { defaultPreparationRuntimePolicy,normalizeCreateCallBriefInput,createApprovedExecutionSnapshot,nativeAppointmentAuthorizationSchema } from "@callassist/contracts";
import { DeterministicBriefCompiler,OpenAIBriefCompiler } from "./brief-compiler";
import { NATIVE_ACTIONS_POLICY,NATIVE_PROGRESSIVE_POLICY,prepareNativeAppointmentOutput } from "./native-appointment-compilation";
import { nativeAuthority } from "../test-helpers/native-appointment";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import { originalPlanReview } from "../test-helpers/original-plan-review";
import { hasValidCompilationSnapshotHash } from "./compilation-integrity";
import { nativeV2Session } from "../voice/live-task-context";
const raw=normalizeCreateCallBriefInput({recipientName:"Office",phoneNumber:"+41710000001",representedPersonFirstName:"Nina",representedPersonLastName:"Keller",assistantProfileId:"anna",locale:"en-GB",objective:"Book a routine consultation next week between nine and five.",context:"Only Dr Example.",allowedFacts:[]});
const policy={...defaultPreparationRuntimePolicy,promptVersion:NATIVE_ACTIONS_POLICY} as const;
function model(operation="book"){
 return {taskType:"appointment_coordination",appointmentAuthorization:null,nativeAppointmentInterpretation:{intent:operation,authorityEvidence:{source:"objective",clarificationAnswerIndex:null,quote:raw.objective},authorization:{...nativeAuthority,operation,existingAppointment:operation==="book"?null:{date:"2099-09-10",startTime:"12:00",reference:null},alternatives:operation==="cancel"||operation==="confirm_existing"?[]:[{...nativeAuthority.alternatives[0],rules:[{dates:{kind:"next_calendar_week"},weekdays:[],excludedWeekdays:[5],excludedDates:[],startTime:"09:00",endTime:"17:00"}]}]}}};
}
describe("native action preparation",()=>{
 it.each(["book","confirm_existing","reschedule","cancel"].flatMap(operation=>[
  {operation,promptVersion:NATIVE_ACTIONS_POLICY,compilerVersion:"brief-compiler-11"} as const,
  {operation,promptVersion:NATIVE_PROGRESSIVE_POLICY,compilerVersion:"brief-compiler-12"} as const
 ]))("compiles and approves $operation with $promptVersion and full original startup context",async ({operation,promptVersion,compilerVersion})=>{
  const base=(await new DeterministicBriefCompiler().compile(raw)).compiledBrief!;
  const output={...base,...model(operation),blockingIssues:[]};
  const fetchImplementation=vi.fn<typeof fetch>(async url=>new Response(JSON.stringify(String(url).endsWith("moderations")?{results:[{flagged:false}]}:{output_text:JSON.stringify(output)}),{status:200}));
  const compilation=await new OpenAIBriefCompiler({apiKey:"test",fetchImplementation,now:()=>new Date("2099-09-01T10:00:00Z")}).compile(raw,1,{policy:{...policy,promptVersion}});
  expect(compilation).toMatchObject({compilerVersion,compiledBrief:{schemaVersion:"9",nativeAppointmentAuthorization:{operation}},policyDecision:{status:"ready_for_review"}});
  expect(hasValidCompilationSnapshotHash(compilation)).toBe(true);
  const repo=new InMemoryCallRepository(),brief=await repo.create(raw,compilation);const approved=await repo.approveCompilation(brief.id,await originalPlanReview(repo,brief.id));
  const snapshot=createApprovedExecutionSnapshot(approved);expect(snapshot.version).toBe(8);
  const session=nativeV2Session(snapshot);expect(session.tools!.map((t:any)=>t.name)).toContain("prepare_appointment");
  expect(JSON.stringify(session.input)).toContain(raw.context);expect(session.instructions).toContain("name the represented person bound to the approved appointment action");
  const request=fetchImplementation.mock.calls.map(c=>JSON.parse(String(c[1]?.body))).find(b=>b.text?.format?.name==="callassist_compiled_brief");
  expect(request.input[0].content).toContain("nativeAppointmentInterpretation");expect(request.input[0].content).not.toContain("Always return the compiler-only schedulingInterpretation");
  expect(request.input[0].content.includes("Resolve prerequisites before dependent actions")).toBe(promptVersion===NATIVE_PROGRESSIVE_POLICY);
 });
 it("resolves relative periods from the trusted clock without silently truncating open-ended authority",()=>{
  const value=model();const auth=value.nativeAppointmentInterpretation.authorization;
  auth.alternatives[0]!.rules[0]!.dates={kind:"relative_days",startOffsetDays:1,count:null} as any;
  const result=prepareNativeAppointmentOutput(value,raw,new Date("2099-09-01T23:00:00Z"));expect(result.success).toBe(true);
  if(!result.success)throw Error();expect(result.output.nativeAppointmentAuthorization?.alternatives[0]?.rules[0]).toMatchObject({startDate:"2099-09-03",endDate:null,excludedWeekdays:[5]});
 });
 it("does not grant authority from reference context or fabricated evidence",()=>{
  const value=model();value.nativeAppointmentInterpretation.authorityEvidence.source="context";expect(prepareNativeAppointmentOutput(value,raw,new Date()).success).toBe(false);
  value.nativeAppointmentInterpretation.authorityEvidence.source="objective";value.nativeAppointmentInterpretation.authorityEvidence.quote="Please cancel everything";expect(prepareNativeAppointmentOutput(value,raw,new Date()).success).toBe(false);
 });
 it("grounds requirements and blocks incomplete permissions",()=>{
  const value=model();value.nativeAppointmentInterpretation.authorization.requirements=[{id:"doctor",description:"Only Dr Example",sourceText:"Only Dr Example."}];
  expect(prepareNativeAppointmentOutput(value,raw,new Date()).success).toBe(true);
  value.nativeAppointmentInterpretation.authorization.requirements[0]!.sourceText="Invented preference";expect(prepareNativeAppointmentOutput(value,raw,new Date()).success).toBe(false);
  const missing={...model(),nativeAppointmentInterpretation:{...model().nativeAppointmentInterpretation,authorization:null}};
  expect(prepareNativeAppointmentOutput(missing,raw,new Date())).toMatchObject({success:true,context:{missingSchedulingConstraints:true}});
  expect(nativeAppointmentAuthorizationSchema.safeParse({...nativeAuthority,operation:"cancel",alternatives:[]}).success).toBe(false);
 });
});
