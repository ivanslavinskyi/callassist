import {z} from "zod";
export const preparationIssueCategorySchema=z.enum(["harassment_or_abuse","hate_or_discrimination","threat_or_intimidation","manipulation_or_coercion","identity_misrepresentation","high_stakes_legal","high_stakes_financial","high_stakes_medical","political_persuasion","sexual_content","self_harm","bulk_marketing","unrelated_private_data","prompt_injection","illicit"]);
export const preparationIssueSchema=z.strictObject({version:z.literal(1),
 kind:z.enum(["policy_restriction","unsupported_capability","missing_information","invalid_input","provider_unavailable","capacity_or_budget","plan_validation_failed","pending","cancelled"]),
 code:z.string().regex(/^[a-zA-Z0-9_]{1,100}$/),
 source:z.enum(["input_moderation","output_moderation","model_refusal","product_policy","compiler","transport","capacity"]),
 categories:z.array(preparationIssueCategorySchema).max(15),
 action:z.enum(["edit","clarify","retry","wait","support"]),retryable:z.boolean(),
 affectedFields:z.array(z.enum(["objective","context","allowedFacts","clarificationAnswers","phoneNumber","locale"])).max(6)
});
export type PreparationIssue=z.infer<typeof preparationIssueSchema>;
export function preparationIssue(code:string,source:PreparationIssue["source"]="compiler",categories:PreparationIssue["categories"]=[]):PreparationIssue {
 let kind:PreparationIssue["kind"]="plan_validation_failed",action:PreparationIssue["action"]="retry";
 if(["input_moderation_flagged","model_refusal","prohibited_content"].includes(code)){kind="policy_restriction";action="edit";}
 if(code==="unsupported_task"){kind=categories.length?"policy_restriction":"unsupported_capability";action="edit";}
 if(["required_information_missing","material_ambiguity"].includes(code)){kind="missing_information";action="clarify";}
 if(code==="INVALID_CALL_BRIEF"||code==="LIVE_V2_CONTEXT_TOO_LARGE"||code==="LIVE_CONTEXT_LIMIT_EXCEEDED"){kind="invalid_input";action="edit";}
 if(code==="BRIEF_COMPILER_UNAVAILABLE"){kind="provider_unavailable";action="retry";}
 if(/^(?:PREPARATION_.*(?:FULL|BUSY)|BETA_(?:BUDGET_.*|SPENDING_PAUSED)|RATE_LIMITED)$/.test(code)){kind="capacity_or_budget";action="wait";source="capacity";}
 if(code==="CALL_PREPARATION_TIMEOUT"){kind="pending";action="wait";}
 if(code==="CALL_PREPARATION_CANCELLED"){kind="cancelled";action="retry";}
 // Output moderation describes generated material, not a finding against the user's request.
 if(source==="output_moderation"){kind="plan_validation_failed";action="retry";}
 return {version:1,kind,code,source,categories:[...new Set(categories)],action,retryable:action==="retry",affectedFields:[]};
}
export function legacyPreparationIssue(decision:{reasonCodes:readonly string[];status:string}) {
 if(decision.status==="ready_for_review")return null;
 const code=decision.reasonCodes[0]??"unknown_policy_reason";
 if(code==="unknown_policy_reason")return {...preparationIssue("model_refusal","model_refusal"),code,action:"support" as const};
 return preparationIssue(code,code==="input_moderation_flagged"?"input_moderation":code==="model_refusal"?"model_refusal":["prohibited_content","unsupported_task"].includes(code)?"product_policy":"compiler");
}
export function moderationIssueCategories(categories:unknown):PreparationIssue["categories"] {
 if(!categories||typeof categories!=="object"||Array.isArray(categories))return [];
 const mapped:PreparationIssue["categories"]=[];
 for(const [key,value] of Object.entries(categories))if(value===true){
  const category:PreparationIssue["categories"][number]|undefined=key.startsWith("harassment")?key.includes("threatening")?"threat_or_intimidation":"harassment_or_abuse":key.startsWith("hate")?"hate_or_discrimination":key.startsWith("sexual")?"sexual_content":key.startsWith("self-harm")?"self_harm":key.startsWith("illicit")?"illicit":key.startsWith("violence")?"threat_or_intimidation":undefined;
  if(category)mapped.push(category);
 }
 return [...new Set(mapped)];
}
