# Shared rate-limit and abuse-control policy

Status: implemented repository baseline in checkpoint 6F5. PostgreSQL is the
authoritative rate-limit store whenever `STORAGE_DRIVER=postgres`; the bounded
in-memory implementation exists for local tests and single-process development only.

Reviewed 2026-09-12 against `ef36cfa`. Email-change start/confirm and account name
editing also use shared limits. Production keys must be independent of the email
verification HMAC key as well as promo/data keys. B06 preparation on 2026-09-14 adds
explicit `TRUSTED_PROXY_CIDRS`: reviewed IPs/CIDRs or `none` for direct ingress.
Development defaults to the direct peer; production requires an explicit choice.
Forwarded headers from an untrusted peer cannot change `request.ip`. The actual edge
must strip incoming spoofed headers and isolate the API port; external acceptance
remains open. See [deployment preflight](deployment-preflight.md).

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
| Registration, verification, login, recovery, and verified-phone change | Fail closed with `503 RATE_LIMIT_UNAVAILABLE` and `Retry-After: 1` before identity/session mutation or provider work. |
| Eligibility-sensitive recovery phone/SMS check | Return the normal generic recovery-start response but do not send SMS. This preserves non-enumeration while failing closed on the privileged side effect. |
| Public recipient opt-out verification | Fail closed with `503 RATE_LIMIT_UNAVAILABLE` and do not send or check an SMS or change suppression state. |
| Expensive/cost-bearing endpoint | Fail closed with `503 RATE_LIMIT_UNAVAILABLE` before brief creation, provider work, credit mutation, export, deletion, download, or retry. |
| Admin system status | Keep the system view available and report the limiter as `unavailable` with nullable counts. |

Unexpected store errors emit a controlled event name only. Exception messages,
connection strings, identifiers, and request payloads do not enter operational logs.

## Expensive endpoint defaults

These values come from `config/endpoint-rate-limit-policy.ts`. Each user budget has
an IP budget five times larger; authenticated preparation replay is resolved before
charging a new preparation budget.

| Action | User limit / window |
| --- | --- |
| Initial preparation and edit/recompile | 15 / hour |
| Start and approve-and-start | 10 / 15 minutes |
| Promo redemption | 10 / hour |
| Recording download | 30 / hour |
| Final transcription retry | 5 / day |
| Plan/clarification review, content-language correction, transcript translation, summary and text-artifact retry | 30 / hour (shared text-generation scope) |
| Account data export | 2 / day |
| Call-data deletion | 5 / day |
| Account deletion request | 3 / day |

The configurable `API_RATE_LIMIT_*` names are in the [runtime reference](runtime-reference.md).
Call admission's rolling-hour/UTC-day quotas and one-active-call invariant are
additional constraints, independent from these fixed-window request budgets.

Migration 0070 adds shared beta admission and conservative monetary reservations:
30 public registrations plus extra one-use invitations, seven-minute maximum calls,
one call/account and two globally by default. Recipient abuse is additionally capped
across accounts at two starts in the last 24 hours; deletion does not reset the
short-lived HMAC counter. The open-registration count is lifetime intake, not current
active accounts. Superadmin edits the caps and USD budget in Admin System. Null budget
or spending pause fails closed before paid provider dispatch. Conservative spend
reservations remain debited for 24 hours even when delivery is uncertain or fails;
they are separate from refundable user credits. See [beta controls](beta-controls-2026-09-14.md).

Text-artifact provider budgets are separate from endpoint rate limits: 24 requests
per artifact across three generations, up to three automatic attempts per generation.
The owner retry button uses the server's `retryable` flag; changing generation or
retrying never resets request accounting. Reading existing artifacts makes no model
request. Automatic enqueue still obeys artifact budgets and capability switches.

## Public opt-out eligibility and limits

Since 0075, request limits apply even without call history: 3 verification starts
per phone and 10 per IP per hour; 8 confirmations per phone and 20 per IP per
15 minutes. Trusted Twilio contact and absence of active suppression are checked
before dispatch to the dedicated opt-out Verify Service, so arbitrary numbers do
not consume SMS or monetary reservations. Eligible sends still use the shared
provider cooldown/hourly/global and beta budgets; these are not separate allowances.

The durable store reserves one challenge per recipient per 60 seconds before sending.
Only successful dispatch activates it. Each challenge expires after ten minutes,
permits eight verification attempts and uses a thirty-second claim lease. A new send
invalidates the old challenge; a consumed token cannot be replayed. Unknown or
ineligible proof cannot reach the provider check. Existing request-limit failures
still return 429, and limiter outages still fail closed. See
[the opt-out contract and rollout](recipient-opt-out.md).

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
