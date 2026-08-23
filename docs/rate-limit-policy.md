# Shared rate-limit and abuse-control policy

Status: implemented repository baseline in checkpoint 6F5. PostgreSQL is the
authoritative rate-limit store whenever `STORAGE_DRIVER=postgres`; the bounded
in-memory implementation exists for local tests and single-process development only.

## Invariants

1. Every API instance uses the same PostgreSQL bucket tables and the same independent
   32-byte `RATE_LIMIT_HASH_KEY`. A keyed HMAC-SHA-256 of `scope + identifier` is the
   only identifier written to the bucket store. Raw email, phone, IP, user, recovery,
   token, and session identifiers are never persisted in rate-limit rows or metrics.
2. A decision locks every requested bucket in deterministic order. A grouped user/IP
   or phone/IP decision either increments every bucket or none of them, including when
   concurrent requests arrive through different API instances.
3. Fixed windows are at least one second and at most seven days. A rejection returns a
   positive `Retry-After`; the first request after expiry starts a new window.
4. Bucket cardinality is capped at 100,000 in PostgreSQL and 10,000 in memory. Expired
   rows are removed before capacity is evaluated. Capacity exhaustion denies the
   request instead of accepting unmetered work.
5. Production startup rejects a missing, malformed, or reused `RATE_LIMIT_HASH_KEY`.
   The key must differ from data-encryption and promo-code HMAC keys. Every API
   instance in a deployment must use the same active value.

## Store-outage behavior

| Boundary | Behavior when a decision cannot be obtained |
| --- | --- |
| Registration, verification, login, and explicit recovery actions | Fail closed with `503 RATE_LIMIT_UNAVAILABLE` and `Retry-After: 1` before identity/session mutation or provider work. |
| Eligibility-sensitive recovery phone/SMS check | Return the normal generic recovery-start response but do not send SMS. This preserves non-enumeration while failing closed on the privileged side effect. |
| Public recipient opt-out verification | Fail closed with `503 RATE_LIMIT_UNAVAILABLE` and do not send or check an SMS or change suppression state. |
| Expensive/cost-bearing endpoint | Fail closed with `503 RATE_LIMIT_UNAVAILABLE` before brief creation, provider work, credit mutation, export, deletion, download, or retry. |
| Admin system status | Keep the system view available and report the limiter as `unavailable` with nullable counts. |

Unexpected store errors emit a controlled event name only. Exception messages,
connection strings, identifiers, and request payloads do not enter operational logs.

## Metrics and retention

The store keeps hourly `allowed_count` and `denied_count` totals by controlled scope
for 30 days. It does not store identifier hashes in metrics. `/api/admin/system`
exposes the last 24 hours as total allowed/denied decisions and at most ten top denied
scopes, plus active bucket count, store mode, and whether state is shared. These are
diagnostic aggregates, not per-person behavior analytics.

Expired buckets are ephemeral enforcement state with a maximum seven-day lifetime.
Metrics and expired-bucket cleanup occur during decisions. A deployment should also
schedule a database maintenance cleanup so retention does not depend on traffic.

## Rotation and operations

Rotate `RATE_LIMIT_HASH_KEY` only after waiting through the longest active window or
after clearing both ephemeral rate-limit tables during a controlled maintenance
window. Deploy the new key to all API instances together; mixed keys create separate
budgets and are forbidden. The admin system panel must show `postgres`, `shared`, and
`healthy` before horizontal traffic is enabled.

Application limits complement rather than replace edge/WAF/provider controls. Named
alert routing, infrastructure thresholds, mass-account correlation, and an exercised
store-outage drill remain production rollout work.
