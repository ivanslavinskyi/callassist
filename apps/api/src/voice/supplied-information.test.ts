import { it,expect } from "vitest";
import { approvedCall } from "./voice-test-helpers";
import { nativeV2Session } from "./live-task-context";
import { NATIVE_SUPPLIED_INFORMATION_V1 } from "./supplied-information";
import type { ApprovedExecutionSnapshot } from "@callassist/contracts";
const facts='Patient: Nina Keller. DOB: 1990-04-03. Contact: +41791234567. Address: Teststrasse 12. Prior visit: no. Insurance: 001234567.';
it.each(['objective','context','allowedFacts','clarificationAnswers'] as const)('delivers exact facts from %s to native Live without new tools',async field=>{
  const h=await approvedCall();
  try{
    const snapshot=structuredClone(h.snapshot) as unknown as Extract<ApprovedExecutionSnapshot,{version:8}>;
    snapshot.version=8;
    snapshot.taskSources={...snapshot.taskSources,objective:'Ask for opening hours',context:'',allowedFacts:[],clarificationAnswers:[]};
    if(field==='allowedFacts')snapshot.taskSources.allowedFacts=[facts];
    else if(field==='clarificationAnswers')snapshot.taskSources.clarificationAnswers=[{issueCode:'missing_required_reference',answer:facts}];
    else snapshot.taskSources[field]=facts;
    const session=nativeV2Session(snapshot);
    const sources=JSON.parse((session.input[1] as any).content[0].text).sourceMaterial;
    expect(sources).toEqual(snapshot.taskSources);expect(JSON.stringify(sources)).toContain('001234567');
    expect(session.instructions).toContain(NATIVE_SUPPLIED_INFORMATION_V1);
    expect(session.backendInstructions).toContain(NATIVE_SUPPLIED_INFORMATION_V1);
    expect(session.tools!.map((t:any)=>t.name)).toEqual(['end_call','stop_and_discard']);
  }finally{await h.service.close();}
});
