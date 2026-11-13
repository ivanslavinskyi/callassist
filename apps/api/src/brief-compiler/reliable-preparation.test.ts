import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RELIABLE_PREPARATION_POLICY, MATERIAL_PREPARATION_POLICY, normalizeCreateCallBriefInput, SUPPORTED_CALL_LOCALES } from "@callassist/contracts";
import { holisticPreparationContract } from "./material-preparation-contract";
import { holisticCandidateSchema, assembleHolisticCandidate } from "./holistic-contract";
import { OpenAIBriefCompiler } from "./brief-compiler";
import { meetingCandidate, reliabilityInput, reliabilityReferenceTime } from "../test-helpers/preparation-reliability";
import { holisticPolicy } from "../test-helpers/holistic-candidate";

const stripDescriptions=(value:unknown)=>JSON.parse(JSON.stringify(value,(key,v)=>key==="description"?undefined:v));
describe("reliable preparation boundary",()=>{
  it.each(SUPPORTED_CALL_LOCALES)("binds provider language to %s without changing the candidate format",async locale=>{
    const contract=holisticPreparationContract(RELIABLE_PREPARATION_POLICY,locale);
    expect(contract.generation).toContain("("+locale+")");
    expect(contract.audit).toContain("("+locale+")");
    expect(z.toJSONSchema(contract.candidateSchema).properties?.localizedObjective).toMatchObject({description:expect.stringContaining("("+locale+")")});
    expect(stripDescriptions(z.toJSONSchema(contract.candidateSchema))).toEqual(stripDescriptions(z.toJSONSchema(holisticCandidateSchema)));
    const candidate=await meetingCandidate();
    expect(contract.candidateSchema.parse(candidate)).toEqual(holisticCandidateSchema.parse(candidate));
  });

  it("keeps advisory input-language metadata out of the new audit but preserves it for readers and pinned jobs",async()=>{
    for(const promptVersion of [MATERIAL_PREPARATION_POLICY,RELIABLE_PREPARATION_POLICY]){
      const candidate={...await meetingCandidate(),sourceLanguage:"mul"},bodies:any[]=[];
      const fetchImplementation:typeof fetch=async(url,init)=>{
        if(String(url).endsWith("moderations"))return Response.json({results:[{flagged:false}]});
        const body=JSON.parse(String(init?.body));bodies.push(body);
        return Response.json({status:"completed",output_text:JSON.stringify(body.text.format.name==="callassist_holistic_review"?{verdict:"accept",message:""}:candidate)});
      };
      const c=await new OpenAIBriefCompiler({apiKey:"test",fetchImplementation,now:()=>reliabilityReferenceTime})
        .compile(reliabilityInput,1,{policy:{...holisticPolicy,promptVersion}});
      expect(c.compiledBrief?.sourceLanguage).toBe("mul");
      const audit=JSON.parse(bodies[1].input);
      if(promptVersion===RELIABLE_PREPARATION_POLICY)expect(audit).not.toHaveProperty("sourceLanguage");
      else expect(audit.sourceLanguage).toBe("mul");
      expect(audit.execution.plan).not.toHaveProperty("sourceLanguage");
      expect(bodies).toHaveLength(2);
      expect(c.policyDecision.status).toBe("ready_for_review");
    }
  });

  it("publishes a missing existing-appointment clarification without inventing an executable action",async()=>{
    const raw=normalizeCreateCallBriefInput({...reliabilityInput,objective:"Cancel my appointment. I have not provided its date, time or reference."});
    const candidate={...await meetingCandidate(),appointmentProposal:null,blockingIssues:[
      {code:"missing_required_reference",question:"What are the date and time of the appointment to cancel?"}
    ]};
    const fetchImplementation:typeof fetch=async(url,init)=>{
      if(String(url).endsWith("moderations"))return Response.json({results:[{flagged:false}]});
      const body=JSON.parse(String(init?.body));
      return Response.json({status:"completed",output_text:JSON.stringify(body.text.format.name==="callassist_holistic_review"?{verdict:"accept",message:""}:candidate)});
    };
    const c=await new OpenAIBriefCompiler({apiKey:"test",fetchImplementation,now:()=>reliabilityReferenceTime})
      .compile(raw,1,{policy:{...holisticPolicy,promptVersion:RELIABLE_PREPARATION_POLICY}});
    expect(c.policyDecision).toMatchObject({status:"needs_clarification",clarificationQuestions:[candidate.blockingIssues[0]!.question]});
    expect(c.compiledBrief).toMatchObject({nativeAppointmentAuthorization:null});
    const invalid={...candidate,blockingIssues:[],appointmentProposal:{...((await meetingCandidate()).appointmentProposal),operation:"cancel" as const,existingAppointment:null,alternatives:[]}};
    expect(()=>assembleHolisticCandidate(holisticCandidateSchema.parse(invalid),raw,reliabilityReferenceTime)).toThrow();
  });
});
