import { preparationRequestReserve, preparationRates } from '../src/config/preparation-pricing.ts';

/** Never releases reservations, including errors/timeouts. The entire run's
 * conservative upper bound must fit before a request can reach the network. */
export class PreparationEvaluationBudget {
  constructor(limitUsdMicros=5_000_000) {
    if (!Number.isSafeInteger(limitUsdMicros) || limitUsdMicros<1 || limitUsdMicros>5_000_000) throw Error('INVALID_EVAL_BUDGET');
    this.limitUsdMicros=limitUsdMicros; this.reservedUsdMicros=0; this.requests=[];
  }
  reserve(body) {
    const moderation=body.model==='omni-moderation-latest';
    const profile={model:body.model,serviceTier:body.service_tier??'default'};
    if(!moderation && (!Object.hasOwn(preparationRates,profile.model) || !['default','fast'].includes(profile.serviceTier))) throw Error('UNPRICED_EVAL_REQUEST');
    // Moderation is free; retain a small contingency for each request anyway.
    const amount=moderation?1000:preparationRequestReserve(profile,Buffer.byteLength(JSON.stringify(body)),body.max_output_tokens);
    if(this.reservedUsdMicros+amount>this.limitUsdMicros) throw Error('EVAL_BUDGET_LIMIT');
    this.reservedUsdMicros+=amount;
    const record={id:this.requests.length+1,model:body.model,tier:profile.serviceTier,reserveUsdMicros:amount};
    this.requests.push(record);return record;
  }
}

export function usageEstimate(usage,model,tier='default') {
  const r=preparationRates[model];
  if(!r||!usage||usage.inputTextTokens===null||usage.outputTextTokens===null)return null;
  const cached=usage.cachedInputTextTokens??0,write=usage.cacheWriteInputTextTokens??0;
  return Math.ceil(((usage.inputTextTokens-cached-write)*r.input+cached*r.cached+write*r.write+usage.outputTextTokens*r.output)*(tier==='fast'?2:1)/1_000_000);
}

/** Only reconcile a completed, sequential run with a matching response for EVERY
 * dispatch. Unknown/interrupted runs keep their entire reservation. Use the most
 * expensive input rate, without cache discounts; this is still an upper bound. */
export function reconciledEvaluationBound(reservations,operations) {
  const full=reservations.reduce((sum,r)=>sum+r.reserveUsdMicros,0);
  const completed=operations.filter(o=>o.statusCode===200 || (o.stage==='control_audit'&&o.usage));
  if(completed.length!==reservations.length)return full;
  let bound=0;
  for(let i=0;i<reservations.length;i++) {
    const r=reservations[i],o=completed[i];
    const model=o.stage?.endsWith('moderation')?'omni-moderation-latest':o.pricedModel;
    if(model!==r.model)return full;
    const u=o.usage,rates=preparationRates[model];
    if(!rates || !u || !Number.isSafeInteger(u.inputTextTokens) || u.inputTextTokens<0 || !Number.isSafeInteger(u.outputTextTokens) || u.outputTextTokens<0 ||
      (o.actualServiceTier && !['default','fast','priority'].includes(o.actualServiceTier))) {bound+=r.reserveUsdMicros;continue;}
    const multiplier=r.tier==='fast'||['fast','priority'].includes(o.actualServiceTier)?2:1;
    const amount=Math.ceil((u.inputTextTokens*rates.write+u.outputTextTokens*rates.output)*multiplier/1_000_000);
    if(amount>r.reserveUsdMicros)return full;
    bound+=amount;
  }
  return bound;
}
