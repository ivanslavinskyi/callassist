import '../src/config/load-env.ts';
import { writeFile } from 'node:fs/promises';
import postgres from 'postgres';
import { PostgresCallRepository } from '../src/storage/postgres-call-repository.ts';
import { parseDataEncryptionKeyring } from '../src/security/encryption.ts';
import { buildAdminCostOverview } from '../src/admin-operations.ts';
import { unavailableOperationalCostPolicy } from '../src/config/operational-cost-policy.ts';
const repository = new PostgresCallRepository(process.env.DATABASE_URL, parseDataEncryptionKeyring(process.env));
const sql = postgres(process.env.DATABASE_URL, { max: 1, connection: { default_transaction_read_only: 'on' } });
try {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const facts = await repository.getAdminOperationsFacts(from, now.toISOString());
  const cost = buildAdminCostOverview(facts, unavailableOperationalCostPolicy);
  const [activity] = await sql`SELECT count(*)::int AS active FROM call_attempts WHERE ended_at IS NULL AND provider_call_id IS NOT NULL AND provider_status IN ('queued','ringing','in-progress')`;
  const [sample] = await sql`SELECT call_brief_id AS id FROM provider_operations WHERE operation_type='realtime_response' ORDER BY started_at DESC LIMIT 1`;
  const callCost = sample ? buildAdminCostOverview(await repository.getAdminOperationsFacts('1970-01-01T00:00:00.000Z', now.toISOString(), sample.id), unavailableOperationalCostPolicy) : null;
  const summary = { at: now.toISOString(), activeCalls: activity.active, openaiMicros: cost.providerUsage.calculatedUsdMicros,
    twilioCallMicros: cost.providerReported.usdMicros, pendingPrices: cost.providerReported.pendingOperations,
    missingUsage: cost.providerUsage.missingUsageOperations, incompleteSessions: cost.providerUsage.incompleteSessions,
    unpriced: cost.providerUsage.unpricedBuckets, realtimeResponses: cost.providerUsage.components.realtime.requests,
    billing: cost.billing.map(({ scope, ...report }) => report) };
  // Evidence can be committed: retain provider scope labels, never account/project identifiers.
  const evidence = JSON.stringify({ summary, cost, callCost }, (key, value) =>
    key === 'scope' && typeof value === 'string' ? '[configured provider scope]' : value, 2);
  await writeFile('../../docs/cost-audit-2026-09-17/implemented-data.json', evidence);
  console.log(JSON.stringify(summary));
} finally { await repository.close(); await sql.end(); }
