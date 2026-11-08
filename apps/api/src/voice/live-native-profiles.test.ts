import { describe, expect, it } from "vitest";
import { approvedCall, authorization } from "./voice-test-helpers";
import { nativeV2Session } from "./live-task-context";
import { nativeResponsesConfiguration, nativeConfigurationIdentity, NATIVE_TOOL_ARGUMENT_LIMIT } from "./live-native-configuration";
import { nativeAuthority, nativeProposal } from "../test-helpers/native-appointment";
import { nativeAppointmentProposalSchema, type ApprovedExecutionSnapshot } from "@callassist/contracts";
import { assertPinnedLiveRuntime, type RuntimeDescriptor } from "./runtime-descriptor";

describe("approved native profiles",()=>{
  it.each(["general","book","confirm_existing","reschedule","cancel"] as const)("assembles only the approved %s capabilities",async profile=>{
    const h=await approvedCall();try{
      const snapshot=structuredClone(h.snapshot) as unknown as Extract<ApprovedExecutionSnapshot,{version:8}>;
      snapshot.version=8;snapshot.plan.appointmentAuthorization=null;
      snapshot.plan.nativeAppointmentAuthorization=profile==="general"?null:{...nativeAuthority,operation:profile,
        existingAppointment:profile==="book"?null:{date:"2099-09-10",startTime:"12:00",reference:null},
        alternatives:["book","reschedule"].includes(profile)?nativeAuthority.alternatives:[]};
      const s=nativeV2Session(snapshot),names=s.tools!.map((t:any)=>t.name);
      expect(s.profile).toBe(profile);expect(names).toEqual(profile==="general"?["end_call","stop_and_discard"]:["end_call","stop_and_discard","prepare_appointment","record_appointment_result"]);
      expect(s.instructions).toContain("Backend tools:");expect(s.instructions).toContain("Do not generate <|SpawnThinking|> when:");
      expect(s.instructions).not.toContain("status_check");expect(s.backendInstructions.includes("status_check")).toBe(profile!=="general");
      expect(s.backendInstructions.includes("never cancel it separately first")).toBe(profile==="reschedule");
      expect(s.backendInstructions.includes("explicit cancellation confirmation")).toBe(profile==="cancel");
      expect(s.opening).toBe((s.input[0] as any).content[0].text);expect((s.input[0] as any).role).toBe("developer");
      expect(JSON.parse((s.input[1] as any).content[0].text).sourceMaterial).toEqual(snapshot.taskSources);
      expect(JSON.parse((s.input[1] as any).content[0].text).approvedTask).toEqual(snapshot.plan);
      expect(nativeResponsesConfiguration(s).max_output_tokens).toBeGreaterThanOrEqual(profile==="general"?2048:4096);
    }finally{await h.service.close();}
  });
  it("pins backend, tools, opening and budget identity; does not expose task content",async()=>{
    const h=await approvedCall(authorization);try{
      const s=nativeV2Session(h.snapshot),identity=nativeConfigurationIdentity(s);
      for(const change of [{backendInstructions:s.backendInstructions+" updated"},{tools:[]},{opening:s.opening+" updated"},{backendMaxOutputTokens:8192}]){
        const altered=nativeConfigurationIdentity({...s,...change});expect(altered).not.toEqual(identity);
        const prior={runtime:"live_native_v2",nativeConfiguration:identity} as RuntimeDescriptor;
        expect(()=>assertPinnedLiveRuntime(prior,{...prior,nativeConfiguration:altered})).toThrow("LIVE_RUNTIME_SELECTION_CHANGED");
      }
      expect(JSON.stringify(identity)).not.toMatch(/Nina|Keller|Application/);
    }finally{await h.service.close();}
  });
  it("fits every maximum quote field, including JSON escaping, inside the native transport bound",()=>{
    const quote="\u0000".repeat(2000),proposal={...nativeProposal,termsQuote:quote,selectionEvidence:quote,
      requirements:Array.from({length:24},(_,i)=>({id:`condition_${i}`,recipientQuote:quote})),
      unavailableAlternatives:Array.from({length:7},(_,i)=>({id:`option_${i}`,recipientQuote:quote}))};
    expect(nativeAppointmentProposalSchema.safeParse(proposal).success).toBe(true);
    expect(JSON.stringify({proposal,intent:"status_check"}).length).toBeLessThan(NATIVE_TOOL_ARGUMENT_LIMIT);
  });
});
