# Call-plan preparation runtime

Source specification for `codex/preparation-performance`, 2026-10-05. This describes
code, not the state or measured capacity of any deployed server. The original
[plan](preparation-performance-and-scaling-plan-2026-10-05.md) remains the design record;
[implementation evidence](preparation-performance-implementation-2026-10-05.md)
records verification. Host configuration and rollout procedures live only in the
ignored `docs/local-operations/` directory.

## Immutable policy and operator controls

`GET/PUT /api/admin/system/preparation` reads or changes the policy. Only a current,
active superadmin can mutate it; origin/session checks, database authorization,
expected revision and an audit record apply; the comment is optional. A conflict returns 409. Reads are
private/no-store. A lost response requires refresh before another save.

The admin System panel selects `gpt-5.6`, `gpt-5.6-terra` or `gpt-6-luna` and
Standard/Fast for **generation**. Audit and review stay on `gpt-5.6:default`.
All supported model/tier combinations can be selected by a superadmin in every
environment, without an evaluation report or admission step. The historical
`approvedProfiles`/report fields and optional evidence endpoint are retained for
compatibility and history only; they never gate selection. Saving makes no paid
provider request. The former `PREPARATION_LOCAL_TESTING` bypass has been removed;
the old environment variable has no effect. Evaluations remain an optional tool,
and switching a profile is not proof of model quality or provider availability.
New preparations use the selected profile; existing ones retain their snapshot.

Recipient integrity is independent of whether the label names a person, practice
or organisation. Raw identity and snapshots retain the original spelling. Speech
comparison accepts complete-token Unicode/case/diacritic normalization and the
existing deterministic Cyrillic transliteration. Inflected Cyrillic forms must be
attested in the user's source. It does not guess translations, abbreviations or
approximate spellings. Postal addresses and protected identifiers retain their
strict checks. Unknown transformations still require repair/review.

## Account phone policy

`registration.swissPhonesOnly` controls registration, unverified phone correction,
verification/resend and account phone changes. The API checks it before provider
IO; PostgreSQL mutation transactions lock current policy before account/challenge
rows and revalidate before persisting changes. Existing verified accounts retain
login and recovery. UI country selection and explanatory/error copy follow this
policy in all seven locales. An old settings client omitting the new field preserves
the current value. Migration 0108 preserves existing behaviour; production rollout
explicitly enables this setting through the audited policy before reopening traffic.

## Preparation snapshots

Each preparation snapshots policy revision, stage models and tiers, prompt/pricing
versions, request/output limits and the absolute deadline. Retries and review use
that snapshot. Old rows have `runtime_policy_source=legacy_unknown`: the migration's
compatibility baseline is **not evidence of their historical model/tier**. New rows
are `pinned`. Ledger request and actual response fields remain authoritative.

The snapshot defaults are 120 seconds including queue, 35 seconds per generation
request, at most 12 provider requests across durable attempts, and 20,000 output
tokens. The process preparation timeout can impose a smaller ceiling. Moderation,
language audit, local validation and user approval remain mandatory. Unsupported
prompt/generator versions must be rejected rather than silently replayed differently.

## Scheduling and isolation

| Role | Durable jobs / services | Default call SQL pool |
|---|---|---:|
| `preparation` | brief compilation; separate review text lanes | 4 |
| `operations` | answer detection timeout, provider call reconciliation, live transcript finalization | 3 |
| `background` | final transcription, recording retention/reconciliation, provider cost reconciliation, other text; exports, notifications, deletion and billing | 6 |
| `all` | legacy combined local/single-worker mode | 6 |

`WORKER_ROLE` selects a role. `PREPARATION_WORKER_SLOTS` defaults to 2 for a prep
process, 1 otherwise; `REVIEW_WORKER_SLOTS` defaults to 1. Both are bounded.
`CALL_REPOSITORY_POOL_MAX` controls that pool only, not every connection in a
process. Prep creates no auth/export/notification/billing dependencies. Background
also budgets auth 5, notifications 3, export 3+1 and billing 1; listeners and other
configured clients must be counted separately. API defaults to a call pool of 6.

The immutable job `work_class` routes review separately from background text.
New role processes never run global call recovery on startup. Operations seed
idempotent reconciliation jobs; a provider state or fenced runtime timeout must
justify a call transition. Legacy `all` retains its old recovery behavior and must
not run alongside role workers.

Claims and capacity changes serialize on one short database transaction. No
transaction is held across provider HTTP. Global defaults: four active preparations,
two reviews, four provider requests, forty queued/running preparations, at most two
waiting and one active preparation per user. The next preparation is chosen by
its user's least recent start, then oldest eligible job. Idempotent replay never
consumes an extra queue place. Reducing capacity affects new claims and lets current
work drain. Full queues return localized 429 with Retry-After and preserve the draft.

Every claim has a fresh owner UUID plus generation/attempt fencing; ownership is
never reused after a capacity deferral. Renew, result publication and terminal job
updates validate ownership and expiry. Role workers use database time for leases.
Lease loss aborts provider IO. Admission deferral consumes no worker retry attempt;
any already issued requests still count against the persisted request budget.
An expired queued preparation is failed and its encrypted input cleared.

Shutdown stops claims, retains the draining heartbeat, waits up to 30 seconds,
aborts remaining requests, and bounds the worker drain at 35 seconds. The process
has a 45-second final shutdown bound. A local abort cannot prove remote billing
stopped; unknown operations retain their permit until expiry and are never called free.

## Shared provider and monetary budgets

`providerRequestsPerMinute` (default 100), `providerTokensPerMinute` (2,000,000) and
`voiceReservePercent` (25) are application allocations. They are **not discovered
provider quotas**: configure them to the project's actual shared limits before
increasing concurrency. Preparations and text workers share one conservative
quota scope across all supported models and both tiers. This safely combines
potentially shared model families, at the cost of sometimes underusing independent
quotas. Usage outside this application is not accounted for by this database.

Admission reserves request count and a conservative UTF-8 byte/output token bound
for a rolling minute. Completed/error/unknown requests do not refund that window.
The voice percentage is excluded from the available preparation allocation.
Voice requests outside the gateway are not forcibly throttled by it; their observed
usage, configured quota and possibly a separate provider project remain necessary.
429, Retry-After and exhausted request/token reset headers create a shared cooldown.
Waiting is scheduled in the durable queue, never a sleeping SQL transaction.

Beta monetary admission reserves at least the full request estimate using the
chosen profile and versioned rates, alongside its existing configured reserve.
Requested tier and actual tier are separate. An actual Standard downgrade uses
Standard prices; missing/unknown usage or tier remains unknown, never zero.
Historic rate cards are immutable. New Fast requests fail closed after the current
promotion validity bound (2026-11-22 UTC) pending a reviewed new rate card.

Pricing references checked 2026-10-05: [Fast mode](https://developers.openai.com/api/docs/guides/fast-mode),
[Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra),
[Luna](https://developers.openai.com/api/docs/models/gpt-6-luna),
[official pricing](https://developers.openai.com/fr-FR/api/docs/pricing).

## Transport and diagnostics

Generation and audit request SSE. Only a completed, validated response reaches
publication; partial output is not shown as a finished plan. The parser handles
fragmentation, comments, UTF-8, EOF, failed/incomplete responses and bounded JSON
fallback. It bounds the total response to 8 MB and each buffered event to 2 MB.
Error and cancelled bodies are released. Reservation, body reading and accounting
are included in the preparation deadline; review also bounds those phases.

There are at most six checkpoint rows per operation: dispatch, headers, first
event, response created, first output, terminal. They contain offsets and bounded
IDs/tier only. No prompt, token delta, authorization header or error body is stored.
Checkpoint persistence is best effort and cannot trigger another paid request;
provider reservation and terminal accounting still fail closed for publication.
Existing transport v1 evidence remains compatible and absent evidence remains null.

The stream reader bounds consecutive JSON formatting whitespace outside quoted
strings to 256 characters, across event/chunk boundaries. Exceeding it cancels the
reader with `OPENAI_STREAM_PADDING`; whitespace and escapes inside strings are
preserved. Initial compilation may use its existing single schema repair with
explicit compact-output feedback. Repeated padding fails; deadlines and request
budgets never reset. Aborted padding retains its provider permit until expiry,
because cancellation does not prove remote work or billing stopped. Diagnostics
add optional numeric output-event/UTF-8-byte counts and first/last-output offsets,
without storing generated text. This is protection against a reproduced runaway
output pattern, not proof of a 30-second end-to-end latency guarantee.

The inspector and call export include checkpoints and requested/actual tier.
`GET /api/admin/system/preparation/runtime` returns fresh role heartbeats, queue
counts/ages and daily stage aggregates. Heartbeats include slots, active jobs,
draining state, RSS, heap, cumulative CPU and event-loop p99. Never sum RSS from
two heartbeats belonging to the same process's prep/review workers.

Detailed diagnostic metadata/checkpoints expire after 30 days; anonymous daily
aggregates after 90. Accounting is not deleted by this retention. Call/account
deletion clears details transactionally; insert guards prevent late metadata from
reappearing. The background role runs serialized hourly maintenance and startup
maintenance. `/health/workers` checks required fresh roles (or legacy all), rejecting
mixed modes; `/health/ready` continues to check API/database availability separately.

## Reproducible verification tools

From `apps/api`:

```text
node --import tsx scripts/test-isolated.ts
node --import tsx scripts/load-preparation.ts --processes=2 --slots=4 --users=10 --duration-seconds=60
node --import tsx scripts/evaluate-preparation.ts --full --repetitions=2
```

The first two create and drop only their own randomly named test database using
`TEST_DATABASE_URL`. They never reset an existing application/developer database.
The load runner uses independent Node processes and mock provider latency. It saves
queue/end-to-end percentiles and runtime samples, never claims real voice capacity.
The normal test suite separately covers concurrent mock calls and preparation.

Evaluation uses 200 synthetic multilingual cases/variants (including a held-out
subset) and writes JSON, SHA-256 and a human-review worksheet. Default execution
is mock: its status disagreements and timings cannot approve model quality.
Live execution additionally requires `ALLOW_BILLABLE_EVAL=true`, explicit
`--live --budget-usd=<approved amount>`, API credentials and an intentionally chosen
profile list. Conservative preflight reservation stops the run before its bound;
failed/unknown requests are not refunded. Reports record corpus/prompt/pricing/code
versions, working-tree state, requests and unknown usage. Human checks cover facts,
constraints, authorization, language, clarification, refusals and injection.

`node scripts/preparation-capacity.mjs <measured-profile.json>` calculates the
tightest memory/CPU/connection envelope with at least 20% memory headroom. It does
not certify a maximum. The acceptance procedure still requires 60-minute steady
load, bursts, fault/restart/drain checks and concurrent representative real calls;
report the highest passed step and working reserve, not CPU count as worker count.

Hedging, parallel audit/moderation and persisted intermediate compilation candidates
remain the explicitly deferred optimizations from the original plan.
