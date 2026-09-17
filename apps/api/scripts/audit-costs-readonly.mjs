// Read-only aggregate audit. Never prints credentials, call contents or phone numbers.
import '../src/config/load-env.ts';
import postgres from 'postgres';
import { writeFile } from 'node:fs/promises';
import { calculateProviderUsageCost } from '../src/config/provider-pricing-policy.ts';
import { buildAdminCostOverview } from '../src/admin-operations.ts';
import { unavailableOperationalCostPolicy } from '../src/config/operational-cost-policy.ts';

const sql = postgres(process.env.DATABASE_URL, {
  max: 1, connect_timeout: 5,
  connection: { default_transaction_read_only: 'on', statement_timeout: 20000 },
});
const report = { generatedAt: new Date().toISOString(), source: 'configured local workspace database' };
const metrics = [
  ['inputTextTokens','inputTextTokenSamples'],['cachedInputTextTokens','cachedInputTextTokenSamples'],
  ['cacheWriteInputTextTokens','cacheWriteInputTextTokenSamples'],['outputTextTokens','outputTextTokenSamples'],
  ['reasoningOutputTokens','reasoningOutputTokenSamples'],['inputAudioTokens','inputAudioTokenSamples'],
  ['cachedInputAudioTokens','cachedInputAudioTokenSamples'],['outputAudioTokens','outputAudioTokenSamples'],
  ['totalTokens','totalTokenSamples'],['durationSeconds','durationSamples'],['billableSeconds','billableSamples']
];
let missingCalls = [];
try {
  await sql.begin('read only', async tx => {
    report.database = await tx`SELECT current_setting('transaction_read_only') AS read_only,
      (SELECT count(*)::int FROM provider_operations) AS operations,
      (SELECT count(*)::int FROM provider_usage_records) AS usage_records,
      (SELECT count(*)::int FROM provider_cost_records) AS cost_records`;
    report.usage = await tx`SELECT o.provider, o.operation_type, o.stage,
      coalesce(r.provider_model,o.requested_model) AS model,
      count(*)::int AS operations, count(r.operation_id)::int AS results,
      count(u.id)::int AS usage_records,
      min(o.started_at) AS first_operation, max(o.started_at) AS last_operation,
      min(u.observed_at) AS first_usage, max(u.observed_at) AS last_usage,
      sum(u.input_text_tokens)::float AS input_text_tokens,
      sum(u.cached_input_text_tokens)::float AS cached_text_tokens,
      sum(u.cache_write_input_text_tokens)::float AS cache_write_tokens,
      sum(u.output_text_tokens)::float AS output_text_tokens,
      sum(u.input_audio_tokens)::float AS input_audio_tokens,
      sum(u.cached_input_audio_tokens)::float AS cached_audio_tokens,
      sum(u.output_audio_tokens)::float AS output_audio_tokens,
      sum(u.total_tokens)::float AS total_tokens,
      sum(u.duration_seconds)::float AS duration_seconds,
      sum(u.billable_seconds)::float AS billable_seconds,
      count(*) FILTER (WHERE r.outcome='succeeded' AND u.id IS NULL)::int AS succeeded_without_usage,
      count(*) FILTER (WHERE u.input_text_tokens IS NOT NULL AND u.cached_input_text_tokens IS NULL)::int AS text_without_cache_details,
      count(*) FILTER (WHERE coalesce(u.cached_input_text_tokens,0)+coalesce(u.cache_write_input_text_tokens,0)>u.input_text_tokens)::int AS invalid_cache_partition
      FROM provider_operations o LEFT JOIN provider_operation_results r ON r.operation_id=o.id
      LEFT JOIN provider_usage_records u ON u.operation_id=o.id
      GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`;
    report.costs = await tx`SELECT c.provider,c.component,c.currency,
      to_char(o.started_at AT TIME ZONE 'UTC','YYYY-MM') AS service_month,
      to_char(c.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS observed_day,
      count(*)::int AS records,sum(c.amount_micros)::float/1000000 AS amount,
      min(o.started_at) AS earliest_service,max(o.started_at) AS latest_service
      FROM provider_cost_records c JOIN provider_operations o ON o.id=c.operation_id
      GROUP BY 1,2,3,4,5 ORDER BY 4,5`;
    report.coverage = await tx`SELECT
      (SELECT min(created_at) FROM call_attempts WHERE provider='twilio') AS first_twilio_attempt,
      (SELECT count(*)::int FROM call_attempts WHERE provider='twilio') AS twilio_attempts,
      (SELECT count(*)::int FROM call_attempts a WHERE provider='twilio' AND NOT EXISTS
        (SELECT 1 FROM provider_operations o WHERE o.call_attempt_id=a.id AND o.operation_type='telephony_leg')) AS untracked_twilio_attempts,
      (SELECT count(*)::int FROM provider_operations o WHERE o.operation_type='telephony_leg' AND NOT EXISTS
        (SELECT 1 FROM provider_cost_records c WHERE c.operation_id=o.id)) AS telephony_without_cost`;
    report.jobs = await tx`SELECT job_type,status,count(*)::int AS count FROM durable_jobs
      WHERE job_type='provider_call_cost_reconciliation' GROUP BY 1,2 ORDER BY 1,2`;
    report.failedCostJobs = await tx`SELECT status,attempt_count,max_attempts,last_error_code,created_at,updated_at
      FROM durable_jobs WHERE job_type='provider_call_cost_reconciliation' AND status<>'succeeded'`;
    report.costJobFailures = await tx`SELECT a.error_code,a.outcome,count(*)::int AS count,min(a.started_at) AS first_attempt,max(a.completed_at) AS last_attempt
      FROM durable_job_attempts a JOIN durable_jobs j ON j.id=a.job_id
      WHERE j.job_type='provider_call_cost_reconciliation' AND j.status='dead_letter'
      GROUP BY 1,2`;
    report.usageByMonth = await tx`SELECT o.provider,o.operation_type,
      to_char(u.observed_at AT TIME ZONE 'UTC','YYYY-MM') AS month,count(*)::int AS count,
      sum(u.total_tokens)::float AS tokens,sum(u.duration_seconds)::float AS seconds
      FROM provider_usage_records u JOIN provider_operations o ON o.id=u.operation_id
      GROUP BY 1,2,3 ORDER BY 3,1,2`;
    report.outcomes = await tx`SELECT o.operation_type,r.outcome,r.http_status,r.error_code,
      count(*)::int AS count FROM provider_operations o
      LEFT JOIN provider_operation_results r ON r.operation_id=o.id
      LEFT JOIN provider_usage_records u ON u.operation_id=o.id
      WHERE u.id IS NULL GROUP BY 1,2,3,4 ORDER BY 1,2`;
    report.telephonyByMonth = await tx`SELECT to_char(o.started_at AT TIME ZONE 'UTC','YYYY-MM') AS service_month,
      count(*)::int AS legs,count(c.id)::int AS cost_records,
      sum(c.amount_micros)::float/1000000 AS amount,
      sum(u.duration_seconds)::float AS duration_seconds,
      count(u.duration_seconds)::int AS duration_samples,
      sum(u.billable_seconds)::float AS billable_seconds,
      count(u.billable_seconds)::int AS billable_samples
      FROM provider_operations o LEFT JOIN provider_usage_records u ON u.operation_id=o.id
      LEFT JOIN provider_cost_records c ON c.operation_id=o.id
      WHERE o.operation_type='telephony_leg' GROUP BY 1 ORDER BY 1`;
    missingCalls = await tx`SELECT a.provider_call_id FROM call_attempts a
      JOIN provider_operations o ON o.call_attempt_id=a.id AND o.operation_type='telephony_leg'
      WHERE NOT EXISTS (SELECT 1 FROM provider_cost_records c WHERE c.operation_id=o.id)`;
    report.legacy = await tx`SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM') AS month,
      count(*)::int AS calls, count(*) FILTER (WHERE created_at<'2026-09-05T12:21:19Z')::int AS before_usage_coverage
      FROM call_briefs GROUP BY 1 ORDER BY 1`;
    const samples=await tx`SELECT o.provider,o.operation_type,o.stage,coalesce(r.provider_model,o.requested_model) AS model,
      u.request_count,u.input_text_tokens,u.cached_input_text_tokens,u.cache_write_input_text_tokens,u.output_text_tokens,
      u.reasoning_output_tokens,u.input_audio_tokens,u.cached_input_audio_tokens,u.output_audio_tokens,u.total_tokens,
      u.duration_seconds::float,u.billable_seconds::float
      FROM provider_usage_records u JOIN provider_operations o ON o.id=u.operation_id
      LEFT JOIN provider_operation_results r ON r.operation_id=o.id`;
    const groups = new Map();
    let perRecord=0;
    for(const sample of samples){
      const key=[sample.provider,sample.operation_type,sample.stage,sample.model].join(':');
      const b=groups.get(key) ?? bucket(sample);
      if(!groups.has(key)) groups.set(key,b);
      b.usageRecords++; b.requestCount+=sample.request_count??0;
      for(const [field,sampleField] of metrics){
        const source=field.replace(/[A-Z]/g, m=>'_'+m.toLowerCase());
        if(sample[source] != null){ b[field]+=Number(sample[source]); b[sampleField]++; }
      }
      const single=bucket(sample);single.usageRecords=1;
      for(const [field,sampleField] of metrics){
        const source=field.replace(/[A-Z]/g, m=>'_'+m.toLowerCase());
        if(sample[source] != null){single[field]=Number(sample[source]);single[sampleField]=1;}
      }
      perRecord+=calculateProviderUsageCost(single).calculatedUsdMicros??0;
    }
    const usage={incurredFrom:'2026-09-01T00:00:00.000Z',incurredTo:report.generatedAt,operationCount:387,usageRecordCount:samples.length,buckets:[...groups.values()]};
    const overview=buildAdminCostOverview({usageSeconds:{telephony:0,realtime:0,transcription:0},providerUsage:usage,providerCosts:{incurredFrom:usage.incurredFrom,incurredTo:usage.incurredTo,recordCount:0,buckets:[]}},unavailableOperationalCostPolicy);
    report.recomputed={usdMicros:overview.providerUsage.calculatedUsdMicros,status:overview.providerUsage.status,unpricedBuckets:overview.providerUsage.unpricedBuckets,perRecordRoundedUsdMicros:perRecord,components:Object.fromEntries(Object.entries(overview.providerUsage.components).map(([k,v])=>[k,{records:v.usageRecords,requests:v.requests,usdMicros:v.calculatedUsdMicros}]))};
    const incomplete=bucket({provider:'openai',operation_type:'brief_compilation',stage:'compilation',model:'gpt-5.6-sol'});
    Object.assign(incomplete,{usageRecords:1,requestCount:1,totalTokens:150,totalTokenSamples:1,outputTextTokens:50,outputTextTokenSamples:1});
    const mixed=bucket({provider:'openai',operation_type:'transcription',stage:'consent_input_audio',model:'gpt-realtime-whisper'});
    Object.assign(mixed,{usageRecords:2,requestCount:2,durationSeconds:60,durationSamples:1});
    report.completenessProbes={missingInputWithKnownTotal:calculateProviderUsageCost(incomplete),oneOfTwoDurationsMissing:calculateProviderUsageCost(mixed)};
  });
  report.openaiAdminKeyConfigured = Boolean(process.env.OPENAI_ADMIN_API_KEY || process.env.OPENAI_ADMIN_KEY || process.env.OPENAI_API_KEY?.startsWith('sk-admin-'));
  if (process.argv.includes('--providers')) {
    const account = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (account && token) {
      const headers = {Authorization: 'Basic '+Buffer.from(account+':'+token).toString('base64')};
      const base = 'https://api.twilio.com/2010-04-01/Accounts/'+encodeURIComponent(account);
      const get = async (url) => {
        const response = await fetch(url,{headers,signal:AbortSignal.timeout(20000)});
        if (!response.ok) return {errorStatus:response.status};
        return response.json();
      };
      try {
        const usage = await get(base+'/Usage/Records.json?StartDate=2026-09-01&EndDate=2026-09-17&PageSize=1000');
        report.twilioSeptember = usage.usage_records?.filter(row=>Number(row.price)!==0 || ['calls-outbound','calls-media-stream-minutes','totalprice'].includes(row.category)).map(row=>({category:row.category,usage:row.usage,usageUnit:row.usage_unit,count:row.count,price:row.price,currency:row.price_unit,startDate:row.start_date,endDate:row.end_date})) ?? usage;
        report.twilioUsageHasNextPage=Boolean(usage.next_page_uri);
        report.missingCallProviderRead = [];
        for (const call of missingCalls) {
          const row = await get(base+'/Calls/'+encodeURIComponent(call.provider_call_id)+'.json');
          report.missingCallProviderRead.push({status:row.status,duration:row.duration,price:row.price,currency:row.price_unit,startTime:row.start_time,endTime:row.end_time,errorStatus:row.errorStatus});
        }
      } catch (error) { report.providerReadError = {code:error.cause?.code ?? error.code ?? error.name}; }
    }
  }
  await writeFile('../../docs/cost-audit-2026-09-17-data.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({database:report.database,failedCostJobs:report.failedCostJobs,costJobFailures:report.costJobFailures,recomputed:report.recomputed,completenessProbes:report.completenessProbes,twilioSeptember:report.twilioSeptember,missingCallProviderRead:report.missingCallProviderRead,providerReadError:report.providerReadError},null,2));
} catch (error) {
  console.error(JSON.stringify({error: error.code ?? error.name, message: 'Read-only aggregate audit could not finish.'}));
  process.exitCode = 1;
} finally { await sql.end({timeout: 3}); }

function bucket(sample){return {provider:sample.provider,operationType:sample.operation_type,stage:sample.stage,model:sample.model,usageRecords:0,requestCount:0,...Object.fromEntries(metrics.flatMap(([v,s])=>[[v,0],[s,0]]))};}
