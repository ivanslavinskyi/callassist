import { z } from "zod";
import { preparationValidationCodeSchema, type PreparationValidationCode, type PreparationValidationStage } from "@callassist/contracts";

export class PreparationValidationError extends Error {
  constructor(readonly validationCode:PreparationValidationCode,readonly stage:PreparationValidationStage,readonly detail?:unknown) {
    super(validationCode); this.name="PreparationValidationError";
  }
}
/** Only explicit application constants escape; raw provider text stays in private diagnostics. */
export function validationCode(error:unknown, depth=0):PreparationValidationCode {
  if(depth>8)return "PREPARATION_FAILED";
  if(error instanceof PreparationValidationError)return error.validationCode;
  if(error instanceof z.ZodError)return "OUTPUT_SCHEMA_INVALID";
  if(error instanceof SyntaxError)return "OUTPUT_JSON_INVALID";
  if(!error||typeof error!=="object")return "PREPARATION_FAILED";
  const e=error as {name?:unknown;code?:unknown;message?:unknown;validationCode?:unknown;validationPaths?:unknown;cause?:unknown};
  const direct=preparationValidationCodeSchema.safeParse(e.validationCode);
  if(direct.success)return direct.data;
  const codes:Record<string,PreparationValidationCode>={
    OPENAI_STREAM_PADDING:"STREAM_PADDING",OPENAI_BODY_LIMIT:"OUTPUT_SIZE_LIMIT",OPENAI_STREAM_INVALID:"STREAM_INVALID", OPENAI_STREAM_FAILED:"PROVIDER_RESPONSE_INVALID", OPENAI_STREAM_INCOMPLETE:"OUTPUT_INCOMPLETE",OPENAI_REQUEST_FAILED:"PROVIDER_UNAVAILABLE",
    OPENAI_REQUEST_BUDGET_EXHAUSTED:"REQUEST_BUDGET_EXHAUSTED",PREPARATION_REQUEST_LIMIT:"REQUEST_SIZE_LIMIT",
    EXECUTION_FIDELITY_AUDIT_INVALID_PATH:"AUDIT_PATH_INVALID",EXECUTION_FIDELITY_AUDIT_INVALID:"AUDIT_OUTPUT_INVALID",
    EXECUTION_FIDELITY_AUDIT_INCOMPLETE:"OUTPUT_INCOMPLETE",EXECUTION_LANGUAGE_AUDIT_INVALID:"AUDIT_OUTPUT_INVALID",
    TASK_EVIDENCE_INVALID:"TASK_EVIDENCE_INVALID",PREPARATION_DEADLINE_EXCEEDED:"DEADLINE_EXCEEDED",
    CALL_COMPILATION_INTEGRITY_FAILED:"INTEGRITY_FAILED"
  };
  if(e.cause&&e.cause!==error){const nested=validationCode(e.cause,depth+1);if(nested!=="PREPARATION_FAILED")return nested;}
  if(e.name==="TimeoutError")return "PROVIDER_TIMEOUT";
  if(typeof e.code==="string"&&Object.hasOwn(codes,e.code))return codes[e.code]!;
  // Legacy errors placed these fixed codes in message. Never return arbitrary messages.
  if(typeof e.message==="string"&&Object.hasOwn(codes,e.message))return codes[e.message]!;
  if(Array.isArray(e.validationPaths)&&e.validationPaths.includes("nativeAppointmentInterpretation"))return "NATIVE_AUTHORITY_INVALID";
  return e.code==="OPENAI_RESPONSE_INVALID"?"PROVIDER_RESPONSE_INVALID":"PREPARATION_FAILED";
}
export function responseText(response:unknown, stage:PreparationValidationStage):string {
  if(!response||typeof response!=="object")throw new PreparationValidationError("OUTPUT_TYPE_INVALID",stage);
  const p=response as {status?:unknown;output_text?:unknown;output?:unknown};
  if(p.status!==undefined&&p.status!=="completed")throw new PreparationValidationError("OUTPUT_INCOMPLETE",stage,{status:p.status});
  if(Array.isArray(p.output)&&p.output.some(item=>Array.isArray(item?.content)&&item.content.some((c: {type?:unknown})=>c?.type==="refusal")))
    throw new PreparationValidationError("MODEL_REFUSAL",stage);
  const segments=Array.isArray(p.output)?p.output.flatMap(item=>Array.isArray(item?.content)?item.content:[]).filter(item=>item?.type==="output_text"):[];
  if(segments.some(item=>typeof item.text!=="string"))throw new PreparationValidationError("OUTPUT_TYPE_INVALID",stage);
  const text=p.output_text??(segments.length?segments.map(item=>item.text).join(""):undefined);
  if(text===undefined||text==="")throw new PreparationValidationError("OUTPUT_MISSING",stage);
  if(typeof text!=="string")throw new PreparationValidationError("OUTPUT_TYPE_INVALID",stage);
  return text;
}
export function responseJson(response:unknown, stage:PreparationValidationStage):unknown {
  const text=responseText(response,stage);
  try{return JSON.parse(text);}catch{throw new PreparationValidationError("OUTPUT_JSON_INVALID",stage,{text});}
}
