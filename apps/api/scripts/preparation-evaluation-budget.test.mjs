import {it,expect} from 'vitest';
import {PreparationEvaluationBudget,reconciledEvaluationBound} from './preparation-evaluation-budget.mjs';
it('denies before dispatch, retaining every reservation after errors and on exact exhaustion',()=>{
 const budget=new PreparationEvaluationBudget(2000);
 budget.reserve({model:'omni-moderation-latest'});
 budget.reserve({model:'omni-moderation-latest'});
 expect(()=>budget.reserve({model:'omni-moderation-latest'})).toThrow('EVAL_BUDGET_LIMIT');
 expect(budget.requests).toHaveLength(2);expect(budget.reservedUsdMicros).toBe(2000);
});
it('reconciles only complete matching successful usage and keeps unknown calls reserved',()=>{
 const reservations=[{model:'gpt-5.6',tier:'default',reserveUsdMicros:100_000}];
 const operations=[{statusCode:200,pricedModel:'gpt-5.6',actualServiceTier:'default',usage:{inputTextTokens:1000,outputTextTokens:100}}];
 expect(reconciledEvaluationBound(reservations,operations)).toBe(7000);
 expect(reconciledEvaluationBound(reservations,[])).toBe(100_000);
 expect(reconciledEvaluationBound(reservations,[{...operations[0],pricedModel:'gpt-6-luna'}])).toBe(100_000);
 expect(reconciledEvaluationBound(reservations,[{...operations[0],usage:null}])).toBe(100_000);
 expect(reconciledEvaluationBound(reservations,[{...operations[0],statusCode:null}])).toBe(100_000);
});
it('rejects unknown pricing, invalid limits and underspecified output bounds',()=>{
 expect(()=>new PreparationEvaluationBudget(5_000_001)).toThrow();
 const budget=new PreparationEvaluationBudget();
 expect(()=>budget.reserve({model:'unknown',max_output_tokens:2000})).toThrow('UNPRICED_EVAL_REQUEST');
 expect(()=>budget.reserve({model:'gpt-5.6',service_tier:'auto',max_output_tokens:2000})).toThrow('UNPRICED_EVAL_REQUEST');
 expect(()=>budget.reserve({model:'gpt-5.6'})).toThrow();
 expect(budget.reservedUsdMicros).toBe(0);
});
it('carries completed-case bounds into the next allocation and retains uncertain requests in the total cap',()=>{
 const limit=4_000_000;
 const known=[{model:'gpt-5.6',tier:'default',reserveUsdMicros:100_000}];
 const used=reconciledEvaluationBound(known,[{statusCode:200,pricedModel:'gpt-5.6',actualServiceTier:'default',usage:{inputTextTokens:1000,outputTextTokens:100}}]);
 const unknown=reconciledEvaluationBound([{model:'gpt-5.6',tier:'default',reserveUsdMicros:300_000}],[]);
 const next=new PreparationEvaluationBudget(limit-used-unknown);
 expect(next.limitUsdMicros).toBe(3_693_000);
 next.reserve({model:'gpt-5.6',service_tier:'default',max_output_tokens:20000});
 expect(used+unknown+next.reservedUsdMicros).toBeLessThanOrEqual(limit);
 const priority=reconciledEvaluationBound(known,[{statusCode:200,pricedModel:'gpt-5.6',actualServiceTier:'priority',usage:{inputTextTokens:1000,outputTextTokens:100}}]);
 expect(priority).toBe(14_000);
 expect(reconciledEvaluationBound(known,[{statusCode:200,pricedModel:'gpt-5.6',actualServiceTier:'unknown',usage:{inputTextTokens:1000,outputTextTokens:100}}])).toBe(100_000);
});
