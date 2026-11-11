import { defaultPreparationRuntimePolicy, HOLISTIC_PREPARATION_POLICY, normalizeCreateCallBriefInput } from "@callassist/contracts";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { holisticCandidateSchema } from "../brief-compiler/holistic-contract";
export const holisticPolicy={...defaultPreparationRuntimePolicy,promptVersion:HOLISTIC_PREPARATION_POLICY};
export const holisticInput=normalizeCreateCallBriefInput({recipientName:"Office",representedPersonFirstName:"Nina",representedPersonLastName:"Example",
  phoneNumber:"+41710000001",assistantProfileId:"anna",locale:"en-GB",objective:"Ask about opening hours. Reference AB-17.",allowedFacts:[]});
export async function holisticCandidate(input=holisticInput) {
  const c=(await new DeterministicBriefCompiler().compile(input,1,{policy:holisticPolicy})).compiledBrief!;
  return holisticCandidateSchema.parse({...Object.fromEntries(Object.entries(c).filter(([k])=>k in holisticCandidateSchema.shape)),
    inferredTone:null,inferredAddressing:null,appointmentProposal:null});
}
