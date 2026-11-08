import { describe, expect, it } from "vitest";
import { defaultPreparationRuntimePolicy, normalizeCreateCallBriefInput, callCompilationSchema, createApprovedExecutionSnapshot } from "@callassist/contracts";
import { DeterministicBriefCompiler } from "./brief-compiler";
import { createCompilationSnapshotHash } from "./compilation-integrity";

const raw=normalizeCreateCallBriefInput({recipientName:"Office",phoneNumber:"+41710000001",objective:"Ask whether the application was received.",
  representedPersonFirstName:"Nina",representedPersonLastName:"Keller",assistantProfileId:"anna",assistanceReason:"none",locale:"en-GB",
  audioRetentionDays:7,allowedFacts:["Reference: AB-123"],context:"Original conditional detail: disclose the reference only if asked.",allowLanguageSwitch:false});
describe("native preparation and historical policy",()=>{
  it("pins all original task sources and the selected opening in approval v4",async()=>{
    const compiler=new DeterministicBriefCompiler(),compilation=await compiler.compile(raw);
    expect(compilation).toMatchObject({compilerVersion:"brief-compiler-10",compiledBrief:{schemaVersion:"8",contextAppendix:[]}});
    compilation.approvedAt=new Date().toISOString();
    const brief={...raw,id:"11111111-1111-4111-8111-111111111111",status:"ready" as const,createdAt:compilation.approvedAt,updatedAt:compilation.approvedAt};
    const approved=createApprovedExecutionSnapshot({brief,compilation});
    expect(approved).toMatchObject({version:7,taskSources:{objective:raw.objective,context:raw.context,allowedFacts:raw.allowedFacts},
      nativeOpening:{assistanceReason:"none",readinessQuestion:"Is now a good time to talk?"}});
    expect(compilation.snapshotHash).toBe(createCompilationSnapshotHash(compilation));
  });
  it("retries a pinned old policy with its historical context limits and schema, without silently upgrading it",async()=>{
    const compilation=await new DeterministicBriefCompiler().compile(raw,1,{
      policy:{...defaultPreparationRuntimePolicy,promptVersion:"preparation-2026-10-05"}});
    expect(compilation).toMatchObject({compilerVersion:"brief-compiler-6",compiledBrief:{schemaVersion:"4"}});
    expect(compilation.compiledBrief).not.toHaveProperty("contextAppendix");
    // Persisted historical sources can exceed today's creation limits; their
    // compiled background is independently bounded, as it was on production.
    compilation.rawBrief.context="x".repeat(12000);
    compilation.snapshotHash=createCompilationSnapshotHash(compilation);
    expect(callCompilationSchema.parse(compilation)).toEqual(compilation);
    expect(createCompilationSnapshotHash(compilation)).toBe(compilation.snapshotHash);
  });
});
