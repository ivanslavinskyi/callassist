import { describe, expect, it } from "vitest";
import { approvedCall, approvedPlanOnlyCall } from "./voice-test-helpers";
import { createApprovedExecutionSnapshot, planOnlyExecutionSnapshotSchema, type CallLocale } from "@callassist/contracts";
import { nativeV2Session } from "./live-task-context";
import { nativeAuthority } from "../test-helpers/native-appointment";
import { createCompilationSnapshotHash } from "../brief-compiler/compilation-integrity";

describe("approved runtime task boundary",()=>{
  it.each(["de-CH","de-DE","fr-CH","it-CH","en-GB","en-US","ru-RU"] satisfies CallLocale[])("excludes every raw source and nested audit quote in %s while retaining approved conditions",async locale=>{
    const h=await approvedPlanOnlyCall(undefined,undefined,locale);
    try{
      const stored=(await h.service.get(h.brief.id))!,compilation=structuredClone(stored.compilation!);
      const raw=compilation.rawBrief;
      raw.objective="СЫРОЙ_ИСХОДНИК_OBJECTIVE";raw.context="СЫРОЙ_ИСХОДНИК_CONTEXT";
      raw.allowedFacts=["СЫРОЙ_ИСХОДНИК_FACT"];raw.deliveryInstruction="СЫРОЙ_ИСХОДНИК_DELIVERY";
      raw.clarificationAnswers=[{issueCode:"missing_required_reference",answer:"СЫРОЙ_ИСХОДНИК_CLARIFICATION"}];
      if(compilation.compiledBrief?.schemaVersion!=="10")throw Error("fixture");
      const compiled=compilation.compiledBrief;
      compiled.nativeAppointmentAuthorization=structuredClone(nativeAuthority);
      compiled.nativeAppointmentAuthorization.limits.maxTotalPrice={amount:100,currency:"CHF"};
      compiled.nativeAppointmentAuthorization.requirements=[{id:"doctor",description:"Only Dr Example",sourceText:"СЫРОЙ_ИСХОДНИК_REQUIREMENT"}];
      compiled.nativeAppointmentAuthorization.alternatives[0]!.requirements=[{id:"access",description:"Accessible room",sourceText:"СЫРОЙ_ИСХОДНИК_ALTERNATIVE"}];
      compiled.contextAppendix=[{id:"reference",title:"Reference",description:"Optional approved details",content:"Approved optional reference"}];
      compilation.snapshotHash=createCompilationSnapshotHash(compilation);
      const snapshot=createApprovedExecutionSnapshot({...stored,compilation});
      expect(snapshot.version).toBe(10);expect(planOnlyExecutionSnapshotSchema.parse(snapshot)).toEqual(snapshot);
      const session=nativeV2Session(snapshot),wire=JSON.stringify(session);
      expect(wire).not.toContain("СЫРОЙ_ИСХОДНИК");expect(wire).not.toContain('"sourceText"');
      expect(wire).not.toContain('"sourceMaterial"');expect(snapshot).not.toHaveProperty("taskSources");
      const data=JSON.parse((session.input[1] as any).content[0].text);
      expect(data.approvedTask.nativeAppointmentAuthorization.requirements).toEqual([{id:"doctor",description:"Only Dr Example"}]);
      expect(data.approvedTask.nativeAppointmentAuthorization.alternatives[0].requirements).toEqual([{id:"access",description:"Accessible room"}]);
      expect(data.approvedTask.nativeAppointmentAuthorization.limits.maxTotalPrice).toEqual({amount:100,currency:"CHF"});
      expect(data.approvedTask.localizedObjective).toBe(compiled.localizedObjective);
      expect(session.backendInstructions).toContain(JSON.stringify(data));
      expect(wire).not.toContain("Approved optional reference");
      expect("contextAppendix" in snapshot&&snapshot.contextAppendix[0]?.content).toBe("Approved optional reference");
      // Original records still exist for preparation audits and post-call assessment.
      expect(compilation.rawBrief.context).toBe("СЫРОЙ_ИСХОДНИК_CONTEXT");
      expect(compiled.nativeAppointmentAuthorization.requirements[0]?.sourceText).toBe("СЫРОЙ_ИСХОДНИК_REQUIREMENT");
      const before=JSON.stringify(session);
      raw.context="Changed after approval";compiled.nativeAppointmentAuthorization.requirements[0]!.sourceText="Changed audit quotation";
      expect(JSON.stringify(nativeV2Session(snapshot))).toBe(before);
      expect(()=>nativeV2Session({...snapshot,taskSources:raw} as any)).toThrow();
      const injected=structuredClone(snapshot) as any;injected.plan.nativeAppointmentAuthorization.requirements[0].sourceText="forbidden";
      expect(()=>nativeV2Session(injected)).toThrow();
    }finally{await h.service.close();}
  });
  it("requires reapproval of historical raw-source snapshots rather than silently dropping task facts",async()=>{
    const h=await approvedCall();try{expect(()=>nativeV2Session(h.snapshot)).toThrow("LIVE_V2_REAPPROVAL_REQUIRED");}
    finally{await h.service.close();}
  });
});
