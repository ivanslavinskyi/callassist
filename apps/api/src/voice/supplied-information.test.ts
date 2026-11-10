import { it,expect } from "vitest";
import { approvedPlanOnlyCall as approvedCall } from "./voice-test-helpers";
import { nativeV2Session } from "./live-task-context";
import { PLAN_SUPPLIED_INFORMATION } from "./supplied-information";
const facts='Patient: Nina Keller. DOB: 1990-04-03. Contact: +41791234567. Address: Teststrasse 12. Prior visit: no. Insurance: 001234567.';
it.each(['localizedObjective','backgroundSummary','approvedFacts'] as const)('delivers exact approved facts from %s without original material or new tools',async field=>{
  const h=await approvedCall();
  try{
    const snapshot=structuredClone(h.snapshot);
    if(field==='approvedFacts')snapshot.plan.approvedFacts=[facts];else snapshot.plan[field]=facts;
    const session=nativeV2Session(snapshot),data=JSON.parse((session.input[1] as any).content[0].text);
    expect(data.approvedTask).toEqual(snapshot.plan);expect(JSON.stringify(data)).toContain('001234567');
    expect(data).not.toHaveProperty('sourceMaterial');
    expect(session.instructions).toContain(PLAN_SUPPLIED_INFORMATION);
    expect(session.backendInstructions).toContain(PLAN_SUPPLIED_INFORMATION);
    expect(session.tools!.map((t:any)=>t.name)).toEqual(['end_call','stop_and_discard']);
  }finally{await h.service.close();}
});
