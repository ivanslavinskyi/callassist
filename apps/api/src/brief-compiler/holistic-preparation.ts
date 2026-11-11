import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { CALL_POLICY_VERSION, createPlanOnlyTaskContext, planOnlyContextText, callCompilationSchema, preparationIssue,
  type RawCallBrief, type CallCompilation, type PolicyDecision, type PreparationDiagnosticInput,
  type PreparationRuntimePolicy, type HolisticCompiledCallBrief } from "@callassist/contracts";
import { holisticCandidateSchema, holisticVerdictSchema, holisticVerdictJsonSchema, assembleHolisticCandidate,
  HOLISTIC_GENERATION_INSTRUCTIONS, HOLISTIC_AUDIT_INSTRUCTIONS } from "./holistic-contract";
import { PreparationValidationError, responseJson, validationCode } from "./preparation-validation";
import { createCompilationSnapshotHash } from "./compilation-integrity";
import type { BriefCompilerStage, PreparationRequestMetadata } from "./brief-compiler";

export type HolisticPreparationDependencies = {
  policy:PreparationRuntimePolicy; referenceTime:Date; voiceGender:import("@callassist/contracts").CallVoiceGender;
  request:(body:object,stage:BriefCompilerStage,model:string,repair:PreparationRequestMetadata["repairKind"],attempt:number)=>Promise<unknown>;
  moderate:(compiled:HolisticCompiledCallBrief)=>Promise<{flagged:boolean;categories:import("@callassist/contracts").PreparationIssue["categories"]}>;
  diagnostic:(event:PreparationDiagnosticInput)=>Promise<void>;
};
const recoverable = new Set(["OUTPUT_MISSING","OUTPUT_TYPE_INVALID","OUTPUT_JSON_INVALID","OUTPUT_SCHEMA_INVALID",
  "OUTPUT_INCOMPLETE","OUTPUT_SIZE_LIMIT","REQUEST_SIZE_LIMIT","STREAM_INVALID","STREAM_PADDING","PROVIDER_RESPONSE_INVALID","NATIVE_AUTHORITY_INVALID","AUDIT_OUTPUT_INVALID"]);
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const issueDetail=(error:unknown)=>error instanceof z.ZodError ? error.issues : error instanceof PreparationValidationError ? error.detail : null;

export async function prepareHolistic(raw:RawCallBrief,revision:number,deps:HolisticPreparationDependencies):Promise<CallCompilation> {
  let recoveryUsed=false,candidateAttempt=0,auditAttempt=0;
  let feedback:unknown=null,rejectedCandidate:unknown=null,responseId:string|null=null;
  const diagnostic=async(code:PreparationDiagnosticInput["metadata"]["code"],stage:PreparationDiagnosticInput["metadata"]["stage"],detail?:unknown,candidateHash?:string)=>{
    await deps.diagnostic({id:randomUUID(),metadata:{version:1,code,stage,candidateAttempt,auditAttempt,recoveryUsed,
      policy:deps.policy.promptVersion,policyRevision:deps.policy.revision,compiler:"brief-compiler-17",...(candidateHash?{candidateHash}:{})},detail});
  };
  function compilation(compiledBrief:HolisticCompiledCallBrief|null,policyDecision:PolicyDecision):CallCompilation {
    const snapshot={rawBrief:raw,compiledBrief,policyDecision,compilerModel:deps.policy.generation.model,compilerVersion:"brief-compiler-17" as const,revision};
    return callCompilationSchema.parse({...snapshot,compiledAt:deps.referenceTime.toISOString(),approvedAt:null,
      compilerResponseId:responseId,snapshotHash:createCompilationSnapshotHash(snapshot)});
  }
  const blocked=(code:import("@callassist/contracts").PolicyReasonCode):PolicyDecision=>({policyVersion:CALL_POLICY_VERSION,
    status:"blocked",riskLevel:["model_refusal","prohibited_content"].includes(code)?"high":"low",reasonCodes:[code],clarificationQuestions:[],
    issue:preparationIssue(code,code==="model_refusal"?"model_refusal":"compiler")});
  const clarification=(questions:string[]):PolicyDecision=>({policyVersion:CALL_POLICY_VERSION,status:"needs_clarification",
    riskLevel:"low",reasonCodes:["required_information_missing"],clarificationQuestions:questions,
    issue:preparationIssue("required_information_missing")});
  async function finish(compiled:HolisticCompiledCallBrief,decision:PolicyDecision) {
    const moderation=await deps.moderate(compiled);
    if(moderation.flagged)decision={...blocked("prohibited_content"),policyVersion:CALL_POLICY_VERSION,
      issue:preparationIssue("prohibited_content","output_moderation",moderation.categories)};
    return compilation(compiled,decision);
  }
  const trusted={callLocale:raw.locale,recipientName:raw.recipientName,representedPerson:raw.representedPerson,
    addressingMode:raw.addressingMode,tonePreference:raw.tonePreference,resultHandling:raw.resultHandling,
    voicemailPolicy:raw.voicemailPolicy,assistanceReason:raw.assistanceReason,voiceGender:deps.voiceGender,
    allowLanguageSwitch:raw.allowLanguageSwitch,fallbackLocale:raw.fallbackLocale??null,
    referenceTime:deps.referenceTime.toISOString(),defaultTimeZone:"Europe/Zurich"};
  const sources={objective:raw.objective,context:raw.context,allowedFacts:raw.allowedFacts,
    deliveryInstruction:raw.deliveryInstruction,clarificationAnswers:raw.clarificationAnswers};

  for(candidateAttempt=1;candidateAttempt<=2;candidateAttempt++) {
    let compiled:HolisticCompiledCallBrief;
    const previousCandidate=rejectedCandidate;rejectedCandidate=null;
    try {
      const response=await deps.request({model:deps.policy.generation.model,store:false,max_output_tokens:deps.policy.maxOutputTokens,
        reasoning:{effort:"low"},instructions:HOLISTIC_GENERATION_INSTRUCTIONS,
        input:JSON.stringify({trusted,sources,...(feedback?{correction:{rejectedCandidate:previousCandidate,currentFinding:feedback}}:{})}),
        text:{verbosity:"low",format:{type:"json_schema",name:"callassist_holistic_candidate",strict:true,
          schema:z.toJSONSchema(holisticCandidateSchema)}}},candidateAttempt===1?"compilation":"compilation_repair",
        deps.policy.generation.model,candidateAttempt===1?"none":"integrity",candidateAttempt-1);
      responseId=response&&typeof response==="object"&&"id" in response&&typeof response.id==="string"?response.id:null;
      // Keep the actual rejected output, not a path into an earlier candidate.
      const output=responseJson(response,"compilation"); rejectedCandidate=output;
      const parsed=holisticCandidateSchema.parse(output);
      try {compiled=assembleHolisticCandidate(parsed,raw,deps.referenceTime);}
      catch(error){throw new PreparationValidationError("NATIVE_AUTHORITY_INVALID","candidate_validation",issueDetail(error)??(error instanceof Error?{reason:error.message}:null));}
      if(Buffer.byteLength(planOnlyContextText(createPlanOnlyTaskContext(compiled,raw,deps.voiceGender)),"utf8")>120_000)
        throw new PreparationValidationError("REQUEST_SIZE_LIMIT","candidate_validation",{reason:"Compact the primary plan, retaining mandatory constraints; optional detail may use the appendix."});
      if((compiled.nativeAppointmentAuthorization&&compiled.taskType!=="appointment_coordination")||
        (!compiled.nativeAppointmentAuthorization&&compiled.taskType==="appointment_coordination"&&compiled.blockingIssues.length===0))
        throw new PreparationValidationError("NATIVE_AUTHORITY_INVALID","candidate_validation",{reason:"Operation and task type must agree; missing indispensable authority requires clarification"});
    } catch(error) {
      const code=validationCode(error);
      await diagnostic(code,"candidate_validation",{issues:issueDetail(error),rejectedCandidate});
      if(code==="MODEL_REFUSAL")return compilation(null,blocked("model_refusal"));
      if(!recoverable.has(code)||recoveryUsed)throw error instanceof PreparationValidationError?error:
        recoverable.has(code)?new PreparationValidationError(code,"candidate_validation",issueDetail(error)):error;
      recoveryUsed=true;feedback={code,issues:issueDetail(error),instruction:"Return one complete compact candidate preserving the original task and every required property."};
      continue;
    }
    const execution=createPlanOnlyTaskContext(compiled,raw,deps.voiceGender);
    const candidateHash=hash(execution);
    await diagnostic("CANDIDATE_VALID","candidate_validation",{candidate:rejectedCandidate,execution},candidateHash);
    let repeatCandidate=false,auditFeedback:unknown=null;
    while(auditAttempt<2) {
      auditAttempt++;
      let verdict:z.infer<typeof holisticVerdictSchema>;
      try {
        const response=await deps.request({model:deps.policy.audit.model,store:false,max_output_tokens:2048,reasoning:{effort:"low"},
          instructions:HOLISTIC_AUDIT_INSTRUCTIONS,input:JSON.stringify({trusted,sources,execution,sourceLanguage:compiled.sourceLanguage,
            proposedBlockingQuestions:compiled.blockingIssues,taskPolicy:{taskType:compiled.taskType,riskCategories:compiled.riskCategories},
            ...(auditFeedback?{responseFormatCorrection:auditFeedback}:{})}),
          text:{verbosity:"low",format:{type:"json_schema",name:"callassist_holistic_review",strict:true,schema:holisticVerdictJsonSchema}}},
          "language_audit",deps.policy.audit.model,recoveryUsed?"integrity":"none",recoveryUsed?1:0);
        try{verdict=holisticVerdictSchema.parse(responseJson(response,"language_audit"));}
        catch(error){if(error instanceof PreparationValidationError)throw error;throw new PreparationValidationError("AUDIT_OUTPUT_INVALID","language_audit",issueDetail(error));}
      } catch(error) {
        const code=validationCode(error);
        await diagnostic(code,"language_audit",{issues:issueDetail(error)},candidateHash);
        if(code==="MODEL_REFUSAL")return finish(compiled,blocked("model_refusal"));
        if(!recoverable.has(code)||recoveryUsed)throw error instanceof PreparationValidationError?error:
          recoverable.has(code)?new PreparationValidationError(code,"language_audit",issueDetail(error)):error;
        recoveryUsed=true;auditFeedback={code,instruction:"Return exactly the verdict/message JSON schema. Review the unchanged execution context."};
        continue;
      }
      await diagnostic(verdict.verdict==="accept"?"AUDIT_ACCEPT":verdict.verdict==="revise"?"AUDIT_REVISE":"AUDIT_CLARIFY",
        "language_audit",{verdict},candidateHash);
      if(verdict.verdict==="revise") {
        if(recoveryUsed){await diagnostic("RECOVERY_EXHAUSTED","outcome",{verdict},candidateHash);return finish(compiled,blocked("fact_integrity_failure"));}
        recoveryUsed=true;feedback=verdict.message;repeatCandidate=true;break;
      }
      const decision:PolicyDecision=verdict.verdict==="clarify"?clarification([verdict.message]):
        compiled.taskType==="unsupported"?blocked("unsupported_task"):
        compiled.riskCategories.length?blocked("prohibited_content"):
        compiled.blockingIssues.length?clarification(compiled.blockingIssues.map(b=>b.question)):
        {policyVersion:CALL_POLICY_VERSION,status:"ready_for_review",riskLevel:"low",reasonCodes:[],clarificationQuestions:[]};
      return finish(compiled,decision);
    }
    if(!repeatCandidate)throw new PreparationValidationError("RECOVERY_EXHAUSTED","language_audit");
  }
  throw new PreparationValidationError("RECOVERY_EXHAUSTED","candidate_validation");
}
