import {describe,expect,it,vi} from "vitest";
vi.mock("./execution-language",()=>({verifyExecutionLanguage:vi.fn(async()=>[])}));
import {defaultPreparationRuntimePolicy,normalizeCreateCallBriefInput,callCompilationSchema,legacyPreparationIssue,moderationIssueCategories} from "@callassist/contracts";
import {DeterministicBriefCompiler,OpenAIBriefCompiler} from "./brief-compiler";
import {NATIVE_INTEGRITY_POLICY,NATIVE_PROGRESSIVE_POLICY} from "./native-appointment-compilation";
import {hasValidCompilationSnapshotHash} from "./compilation-integrity";
const raw=normalizeCreateCallBriefInput({recipientName:"Office",phoneNumber:"+41710000001",representedPersonFirstName:"Nina",representedPersonLastName:"Keller",assistantProfileId:"anna",locale:"en-GB",objective:"Ask whether the application arrived",allowedFacts:[]});
const policy={...defaultPreparationRuntimePolicy,promptVersion:NATIVE_INTEGRITY_POLICY} as const;
describe("typed native preparation issues",()=>{
 it("preserves provider categories without exposing refusal prose or extra paid requests",async()=>{
  const fetchImplementation=vi.fn<typeof fetch>(async()=>Response.json({results:[{flagged:true,categories:{harassment:true,"harassment/threatening":true,"unknown-provider-category":true}}]}));
  const result=await new OpenAIBriefCompiler({apiKey:"test",fetchImplementation}).compile(raw,1,{policy});
  expect(fetchImplementation).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({compilerVersion:"brief-compiler-13",policyDecision:{status:"blocked",issue:{kind:"policy_restriction",source:"input_moderation",categories:["harassment_or_abuse","threat_or_intimidation"],retryable:false}}});
  expect(callCompilationSchema.parse(result)).toEqual(result);expect(hasValidCompilationSnapshotHash(result)).toBe(true);
 });
 it("does not invent a reason for an uncategorized refusal",async()=>{
  const fetchImplementation=vi.fn<typeof fetch>(async url=>Response.json(String(url).endsWith("moderations")?{results:[{flagged:false}]}:{output:[{content:[{type:"refusal",refusal:"Untrusted provider prose"}]}]}));
  const result=await new OpenAIBriefCompiler({apiKey:"test",fetchImplementation}).compile(raw,1,{policy});
  expect(result.policyDecision).toMatchObject({issue:{source:"model_refusal",categories:[],action:"edit"}});
  expect(JSON.stringify(result)).not.toContain("Untrusted provider prose");expect(fetchImplementation).toHaveBeenCalledTimes(2);
 });
 it("keeps old policy payloads and hashes unchanged",async()=>{
  const fetchImplementation=vi.fn<typeof fetch>(async()=>Response.json({results:[{flagged:true,categories:{harassment:true}}]}));
  const result=await new OpenAIBriefCompiler({apiKey:"test",fetchImplementation}).compile(raw,1,{policy:{...policy,promptVersion:NATIVE_PROGRESSIVE_POLICY}});
  expect(result.policyDecision).not.toHaveProperty("issue");expect(result.compilerVersion).toBe("brief-compiler-12");
  expect(hasValidCompilationSnapshotHash(callCompilationSchema.parse(result))).toBe(true);
 });
 it.each([false,true])("distinguishes unsupported capability from known risk: %s",async risky=>{
  const base=(await new DeterministicBriefCompiler().compile(raw)).compiledBrief!;
  const output={...base,taskType:"unsupported",riskCategories:risky?["high_stakes_legal"]:[],nativeAppointmentInterpretation:{intent:"none",authorityEvidence:null,authorization:null}};
  const fetchImplementation=vi.fn<typeof fetch>(async url=>Response.json(String(url).endsWith("moderations")?{results:[{flagged:false}]}:{output_text:JSON.stringify(output)}));
  const result=await new OpenAIBriefCompiler({apiKey:"test",fetchImplementation}).compile(raw,1,{policy});
  expect(result.policyDecision).toMatchObject({issue:{kind:risky?"policy_restriction":"unsupported_capability",categories:risky?["high_stakes_legal"]:[]}});
 });
 it("attributes output moderation to the generated plan",async()=>{
  const base=(await new DeterministicBriefCompiler().compile(raw)).compiledBrief!;let moderation=0;
  const output={...base,nativeAppointmentInterpretation:{intent:"none",authorityEvidence:null,authorization:null}};
  const fetchImplementation=vi.fn<typeof fetch>(async url=>Response.json(String(url).endsWith("moderations")?{results:[{flagged:++moderation===2,categories:{harassment:moderation===2}}]}:{output_text:JSON.stringify(output)}));
  const result=await new OpenAIBriefCompiler({apiKey:"test",fetchImplementation}).compile(raw,1,{policy});
  expect(result.policyDecision).toMatchObject({riskLevel:"low",issue:{kind:"plan_validation_failed",source:"output_moderation",action:"retry"}});
 });
 it("tolerates missing legacy reasons and excludes arbitrary moderation labels",()=>{
  expect(legacyPreparationIssue({status:"blocked",reasonCodes:[]})).toMatchObject({code:"unknown_policy_reason",action:"support"});
  expect(moderationIssueCategories({privateUserText:true,harassment:false})).toEqual([]);
 });
});
