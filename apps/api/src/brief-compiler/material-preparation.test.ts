import { createHash } from "node:crypto";
import { expect,it } from "vitest";
import { z } from "zod";
import { HOLISTIC_PREPARATION_POLICY, MATERIAL_PREPARATION_POLICY, RELIABLE_PREPARATION_POLICY, createPlanOnlyTaskContext, nativeAppointmentRuleContains } from "@callassist/contracts";
import { holisticPreparationContract, materialCandidateSchema } from "./material-preparation-contract";
import { holisticCandidateSchema, assembleHolisticCandidate } from "./holistic-contract";
import { meetingCandidate,reliabilityInput,reliabilityReferenceTime } from "../test-helpers/preparation-reliability";
import { validateNativeAppointment } from "../appointments/native-appointment-authorization";
import { nativeProposal } from "../test-helpers/native-appointment";
import { OpenAIBriefCompiler } from "./brief-compiler";
import { holisticPolicy } from "../test-helpers/holistic-candidate";
import { summaryInput } from "../text-processing/summary-input";

const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
it("retains the exact previous prompts and provider schema for pinned jobs",()=>{
  const old=holisticPreparationContract(HOLISTIC_PREPARATION_POLICY);
  expect(hash(old.generation)).toBe("d556674b15897c1208bdeb9e5c36ac19d3ad57062a4ad06b14fb41c7383866ad");
  expect(hash(old.audit)).toBe("502f1e4c2e885ef67bb4010175c96cef91d10b94e4e949f54bc3386a72d407aa");
  expect(hash({verbosity:"low",format:{type:"json_schema",name:"callassist_holistic_candidate",strict:true,schema:z.toJSONSchema(old.candidateSchema)}}))
    .toBe("d810365ea8fc81f1bc42456e9dd2816c78610984c52ed42be589c618cc10de8d");
  const current=holisticPreparationContract(MATERIAL_PREPARATION_POLICY);
  expect(hash(current.generation)).toBe("199382577bbb442a6c1124e9bc4174a2a82fd6036a41e1cd5fe3387bf987bff4");
  expect(hash(current.audit)).toBe("d6e6fc178fb0f9373df42841cc4c871dd10d6b14e95c49b606fdf76755261e33");
  expect(hash(z.toJSONSchema(current.candidateSchema))).toBe("be7bb74b69c7206b8205544669152094c79dc531353d7dc3bbb3b7d5b80c54f6");
  expect(hash(current.generation)).not.toBe(hash(old.generation));
  expect(hash(current.audit)).not.toBe(hash(old.audit));
});

it("changes provider descriptions without changing accepted candidate values or execution projection",async()=>{
  const candidate=await meetingCandidate();
  const old=holisticCandidateSchema.parse(candidate),current=materialCandidateSchema.parse(candidate);
  expect(current).toEqual(old);
  const withoutDescriptions=(schema:unknown)=>JSON.parse(JSON.stringify(schema,(key,value)=>key==="description"?undefined:value));
  expect(withoutDescriptions(z.toJSONSchema(materialCandidateSchema))).toEqual(withoutDescriptions(z.toJSONSchema(holisticCandidateSchema)));
  expect(createPlanOnlyTaskContext(assembleHolisticCandidate(current,reliabilityInput,reliabilityReferenceTime),reliabilityInput,"female"))
    .toEqual(createPlanOnlyTaskContext(assembleHolisticCandidate(old,reliabilityInput,reliabilityReferenceTime),reliabilityInput,"female"));
});

it("keeps initial options usable and enforces recipient evidence for a structured fallback",async()=>{
  const a=assembleHolisticCandidate(await meetingCandidate(),reliabilityInput,reliabilityReferenceTime).nativeAppointmentAuthorization!;
  const quote="Neither offered slot works. I propose November 26 at 16:00.";
  const initial={...nativeProposal,alternativeId:"alternative_1",date:"2026-11-24",startTime:"14:00"};
  expect(validateNativeAppointment(a,initial,"",reliabilityReferenceTime).ok).toBe(true);
  const fallback={...initial,alternativeId:"alternative_2",date:"2026-11-26",startTime:"16:00",
    requirements:[{id:"alternative_2_requirement_1",recipientQuote:quote}],unavailableAlternatives:[{id:"alternative_1",recipientQuote:quote}]};
  expect(validateNativeAppointment(a,fallback,quote,reliabilityReferenceTime).ok).toBe(true);
  expect(validateNativeAppointment(a,{...fallback,unavailableAlternatives:[]},quote,reliabilityReferenceTime)).toMatchObject({ok:false,reason:"earlier_alternative_evidence_required"});
  expect(validateNativeAppointment(a,{...fallback,requirements:[]},quote,reliabilityReferenceTime)).toMatchObject({ok:false,reason:"missing_requirement_evidence"});
  expect(validateNativeAppointment(a,fallback,"No such evidence",reliabilityReferenceTime)).toMatchObject({ok:false,reason:"evidence_quote_not_observed"});
  expect(validateNativeAppointment(a,{...fallback,recipientMatches:false},quote,reliabilityReferenceTime)).toMatchObject({ok:false,reason:"party_or_service_mismatch"});
  expect(validateNativeAppointment(a,{...fallback,requiresUnapprovedTerms:true},quote,reliabilityReferenceTime)).toMatchObject({ok:false,reason:"unapproved_terms"});
});

it.each(["missing","prose_only"] as const)("still rejects an unexecutable %s fallback",async kind=>{
  const a=assembleHolisticCandidate(await meetingCandidate(kind),reliabilityInput,reliabilityReferenceTime).nativeAppointmentAuthorization!;
  expect(validateNativeAppointment(a,{...nativeProposal,alternativeId:"alternative_1",date:"2026-11-26",startTime:"16:00"},"I propose November 26",reliabilityReferenceTime))
    .toMatchObject({ok:false,reason:"outside_authorized_window"});
  expect(a.alternatives.some(b=>b.rules.some(r=>nativeAppointmentRuleContains(r,"2026-11-26","16:00")))).toBe(false);
});

it("leaves compilation snapshots, voice context and post-call inputs identical for the same accepted candidate",async()=>{
  const candidate=await meetingCandidate(),outputs=[];
  for(const promptVersion of [HOLISTIC_PREPARATION_POLICY,MATERIAL_PREPARATION_POLICY,RELIABLE_PREPARATION_POLICY]) {
    const fetchImplementation:typeof fetch=async(url,init)=>{
      if(String(url).endsWith("moderations"))return Response.json({results:[{flagged:false}]});
      const body=JSON.parse(String(init?.body));
      return Response.json({id:"same-response",status:"completed",output_text:JSON.stringify(body.text.format.name==="callassist_holistic_review"?{verdict:"accept",message:""}:candidate)});
    };
    outputs.push(await new OpenAIBriefCompiler({apiKey:"test",fetchImplementation,now:()=>reliabilityReferenceTime}).compile(reliabilityInput,1,{policy:{...holisticPolicy,promptVersion}}));
  }
  expect(outputs[1]).toEqual(outputs[0]);
  expect(summaryInput(outputs[1]!,[],"en")).toEqual(summaryInput(outputs[0]!,[],"en"));
  expect(outputs[2]).toEqual(outputs[0]);
  expect(summaryInput(outputs[2]!,[],"en")).toEqual(summaryInput(outputs[0]!,[],"en"));
});
