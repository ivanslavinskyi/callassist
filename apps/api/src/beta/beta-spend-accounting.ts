import type postgres from "postgres";
import type { AdminProviderUsageBucket } from "../storage/call-repository";
import { calculateProviderUsageCost, openAIPublicPricingVersion } from "../config/provider-pricing-policy";

export const betaAccountingVersion = `${openAIPublicPricingVersion}:twilio-ch-ancillary-2026-09-15`;
// Media Streams, recording and one month of recording storage, rounded upwards.
// Connectivity has its own provider-reported price. This is an allowance until
// those ancillary line items can be reconciled, not a provider invoice.
const callAncillaryMicrosPerMinute = 10_000;

export type BudgetOperation = {
  id: string; provider: string; operationType: string; stage: string; model: string;
  pricingVersion?: string; outcome: string | null; usage: Record<string, number | null> | null;
  costs: Array<{ component: string; currency: string; amount: number }>;
  separatelyReserved: boolean;
};
export type BudgetReservation = {
  key: string; kind: string; amount: number;
  call: { terminal: boolean; providerStatus: string | null } | null;
  operations: BudgetOperation[];
};
type Amounts = { reportedCostMicros: number; usageCostMicros: number; pendingReserveMicros: number };
const empty = (): Amounts => ({ reportedCostMicros: 0, usageCostMicros: 0, pendingReserveMicros: 0 });

export function isFreeProviderOperation(operation: Pick<BudgetOperation, "provider" | "operationType">) {
  return operation.provider === "openai" && operation.operationType === "brief_moderation";
}

// Price a single immutable usage sample through the same versioned rate cards
// as admin cost reporting. Missing or incomplete usage must not become zero.
export function priceBudgetOperation(operation: BudgetOperation): number | null {
  if (isFreeProviderOperation(operation)) return 0;
  if (!operation.outcome || !operation.usage) return null;
  const u = operation.usage;
  const value = (key: string) => Number(u[key] ?? 0);
  const present = (key: string) => u[key] == null ? 0 : 1;
  const bucket: AdminProviderUsageBucket = {
    provider: operation.provider, operationType: operation.operationType, stage: operation.stage,
    pricingVersion: operation.pricingVersion, model: operation.model, usageRecords: 1, requestCount: value("request_count"),
    inputTextTokens: value("input_text_tokens"), inputTextTokenSamples: present("input_text_tokens"),
    cachedInputTextTokens: value("cached_input_text_tokens"), cachedInputTextTokenSamples: present("cached_input_text_tokens"),
    cacheWriteInputTextTokens: value("cache_write_input_text_tokens"), cacheWriteInputTextTokenSamples: present("cache_write_input_text_tokens"),
    outputTextTokens: value("output_text_tokens"), outputTextTokenSamples: present("output_text_tokens"),
    reasoningOutputTokens: value("reasoning_output_tokens"), reasoningOutputTokenSamples: present("reasoning_output_tokens"),
    inputAudioTokens: value("input_audio_tokens"), inputAudioTokenSamples: present("input_audio_tokens"),
    cachedInputAudioTokens: value("cached_input_audio_tokens"), cachedInputAudioTokenSamples: present("cached_input_audio_tokens"),
    outputAudioTokens: value("output_audio_tokens"), outputAudioTokenSamples: present("output_audio_tokens"),
    totalTokens: value("total_tokens"), totalTokenSamples: present("total_tokens"),
    durationSeconds: value("duration_seconds"), durationSamples: present("duration_seconds"),
    billableSeconds: value("billable_seconds"), billableSamples: present("billable_seconds")
  };
  const priced = calculateProviderUsageCost(bucket);
  if (!priced.matched || priced.calculatedUsdMicros === null || priced.unpricedMetrics.length) return null;
  if (operation.provider === "twilio" && ["answering_detection", "voicemail_tts"].includes(operation.operationType)) return priced.calculatedUsdMicros;
  if (priced.durationUsdMicros !== null) return priced.calculatedUsdMicros;
  // Token totals and all billable input/output modalities must be present.
  const audio = operation.operationType === "realtime_response" && operation.stage !== "live_delegation";
  if (audio && ["input_text_tokens", "output_text_tokens", "input_audio_tokens", "output_audio_tokens"].some(k => !present(k))) return null;
  if (!audio && (!present("output_text_tokens") || (!present("input_text_tokens") && !present("input_audio_tokens")))) return null;
  const accounted = value("input_text_tokens") + value("input_audio_tokens") + value("output_text_tokens") + value("output_audio_tokens");
  if (present("total_tokens") && value("total_tokens") !== accounted) return null;
  if (value("cached_input_text_tokens") + value("cache_write_input_text_tokens") > value("input_text_tokens")) return null;
  return priced.calculatedUsdMicros;
}

export function accountBudgetReservation(reservation: BudgetReservation): Amounts {
  const amounts = empty();
  if (reservation.kind !== "call") {
    const operation = reservation.operations[0];
    const price = operation ? priceBudgetOperation(operation) : null;
    if (price === null) amounts.pendingReserveMicros = reservation.amount;
    else amounts.usageCostMicros = price; // Includes charged invalid responses; never cap at the reservation.
    return amounts;
  }
  const operations = reservation.operations.filter(o => !o.separatelyReserved);
  const legs = operations.filter(o => o.provider === "twilio" && o.operationType === "telephony_leg");
  const sessions = operations.filter(o => o.operationType === "realtime_session");
  let complete = reservation.call?.terminal === true && legs.length > 0;
  let ancillary = 0;
  for (const leg of legs) {
    const connectivity = leg.costs.filter(c => c.component === "connectivity" && c.currency === "USD");
    if (connectivity.length !== 1 || leg.costs.some(c => c.currency !== "USD")) complete = false;
    amounts.reportedCostMicros += connectivity.reduce((sum, c) => sum + c.amount, 0);
    const seconds = leg.usage?.billable_seconds;
    if (seconds == null) complete = false;
    else ancillary += Math.ceil(Number(seconds) / 60) * callAncillaryMicrosPerMinute;
  }
  // Successful session closure follows queued response writes. Missing sessions
  // on a connected call or uncertain transport termination keep the reservation.
  const silentAnswer = operations.some(o => o.operationType === "answering_detection" && o.outcome === "succeeded" && o.stage !== "answer.human");
  if (reservation.call?.providerStatus === "completed" && sessions.length === 0 && !silentAnswer) complete = false;
  if (sessions.some(o => o.outcome !== "succeeded")) complete = false;
  for (const operation of operations) {
    if (legs.includes(operation) || (sessions.includes(operation) && operation.stage !== "live_conversation")) continue;
    const price = priceBudgetOperation(operation);
    if (price === null) complete = false;
    else amounts.usageCostMicros += price;
  }
  const known = amounts.reportedCostMicros + amounts.usageCostMicros;
  amounts.pendingReserveMicros = complete ? ancillary : Math.max(ancillary, reservation.amount - known, 0);
  return amounts;
}

export function summarizeBetaSpend(reservations: BudgetReservation[]) {
  const total = empty();
  let unresolvedReservations = 0;
  for (const reservation of reservations) {
    const amount = accountBudgetReservation(reservation);
    total.reportedCostMicros += amount.reportedCostMicros;
    total.usageCostMicros += amount.usageCostMicros;
    total.pendingReserveMicros += amount.pendingReserveMicros;
    if (amount.pendingReserveMicros > 0) unresolvedReservations++;
  }
  return { ...total, unresolvedReservations, accountingVersion: betaAccountingVersion,
    reservedMicros: total.reportedCostMicros + total.usageCostMicros + total.pendingReserveMicros };
}

// Read a consistent snapshot under the beta admission lock. The original
// reservations and append-only provider ledgers remain intact. Recompute on
// admission/read so late costs are included without a second settlement worker
// or a lock-order inversion against provider completion transactions.
export async function readBetaSpend(tx: postgres.TransactionSql) {
  const rows = await tx<BudgetReservation[]>`
    WITH reservations AS (
      SELECT *,substring(reservation_key from '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$')::uuid AS entity_id
      FROM beta_spend_reservations WHERE created_at>now()-interval '24 hours'
    )
    SELECT b.reservation_key AS key,b.kind,b.amount_micros::double precision AS amount,
      CASE WHEN a.id IS NULL THEN NULL ELSE json_build_object('terminal',
        a.ended_at IS NOT NULL AND a.provider_status IN ('completed','canceled','busy','failed','no-answer'),
        'providerStatus',a.provider_status) END AS call,
      COALESCE((SELECT json_agg(json_build_object(
        'id',o.id,'provider',o.provider,'operationType',o.operation_type,'stage',o.stage,
        'model',COALESCE(r.provider_model,o.requested_model),'outcome',r.outcome,'pricingVersion',u.pricing_version,
        'usage',CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object(
          'request_count',u.request_count,'input_text_tokens',u.input_text_tokens,
          'cached_input_text_tokens',u.cached_input_text_tokens,'cache_write_input_text_tokens',u.cache_write_input_text_tokens,
          'output_text_tokens',u.output_text_tokens,'reasoning_output_tokens',u.reasoning_output_tokens,
          'input_audio_tokens',u.input_audio_tokens,'cached_input_audio_tokens',u.cached_input_audio_tokens,
          'output_audio_tokens',u.output_audio_tokens,'total_tokens',u.total_tokens,
          'duration_seconds',u.duration_seconds,'billable_seconds',u.billable_seconds) END,
        'separatelyReserved',EXISTS(SELECT 1 FROM beta_spend_reservations separate WHERE separate.reservation_key='provider:'||o.id::text),
        'costs',COALESCE((SELECT json_agg(json_build_object('component',c.component,'currency',c.currency,'amount',c.amount_micros::double precision))
          FROM provider_cost_records c WHERE c.operation_id=o.id),'[]'::json)))
        FROM provider_operations o
        LEFT JOIN provider_operation_results r ON r.operation_id=o.id
        LEFT JOIN effective_provider_usage u ON u.operation_id=o.id
        WHERE (b.kind='call' AND o.call_attempt_id=a.id)
          OR (b.kind<>'call' AND b.reservation_key LIKE 'provider:%' AND o.id=b.entity_id)), '[]'::json) AS operations
    FROM reservations b LEFT JOIN call_attempts a ON b.kind='call' AND b.reservation_key LIKE 'call:%' AND a.id=b.entity_id`;
  return summarizeBetaSpend(rows);
}
