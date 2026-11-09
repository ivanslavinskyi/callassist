import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { approvedCall, authorization } from "./voice-test-helpers";
import { nativeV2Session, nativeV2Tools } from "./live-task-context";
import { nativeResponsesConfiguration, nativeConfigurationIdentity, NATIVE_TOOL_ARGUMENT_LIMIT } from "./live-native-configuration";
import { nativeAuthority, nativeProposal } from "../test-helpers/native-appointment";
import { nativeAppointmentProposalSchema, type ApprovedExecutionSnapshot } from "@callassist/contracts";
import { assertPinnedLiveRuntime, type RuntimeDescriptor } from "./runtime-descriptor";
import { PARTICIPANT_ROLE_INSTRUCTIONS } from "./participant-roles";

describe("approved native profiles",()=>{
  it.each(([8, 9] as const).flatMap(version =>
    (["general","book","confirm_existing","reschedule","cancel"] as const).map(profile => ({version, profile}))
  ))("assembles only the approved $profile capabilities for snapshot $version",async ({version, profile})=>{
    const h=await approvedCall();try{
      const snapshot=structuredClone(h.snapshot) as unknown as Extract<ApprovedExecutionSnapshot,{version:8|9}>;
      snapshot.version=version;snapshot.plan.appointmentAuthorization=null;
      snapshot.plan.nativeAppointmentAuthorization=profile==="general"?null:{...nativeAuthority,operation:profile,
        existingAppointment:profile==="book"?null:{date:"2099-09-10",startTime:"12:00",reference:null},
        alternatives:["book","reschedule"].includes(profile)?nativeAuthority.alternatives:[]};
      const s=nativeV2Session(snapshot),names=s.tools!.map((t:any)=>t.name);
      expect(s.profile).toBe(profile);expect(names).toEqual(profile==="general"?["end_call","stop_and_discard"]:["end_call","stop_and_discard","prepare_appointment","record_appointment_result"]);
      const closingTool=s.tools!.find((tool:any)=>tool.name==="end_call") as any;
      expect(closingTool.parameters.properties.noActionRequired.type).toEqual(profile==="general"?"null":["object","null"]);
      expect(s.instructions).toContain("Backend tools:");expect(s.instructions).toContain("Do not generate <|SpawnThinking|> when:");
      expect(s.instructions).not.toContain("status_check");expect(s.backendInstructions.includes("status_check")).toBe(profile!=="general");
      expect(s.instructions).toContain(PARTICIPANT_ROLE_INSTRUCTIONS);expect(s.backendInstructions).toContain(PARTICIPANT_ROLE_INSTRUCTIONS);
      expect(s.instructions).toContain('Address the recipient directly as "you"');
      // Spoken Live owns the farewell; only the backend extracts evidence.
      expect(s.instructions).not.toMatch(/with its exact spoken quote|latest recipient quote|closingQuote|recipientQuote/);
      expect(s.instructions).toContain("silently and listen");
      expect(s.instructions).toContain("substantive correction or question");
      expect(s.backendInstructions).toContain("you alone extract closingQuote and recipientQuote directly from the observed transcript");
      expect(s.backendInstructions).toContain("After an accepted end_call return no spoken message");
      expect(s.instructions).not.toContain("MAIN task outcome for the represented person by name");
      expect(s.instructions.includes("For an appointment result")).toBe(profile!=="general");
      expect(s.instructions.includes("Discussing a third party does not transfer appointment authority")).toBe(profile!=="general");
      expect(s.backendInstructions.includes("noActionRequired must be null")).toBe(profile==="general");
      expect(s.backendInstructions.includes("never cancel it separately first")).toBe(profile==="reschedule");
      expect(s.backendInstructions.includes("explicit cancellation confirmation")).toBe(profile==="cancel");
      expect(s.opening).toBe((s.input[0] as any).content[0].text);expect((s.input[0] as any).role).toBe("developer");
      expect(JSON.parse((s.input[1] as any).content[0].text).sourceMaterial).toEqual(snapshot.taskSources);
      expect(JSON.parse((s.input[1] as any).content[0].text).approvedTask).toEqual(snapshot.plan);
      expect(nativeResponsesConfiguration(s).max_output_tokens).toBeGreaterThanOrEqual(profile==="general"?2048:4096);
    }finally{await h.service.close();}
  });
  it.each([false,true])("validates the actual end_call JSON schema with appointment authority %s",async hasAppointment=>{
    const app=Fastify({ajv:{customOptions:{coerceTypes:false,removeAdditional:false}}});
    try{
      const tool=nativeV2Tools(false,hasAppointment).find(tool=>tool.name==="end_call")!;
      expect(tool.strict).toBe(true);
      app.post("/end",{schema:{body:tool.parameters}},async()=>({ok:true}));
      const evidence={conditionSourceQuote:"Book only if the total price is at most CHF 100.",recipientQuote:"The price is CHF 150."};
      const payload={reason:"objective_resolved",closingQuote:"No appointment was needed. Thank you, goodbye.",recipientQuote:"The price is CHF 150.",noActionRequired:null};
      const send=(body:unknown)=>app.inject({method:"POST",url:"/end",payload:JSON.stringify(body),headers:{"content-type":"application/json"}});
      expect((await send(payload)).statusCode).toBe(200);
      expect((await send({...payload,noActionRequired:evidence})).statusCode).toBe(hasAppointment?200:400);
      expect((await send({...payload,noActionRequired:{conditionSourceQuote:"short"}})).statusCode).toBe(400);
      const {noActionRequired:_required,...missing}=payload;
      expect((await send(missing)).statusCode).toBe(400);
      expect((await send({...payload,summary:"Unapproved field"})).statusCode).toBe(400);
    }finally{await app.close();}
  });
  it("keeps overlapping participant names and third-party facts separate in both startup and backend data",async()=>{
    const h=await approvedCall();try{
      if(h.snapshot.version!==7&&h.snapshot.version!==8)throw Error("fixture");
      const snapshot=structuredClone(h.snapshot);
      snapshot.runtime.spokenIdentities={version:1,recipient:{original:"Alex",spoken:"Alex"},representedPerson:{original:"Alex Keller",spoken:"Alex Keller"}};
      snapshot.taskSources.objective="Ask Alex what Alex wants for lunch, and what Sam wants. I need both answers.";
      snapshot.taskSources.allowedFacts=["Sam prefers vegetarian food."];
      const session=nativeV2Session(snapshot),data=JSON.parse((session.input[1] as any).content[0].text);
      expect(data.parties).toEqual(snapshot.runtime.spokenIdentities);
      expect(data.sourceMaterial).toEqual(snapshot.taskSources);
      expect(session.backendInstructions).toContain(JSON.stringify(data));
      expect(session.instructions).toContain("including facts about third parties");
      expect(session.instructions).toContain("The author of the source task is not automatically the speaker of incoming call audio");
      expect(session.instructions).toContain("Semantic fidelity never expands the approved execution snapshot's action authority");
      expect(session.instructions).toContain("You choose ordinary replies, pacing and follow-ups without backend permission");
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
