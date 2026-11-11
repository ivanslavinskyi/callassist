import { describe, expect, it, vi } from "vitest";
import { defaultPreparationRuntimePolicy, normalizeCreateCallBriefInput, taskOnlyCompiledCallBriefSchema, createPlanOnlyExecutionPlan } from "@callassist/contracts";
import { DeterministicBriefCompiler, OpenAIBriefCompiler } from "./brief-compiler";
import { PLAN_ONLY_POLICY } from "./native-appointment-compilation";
import { inlineTaskFieldsSchema, projectInlineTaskEvidence } from "./inline-task-evidence";
import { taskEvidenceIssues } from "./task-evidence";
import { inlineTaskModelOutput } from "../test-helpers/inline-task-model-output";
import { hasValidCompilationSnapshotHash } from "./compilation-integrity";

const policy = { ...defaultPreparationRuntimePolicy, promptVersion: PLAN_ONLY_POLICY } as const;
const raw = normalizeCreateCallBriefInput({ recipientName: "Example Office", representedPersonFirstName: "Nina", representedPersonLastName: "Keller",
  phoneNumber: "+41710000001", assistantProfileId: "anna", locale: "en-GB",
  objective: "Ask about opening hours. If closed, ask about another location. Do not book anything." });
const source = { path: "objective", quote: raw.objective };
async function fixture() {
  const compiled = await new DeterministicBriefCompiler().compile(raw, 1, { policy });
  const plan = taskOnlyCompiledCallBriefSchema.parse(compiled.compiledBrief);
  plan.conditionalFollowUps = [{ condition: "If closed.", question: "Is there another location?" }];
  plan.prohibitedActions = ["Do not book anything."];
  plan.taskEvidence.push({ path: "conditionalFollowUps.0.condition", sources: [source] }, { path: "prohibitedActions.0", sources: [source] });
  return inlineTaskModelOutput(plan);
}
function provider(outputs: object[]) {
  const requests: any[] = []; let generation = 0;
  const fetchImplementation = vi.fn<typeof fetch>(async (url, init) => {
    const body = JSON.parse(String(init?.body)); requests.push(body);
    if (String(url).endsWith("moderations")) return Response.json({ results: [{ flagged: false }] });
    if (body.text.format.name === "execution_fidelity_audit") return Response.json({ output_text: JSON.stringify({ languageViolations: [], semanticViolations: [] }) });
    return Response.json({ output_text: JSON.stringify({ ...outputs[Math.min(generation++, outputs.length - 1)],
      nativeAppointmentInterpretation: { intent: "none", authorityEvidence: null, authorization: null } }) });
  });
  return { fetchImplementation, requests };
}

describe("inline task evidence transport", () => {
  it("constructs unique, complete target references locally in the existing four-request flow", async () => {
    const output = await fixture(), mock = provider([output]);
    const result = await new OpenAIBriefCompiler({ apiKey: "test", ...mock }).compile(raw, 1, { policy });
    expect(result.policyDecision.status).toBe("ready_for_review");
    expect(mock.fetchImplementation).toHaveBeenCalledTimes(4);
    const generation = mock.requests[1], schema = generation.text.format.schema;
    expect(schema.properties).not.toHaveProperty("taskEvidence");
    expect(schema.required).not.toContain("taskEvidence");
    expect(schema.properties.successCriteria.items.required).toEqual(["text", "sources"]);
    expect(schema.properties.conditionalFollowUps.items.required).toContain("sources");
    expect(generation.input[0].content).not.toContain("Return taskEvidence as audit-only provenance");
    expect(generation.input[0].content).toContain("do not return a separate taskEvidence list");
    const plan = taskOnlyCompiledCallBriefSchema.parse(result.compiledBrief);
    expect(plan.taskEvidence.map(e => e.path)).toEqual(["successCriteria.0", "prohibitedActions.0", "conditionalFollowUps.0.condition"]);
    expect(taskEvidenceIssues(plan, raw)).toEqual([]);
    expect(JSON.parse(mock.requests[2].input).compiledTask).toEqual(plan);
    expect(hasValidCompilationSnapshotHash(result)).toBe(true);
    expect(plan.prohibitedActions).toEqual(["Do not book anything."]);
    expect(createPlanOnlyExecutionPlan(plan)).not.toHaveProperty("taskEvidence");
    expect(plan.conditionalFollowUps[0]).not.toHaveProperty("sources");
  });

  it("keeps every item and its own sources even for maximum-size lists, without generating or guessing indexes", async () => {
    const output = await fixture();
    for (const [key, count] of [["successCriteria", 10], ["unresolvedCriteria", 10], ["stopConditions", 10], ["prohibitedActions", 12]] as const)
      output[key] = Array.from({ length: count }, (_, i) => ({ text: `${key} item ${i}`, sources: [source] }));
    output.conditionalFollowUps = Array.from({ length: 12 }, (_, i) => ({ condition: `Condition ${i}`, question: `Question ${i}?`, sources: [source] }));
    const projected = projectInlineTaskEvidence(output), plan = taskOnlyCompiledCallBriefSchema.parse(projected);
    expect(plan.taskEvidence).toHaveLength(54);
    expect(new Set(plan.taskEvidence.map(e => e.path)).size).toBe(54);
    expect(taskEvidenceIssues(plan, raw)).toEqual([]);
    expect(plan.conditionalFollowUps[11]).toEqual({ condition: "Condition 11", question: "Question 11?" });
    expect(projectInlineTaskEvidence(output)).toEqual(projected);
    expect(output.successCriteria[0]).toHaveProperty("sources");
  });

  it.each(["missing", "empty", "invented_quote", "wrong_field"])("never manufactures %s evidence and repairs within the existing allowance", async failure => {
    const good = await fixture(), bad: any = structuredClone(good);
    if (failure === "missing") delete bad.successCriteria[0].sources;
    if (failure === "empty") bad.successCriteria[0].sources = [];
    if (failure === "invented_quote") bad.successCriteria[0].sources[0].quote = "not present in the input";
    if (failure === "wrong_field") bad.successCriteria[0].sources[0].path = "context";
    const mock = provider([bad, good]);
    const result = await new OpenAIBriefCompiler({ apiKey: "test", ...mock }).compile(raw, 1, { policy });
    expect(result.policyDecision.status).toBe("ready_for_review");
    expect(mock.fetchImplementation).toHaveBeenCalledTimes(5);
    expect(mock.requests[2].input[0].content).toContain("successCriteria.0.sources");
    expect(mock.requests[2].input[0].content).not.toContain("taskEvidence.0");
  });

  it("rejects persistent incomplete provenance rather than approving or extending the repair budget", async () => {
    const bad = await fixture(); bad.conditionalFollowUps[0]!.sources = [];
    const mock = provider([bad]);
    await expect(new OpenAIBriefCompiler({ apiKey: "test", ...mock }).compile(raw, 1, { policy })).rejects.toMatchObject({
      code: "OPENAI_RESPONSE_INVALID", validationPaths: ["conditionalFollowUps.0.sources"]
    });
    expect(mock.fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it("requires the new item shape instead of silently accepting a missing cross-reference table", async () => {
    const output = await fixture();
    expect(inlineTaskFieldsSchema.safeParse({ ...output, successCriteria: ["Answer obtained."] }).success).toBe(false);
    expect(inlineTaskFieldsSchema.safeParse({ ...output, successCriteria: [] }).success).toBe(false);
    expect(inlineTaskFieldsSchema.safeParse({ ...output, prohibitedActions: [], conditionalFollowUps: [] }).success).toBe(true);
  });
});
