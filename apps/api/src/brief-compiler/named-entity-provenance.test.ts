import { describe, expect, it, vi } from "vitest";
import { callCompilationSchema, createPlanOnlyExecutionPlan, defaultPreparationRuntimePolicy, normalizeCreateCallBriefInput,
  taskOnlyCompiledCallBriefSchema, type NormalizedCallBriefInput } from "@callassist/contracts";
import { DeterministicBriefCompiler, evaluateCompiledBrief, OpenAIBriefCompiler, protectedIdentifiers, protectedPostalAddresses } from "./brief-compiler";
import { PLAN_ONLY_POLICY } from "./native-appointment-compilation";
import { namedEntityFindings } from "./named-entity-provenance";
import { hasValidCompilationSnapshotHash } from "./compilation-integrity";
import { planReviewFields } from "../text-processing/plan-review-fields";
import { inlineTaskModelOutput } from "../test-helpers/inline-task-model-output";

const policy = {...defaultPreparationRuntimePolicy, promptVersion: PLAN_ONLY_POLICY} as const;
const raw = normalizeCreateCallBriefInput({recipientName:"Example Office", representedPersonFirstName:"Nina", representedPersonLastName:"Keller",
  phoneNumber:"+41710000001",assistantProfileId:"anna",locale:"de-CH",objective:"Узнай часы работы пункта в Винтертуре. Ничего не бронируй."});
const exact = {identifiers:protectedIdentifiers,addresses:protectedPostalAddresses};
async function fixture(input: NormalizedCallBriefInput = raw) {
  const c = await new DeterministicBriefCompiler().compile(input, 1, {policy});
  const plan = taskOnlyCompiledCallBriefSchema.parse(c.compiledBrief);
  plan.localizedObjective = "Die Öffnungszeiten der Abholstelle in Winterthur erfragen. Keine Buchung vornehmen.";
  plan.opening.purposeStatement = "Ich möchte die Öffnungszeiten der Abholstelle erfragen.";
  plan.orderedQuestions = [{text:"Wann ist die Abholstelle in Winterthur geöffnet?",purpose:"Öffnungszeiten erfahren.",required:true}];
  plan.successCriteria = ["Die Öffnungszeiten sind geklärt."];
  plan.prohibitedActions = ["Keine Buchung vornehmen."];
  plan.taskEvidence = [{path:"successCriteria.0",sources:[{path:"objective",quote:input.objective}]},
    {path:"prohibitedActions.0",sources:[{path:"objective",quote:input.objective}]}];
  plan.namedEntities = [{type:"organisation",value:input.recipientName,source:{path:"recipientName",quote:input.recipientName}},
    {type:"person",value:input.representedPerson,source:{path:"representedPerson",quote:input.representedPerson}},
    {type:"location",value:"Winterthur",source:{path:"objective",quote:"Винтертуре"}}];
  return plan;
}
const clean = {languageViolations:[],semanticViolations:[]};
function provider(plans: object[], verdicts: unknown[] = [clean]) {
  let generation = 0, audit = 0;
  const bodies: any[] = [];
  const fetchImplementation = vi.fn<typeof fetch>(async (url, init) => {
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    if (String(url).endsWith("moderations")) return Response.json({results:[{flagged:false}]});
    if (body.text.format.name === "execution_fidelity_audit") return Response.json({output_text:JSON.stringify(verdicts[Math.min(audit++,verdicts.length-1)])});
    return Response.json({output_text:JSON.stringify({...inlineTaskModelOutput(plans[Math.min(generation++,plans.length-1)]!),
      nativeAppointmentInterpretation:{intent:"none",authorityEvidence:null,authorization:null}})});
  });
  return {fetchImplementation,bodies,count:()=>({generation,audit})};
}

describe("sourced entity localization", () => {
  it.each([
    ["в Винтертуре", "Винтертуре", "Winterthur"], ["у Відні", "Відні", "Wien"],
    ["in Munich", "Munich", "München"], ["à Genève", "Genève", "Genf"], ["a Colonia", "Colonia", "Köln"]
  ])("allows %s to reach semantic review using an exact source", async (context, quote, value) => {
    const input={...raw,context},plan=await fixture(input);
    plan.namedEntities[2]={type:"location",value,source:{path:"context",quote}};
    expect(namedEntityFindings(input,plan,exact)).toEqual([]);
    expect(evaluateCompiledBrief(input,plan).status).toBe("ready_for_review");
  });

  it("uses one existing audit, preserves provenance in storage/hash and excludes it from execution and review prose", async () => {
    const plan=await fixture(),mock=provider([plan]);
    const result=await new OpenAIBriefCompiler({apiKey:"test",...mock}).compile(raw,1,{policy});
    expect(result.policyDecision.status).toBe("ready_for_review");
    expect(mock.count()).toEqual({generation:1,audit:1});
    expect(mock.fetchImplementation).toHaveBeenCalledTimes(4);
    expect(callCompilationSchema.parse(result)).toEqual(result);
    expect(hasValidCompilationSnapshotHash(result)).toBe(true);
    const changed=structuredClone(result); if(changed.compiledBrief?.schemaVersion!=="10")throw Error("fixture");
    changed.compiledBrief.namedEntities[2]!.source!.quote="Другой город";
    expect(hasValidCompilationSnapshotHash(changed)).toBe(false);
    const generation=mock.bodies[1],audit=mock.bodies[2];
    expect(generation.text.format.schema.properties.namedEntities.items.required).toContain("source");
    expect(generation.input[0].content).not.toContain("location names, and postal addresses character-for-character");
    expect(audit.instructions).toContain("A matching source substring alone is NOT evidence of equivalence");
    expect(audit.instructions).toContain("even when metadata omits that entity");
    const data=JSON.parse(audit.input);
    expect(data.compiledTask.namedEntities[2].source.quote).toBe("Винтертуре");
    expect(data.executionTask).not.toHaveProperty("namedEntities");
    expect(createPlanOnlyExecutionPlan(plan)).not.toHaveProperty("namedEntities");
    expect(planReviewFields(result).some(field=>/namedEntities|validationFindings/.test(field.id))).toBe(false);
  });

  it("repairs a missing source with precise diagnostics rather than changing the city", async () => {
    const good=await fixture(),bad=structuredClone(good);delete bad.namedEntities[2]!.source;
    const mock=provider([bad,good]);
    const result=await new OpenAIBriefCompiler({apiKey:"test",...mock}).compile(raw,1,{policy});
    expect(result.policyDecision.status).toBe("ready_for_review");
    expect(mock.count()).toEqual({generation:2,audit:1});
    expect(result.validationFindings).toContainEqual({attempt:0,stage:"local",path:"namedEntities.2.value",reason:"entity_source_required",value:"Winterthur"});
    expect(mock.bodies[2].input[0].content).toContain("Entity provenance failure at namedEntities.2.value");
    expect(mock.bodies[2].input[0].content).toContain("Do not remove the entity");
    expect(callCompilationSchema.parse(result).validationFindings).toEqual(result.validationFindings);
  });

  it("allows sourced translations of complete party identities to reach the same audit", async () => {
    const input={...raw,recipientName:"Пример Бюро",representedPerson:"Нина Келлер"},plan=await fixture(input);
    plan.namedEntities[0]={type:"organisation",value:"Example Office",source:{path:"recipientName",quote:input.recipientName}};
    plan.namedEntities[1]={type:"person",value:"Nina Keller",source:{path:"representedPerson",quote:input.representedPerson}};
    plan.opening.recipientAddress="Example Office";
    plan.backgroundSummary="";
    expect(evaluateCompiledBrief(input,plan).status).toBe("ready_for_review");
    plan.namedEntities[0]!.source!.quote="Пример";
    expect(evaluateCompiledBrief(input,plan).status).toBe("blocked");
  });

  it.each([
    ["other", "арендованный чемодан", "gemieteter Koffer"],
    ["date", "24 ноября 2026 года", "24. November 2026"],
    ["reference", "AB-123-XY", "AB-123-XY"]
  ] as const)("accepts optional valid provenance for %s without introducing a type-only rejection", async (type,quote,value) => {
    const input={...raw,context:quote},plan=await fixture();
    plan.namedEntities.push({type,value,source:{path:"context",quote}});
    expect(namedEntityFindings(input,plan,exact)).toEqual([]);
    plan.namedEntities.at(-1)!.source!.quote="not supplied";
    expect(namedEntityFindings(input,plan,exact)[0]?.reason).toBe("entity_source_not_observed");
  });

  it.each(["objective", "context", "deliveryInstruction", "allowedFacts.0", "clarificationAnswers.0.answer"])("checks exact source at %s", async path => {
    const input={...raw,context:"Винтертуре",deliveryInstruction:"Винтертуре",allowedFacts:["Винтертуре"],
      clarificationAnswers:[{issueCode:"ambiguous_recipient_or_subject" as const,answer:"Винтертуре"}]};
    const plan=await fixture();plan.namedEntities[2]!.source={path,quote:"Винтертуре"};
    expect(namedEntityFindings(input,plan,exact)).toEqual([]);
    plan.namedEntities[2]!.source!.quote="Выдуманное место";
    expect(namedEntityFindings(input,plan,exact)[0]?.reason).toBe("entity_source_not_observed");
  });

  it.each([
    ["Bahnhofstrasse 10, 8001 Zürich","Bahnhofstrasse 12, 8001 Zürich"],
    ["AB-123-XY","AB-124-XY"], ["MEYRA MC1","MEYRA MC2"],
    ["+41525550123","+41525550124"], ["qa@example.org","qb@example.org"],
    ["18.11.2026","19.11.2026"]
  ])("does not let provenance change exact data: %s", async (quote,value) => {
    const input={...raw,context:quote},plan=await fixture();
    plan.namedEntities[2]={type:"location",value,source:{path:"context",quote}};
    expect(namedEntityFindings(input,plan,exact)[0]?.reason).toBe("entity_protected_value_changed");
  });

  it.each([
    ["Winterthur", "Zürich", "location"], ["Example Office Bern", "Example Office Basel", "organisation"],
    ["Maria Keller", "Maria", "person"]
  ] as const)("blocks semantic substitution %s -> %s through the existing audit",async(quote,value,type)=>{
    const input={...raw,context:quote},plan=await fixture();
    plan.namedEntities[2]={type,value,source:{path:"context",quote}};
    const mock=provider([plan],[{languageViolations:[],semanticViolations:[{path:"namedEntities.2.value",reason:"source_changed"}]}]);
    const result=await new OpenAIBriefCompiler({apiKey:"test",...mock}).compile(input,1,{policy});
    expect(result.policyDecision).toMatchObject({status:"blocked",reasonCodes:["fact_integrity_failure"]});
    expect(mock.count()).toEqual({generation:4,audit:4});
    expect(result.validationFindings).toHaveLength(4);
    expect(result.validationFindings![0]).toMatchObject({stage:"audit",path:"namedEntities.2.value",reason:"source_changed",value,sourcePath:"context",sourceQuote:quote});
  });

  it("does not approve an entity source when the combined audit is malformed",async()=>{
    const mock=provider([await fixture()],[{semanticViolations:[]}]);
    await expect(new OpenAIBriefCompiler({apiKey:"test",...mock}).compile(raw,1,{policy})).rejects.toMatchObject({code:"OPENAI_RESPONSE_INVALID",stage:"language_audit"});
  });

  it("preserves historical source-free plan hashes and still rejects invented labels",async()=>{
    const plan=await fixture();plan.namedEntities=plan.namedEntities.map(({source,...e})=>e);
    plan.namedEntities[2]!.value="Винтертуре";
    expect(namedEntityFindings(raw,plan,exact)).toEqual([]);
    const old=taskOnlyCompiledCallBriefSchema.parse(plan);
    expect(old).toEqual(plan);expect(old.namedEntities[2]).not.toHaveProperty("source");
    old.namedEntities[2]!.value="Made-up place";
    expect(namedEntityFindings(raw,old,exact)[0]?.reason).toBe("entity_source_required");
  });
});
