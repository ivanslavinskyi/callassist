# Operations readiness and incident runbooks

This document defines the repository-owned operational contract. It does not claim
that a production monitor, pager, log destination, provider probe, or named human
rotation is configured. Those deployment controls remain release blockers.

Updated 2026-09-15 for preparation, spending reconciliation and workflow feedback,
including backend checkpoint `4147ded`. B01/B02 are remediated locally with
[current verification and its browser boundary](b01-b02-remediation-2026-09-13.md). Earlier R01-R05/R18/R19 work has
[historical remediation evidence](remediation-2026-09-07.md). The two-stage real-call runner
has async preparation, but its start stage still needs the v2 review-receipt contract
update (R06); current supervised starts use the UI. Dated calls are recorded, but the complete current-commit
provider/outage acceptance remains partial. Review the
[roadmap](mvp-plan.md) for remaining provider, privacy, safety and deployment gates.

## Health contract

Beta controls (0070): apply the migration, restart API/worker, then set a rolling
24-hour USD budget in **Admin System → Beta access and spending**. The default amount
is unset and fails closed. Admission starts at 30 public accounts plus extra one-use
invitations, seven-minute calls, one/account and two globally. Settings are shared
across API/worker. Review the conservative per-operation allocations against actual
provider costs before launch. `beta_budget_threshold_reached` (80%) and
`beta_budget_request_blocked` are aggregate log signals, not delivered alerts.
Route them to the named operator and rehearse exhaustion/pause on staging.
The broader spending switch stops new paid text/ASR/SMS/email and calls; Stop and
cleanup stay available. Unknown provider termination occupies its slot until
reconciliation confirms completion; investigate rather than erasing its attempt.
Detailed admission semantics: [beta controls](beta-controls-2026-09-14.md).
Current spending semantics and migration 0072: [budget accounting](budget-accounting-2026-09-15.md).
Provider charges/calculated usage replace eligible completed-operation reserves;
unknown costs stay pending, and free moderation has no monetary allocation.
The recorded local configuration is revision 3: 20 USD/rolling 24 h,
0.60 USD/call minute (4.20 USD for seven minutes), 0.15 USD/paid text operation.
These local values do not configure the external deployment.

## Call result diagnosis

Use the shared lifecycle shown in History, call detail and Admin Inspector. `completed` is an orchestration state, not proof of a conversation. Provider `no-answer` differs from a connected call ending before consent. Explicit refusal has its own result. A substantive answer requires consent and validated final-transcript evidence. Conversation outcome can be corrected after a refund without reversing it. The canonical AI goal assessment and latest user feedback are independent statistics; existing user/staff classification remains explicitly manual. Do not overwrite stored status or infer who hung up from stream closure. Apply migrations through 0074 before restarting all updated API/workers; see [assessment semantics and verification](post-call-assessment-diagnosis-2026-09-15.md).

## Preparation and call UI diagnosis

Creation, editing and clarification share an eight-minute browser wait across
retries. A persistent panel reports queued/preparing/retrying/delayed progress;
it does not estimate a completion percentage or start a call. After a waiting
deadline, retrying unchanged input checks the same durable operation. Diagnose
provider/worker failures with the preparation ID rather than launching duplicate
requests. Compact generation has a 20,000-token ceiling; the ceiling is not a
target output size. Real-provider mode rejects mock translations for review.
See [preparation incident and timings](plan-preparation-quality-2026-09-15.md).

The call animation separates pending API submission, dialing, connected and
approval states. "Live updates connected" only describes SSE, not the phone leg.
Lost SSE updates stop the animation and show uncertainty; a disconnected browser
does not establish that the call ended. Confirm provider termination before
releasing an occupied slot. A terminal snapshot removes active-call feedback.
[UI verification](workflow-feedback-2026-09-15.md) uses isolated fixtures and is
not a real-provider/outage drill.

## Communication and admin readiness

B03/B04 implementation (2026-09-14): run `corepack pnpm communications:check`
for a configuration-only report with no provider traffic or secret values.
`transactional_email` accepted/failed and `sms_verification_accepted` contain safe
provider IDs for dashboard diagnosis; accepted does not prove delivery. Security
notices have bounded immediate retry but no durable outbox. Provider access,
bounce/outage alert routing and remaining delivery/recovery drills remain release gates.
The user confirmed EN verification email in Gmail and CH SMS from SHPROHLI. These
receipts do not close DE, the redesigned email's client acceptance, UA Telegram routing,
or the complete cross-flow matrix. `deliveryVerified: false` in the configuration-only
CLI always means that the command does not test delivery; it does not override the
user's separately recorded delivery evidence.
See [email/SMS report](email-sms-implementation-2026-09-14.md) for exact limits,
language fallbacks, migration 0069 and remaining configuration.

B02 remediation (2026-09-13): Admin System uses a minimized job projection for
nonempty queues. The outbound-call panel has independent `GET`/`PUT`
`/api/admin/system/outbound-calls` responses containing only `{ outboundCalls }`.
Failure of diagnostics/queue aggregation does not hide the panel or turn a committed
control change into a failed diagnostic response. If the state cannot be confirmed,
the UI offers explicit disable and refresh; only superadmin may resume calls.
The control stops **new** calls, not active conversations. Both HTTP operations still
require the API, authorization and database; the existing `calls:disable` CLI remains
the operator fallback when the web/API path is unavailable.

R21 adds `REALTIME_AGENT_HANGUP_ENABLED` (default false). Apply migration 0062 before
enabling it and restart the API with the new setting. Observe `conversation.hangup`
phase/reason/trigger facts, normal/fallback `conversation.ended`, and the existing
provider reconciliation queue. `schedule_failed` means the short recovery deadline
could not be persisted; the stream still closes and maximum-duration recovery is
the last bound. Investigate repeated fallback/dead-letter jobs. Disable the flag
and restart the API to roll back ordinary-call automation; do not delete recovery
jobs or undo the additive event migration. Detailed checks: [R21 verification](r21-verification-2026-09-08.md).

The main API listener exposes two unauthenticated, non-cacheable endpoints:

- `GET /health/live` returns `200 {"status":"alive"}` when the process can serve a
  request. It deliberately performs no database or provider operation.
- `GET /health/ready` returns `200` only after a PostgreSQL ping. It returns a bounded
  `503 {"status":"not_ready","checks":{"database":"unavailable"}}` on failure and
  never returns a connection string or exception text.

The PostgreSQL check applies to the PostgreSQL runtime; memory-mode development
readiness does not prove a database connection. Neither probe validates provider
availability, external worker execution or completion of the migration catalog.

The Twilio-only listener exposes neither endpoint. A deployment must probe the main
API directly, not make the private Twilio ingress a general application origin.
Recommended routing is a 15-second probe interval, a five-second timeout, and paging
after two consecutive readiness or liveness failures. Liveness failure may restart
the API process. Readiness failure should remove it from request routing without a
restart loop until PostgreSQL availability is understood.

## PII-safe logging policy

Generic runtime logs may contain only event name, timestamp, severity, request ID,
HTTP method, registered route template, status code, controlled error code, and
bounded aggregate counters. The API logger serializes the registered route instead
of the raw URL and replaces arbitrary exception message and stack text.

Generic logs must not contain raw URLs or query strings, headers, cookies, bearer or
stream tokens, OTPs, request/response bodies, phone numbers, email or names, call
brief/objective/facts/transcript text, internal call or recording identifiers,
provider identifiers/payloads, or arbitrary exception bodies. The logger includes
explicit redaction paths as defense in depth. The standalone worker emits only a
stable event code and sanitized error codes on an unhandled operation; shutdown
failures remain bounded. Database deadlocks retain `DATABASE_DEADLOCK` in a bounded
cause chain without SQL/parameters/message/stack. Superseded text jobs retain a
cancelled attempt with `TEXT_ARTIFACT_STALE` instead of a false background failure.

A deployment owner must still configure access control, transport encryption,
destination retention, deletion, and an automated canary that verifies redaction.
No one should copy private call data into an incident ticket or chat channel.

## Snapshot alert policy

`GET /api/admin/system` evaluates policy `2026-08-22`. The result is deterministic,
PII-free and visible only to an authorized administrator. It is a snapshot signal,
not proof that a pager received a notification.

| Code | Trigger | Severity | Runbook |
| --- | --- | --- | --- |
| `external_worker_unavailable` | External topology and worker is stale/offline | Critical | `worker-unavailable` |
| `durable_jobs_dead_letter` | Any dead-letter job | Critical | `durable-job-failure` |
| `durable_job_backlog` | Oldest queued due job >= 300 s / >= 900 s | Warning / Critical | `durable-job-backlog` |
| `retention_overdue` | Any overdue recording deletion | Critical | `retention-overdue` |
| `webhook_processing_failures` | Any failed callback processing in the 24 h snapshot | Warning | `webhook-processing-failure` |
| `recent_technical_errors` | Any durable error event in the 24 h snapshot | Warning | `application-errors` |

Rejected signatures and unmatched callbacks remain visible aggregates but do not
automatically page: they need rate/context and may reflect hostile traffic or a late
duplicate. Provider availability and cost/invoice alerts are not inferred from these
signals; they require reviewed upstream probes and billing data.

## Ownership and common incident flow

Before any invite alpha, assign a named primary and backup for every role below and
record the monitored channel and response hours. A role is not a substitute for a
named person at launch.

| Role | Owns |
| --- | --- |
| On-call operator / incident commander | Acknowledgement, severity, timeline, coordination, resolution decision |
| Superadmin operator | Global outbound-call control and reviewed dead-letter retries |
| Platform owner | API, worker, PostgreSQL, deployment, rollback, provider escalation |
| Privacy owner | Retention incidents, data exposure assessment, legal escalation |
| Safety/support owner | Recipient suppression, complaints, user communication and evidence handoff |

For every incident:

1. Acknowledge it, assign an incident commander, record UTC start time and the stable
   alert/event codes. Do not paste private payloads.
2. Contain risk. Disable new outbound calls when consent, billing, recipient safety,
   provider state, or duplicate side effects are uncertain. Active calls are not
   implicitly ended by the kill switch.
3. Inspect `/admin/system`, the minimized Call Inspector timeline, deployment health,
   and provider status using least privilege. Sensitive-content access requires the
   existing reasoned superadmin boundary.
4. Recover only after identifying idempotency and side-effect risk. Record a reason
   for every kill-switch or dead-letter action.
5. Verify health, worker heartbeat, queue drain, callback processing, retention, and
   connection-backed credit settlement. Monitor for recurrence before resolving.
6. Record impact, decisions, evidence locations, user/provider communication, root
   cause, and follow-up owner/date. Escalate possible personal-data exposure to the
   privacy owner immediately.

## Runbooks

### `worker-unavailable`

Confirm that the API is intentionally configured for `external` mode. Check worker
deployment state and database reachability, then start or restart exactly the intended
worker runtime. Do not start an embedded worker as an improvised second consumer.
Resolve only after a healthy heartbeat appears and oldest due work decreases. Disable
new calls if transcription, provider reconciliation, or retention backlog continues
to grow.

### `durable-job-failure` and `durable-job-backlog`

The seven durable job types are creation/recompilation `brief_compilation`,
`final_transcription`, `recording_retention`, `provider_call_reconciliation`,
`provider_call_cost_reconciliation`, `provider_recording_reconciliation` and
`text_artifact_generation`. Text generation has a separate consumer loop.
Failed preparations erase source input and
cannot use the generic superadmin retry; ask the owner to submit a new preparation.
Account anonymization has a separate leased request/attempt store and recovery action.

Inspect only the controlled job type, attempt count, run-after time and error code.
Determine whether an external side effect may already have occurred. Fix the provider,
configuration, capacity, or database cause first. A superadmin may retry dead-letter
work with a specific incident reason; never bulk retry uncertain provider operations.
Verify the immutable attempt history and final canonical call state.

### Result generation failure

Inspect the artifact and its durable job together: source revision/hash, kind,
status, generation, attempt count, provider-request count, run-after and controlled
failure code. `queued` during backoff is not terminal failure. `processing` is an
active lease; source replacement or deletion may make an artifact stale/cancelled.

The owner text-artifact retry route is bounded to three generations total and 24
provider requests across them, with three automatic attempts per generation. Retry
only when `retryable` is true and the current source/direction still permits it.
Timeout, 429 and provider 5xx are distinct from permanent request rejection. Provider
`Retry-After` is scheduled, capped at 15 minutes; summary timeout defaults to 90 seconds
and review/translation to 45 seconds. Completed chunks and request accounting survive
retry. A failed optional compacting pass can still produce a ready detailed result.

Keep the original transcript available. Do not reset counters or rewrite hashes to
make the button available. The [2026-09-11 local repair](call-result-live-fixes-2026-09-11.md)
was a specifically authorized correction of a budget bug, not the general retry
procedure. Provider resend of real call content is a separate operation from
inspecting these minimized diagnostics.

### Live transcript stops following

First distinguish a stopped event stream from a paused follower. Manual scrolling
pauses following; the resume button or returning to the bottom restores it. Check
for new finalized segments, reconnect state and canonical snapshot freshness.
Cancellation/ASR failure should emit `transcript.discarded` for the affected partial;
one speaker's final must not erase another part. An older HTTP response must not
remove an SSE final. A Realtime model disconnect ends the call; SSE recovery cannot
resume that voice session.

Use `node apps/web/scripts/serve-transcript-following-check.mjs` and its local fixture
to reproduce streaming, reflow, hide/reveal and manual reading without dialling.
Record viewport, interaction and controlled events, keeping private speech out of
shared logs. The fixture exercises the production follower, not provider delivery.

### `retention-overdue`

Treat any overdue deletion as privacy-critical. Stop new calls if the cause can create
additional overdue recordings. Confirm worker and provider deletion capability, then
let the fenced retention job run or perform a reviewed reasoned retry. The privacy
owner records affected retention classes and determines notification/escalation duties.
Resolve only after the overdue count is zero and provider-side deletion is verified.

### `webhook-processing-failure`

Check the isolated ingress process, public route/TLS, Twilio request validation and
controlled problem code. Compare canonical provider state through reconciliation;
do not replay raw payloads from logs. Invalid signatures are a security signal and
must never be bypassed. Pause new calls when callbacks or reconciliation cannot
establish connection/recording state safely.

### `application-errors`

Correlate the stable event code, deployment version, route template and bounded
telemetry. Reproduce without production private data. If arbitrary private text is
found in generic logs, restrict log access and retention immediately and involve the
privacy owner before normal debugging continues.

### Provider outage and cost anomaly

Disable new calls when Twilio/OpenAI availability, callback integrity, or price is
uncertain. Existing connection-backed charging rules remain authoritative: busy,
no-answer and other pre-connection terminals refund; only provider-confirmed
connection may charge. Do not infer availability from `configured` admin status or
cost truth from local estimates. Resume only after a superadmin records the evidence
and reason. Production provider and invoice monitors remain to be integrated.

### Rollback

Record the current application, worker and migration versions. Disable new calls,
drain/stop the worker, and deploy the last known compatible application/worker pair.
Database migrations are forward-applied and must not be destructively reversed during
an incident; restore requires a separately tested backup procedure and recovery target.
Run readiness, worker heartbeat, queue and one approved non-billable or supervised
smoke check before resuming calls.

The executable local procedure, provisional invite-alpha RPO/RTO, production recovery
sequence, backup evidence/retention requirements and non-destructive secret-rotation
contract are maintained in `docs/database-recovery-and-secrets.md`. A successful local
drill proves mechanics only; managed point-in-time recovery and an isolated production
restore remain release gates.

### Abuse, complaint and support

For a recipient complaint or opt-out, create the appropriate durable suppression
immediately and preserve the reasoned safety evidence. Suspend an abusive account and
revoke sessions through the existing admin boundary. Support must verify identity
before account/data actions, use minimized admin views first, and never request OTPs,
passwords, recordings or transcripts through ordinary email/chat. Escalate threats,
harassment, disputed consent, or possible data exposure to the safety/privacy owner.

## Deployment acceptance still open

- Connect liveness/readiness to real routing, uptime monitoring and paging.
- Route snapshot alerts to a tested notification channel with deduplication and
  acknowledgement; protect the admin credential used by the collector.
- Add non-billable Twilio/OpenAI probes with budgets and provider status escalation.
- Reconcile local cost estimates against provider invoices and set reviewed budgets.
- Configure protected log transport/retention and execute a PII-redaction canary.
- Assign named primary/backup owners and run worker, provider, retention, rollback,
  abuse/complaint and privacy tabletop drills.
- Configure managed encrypted database backups/PITR, accept recovery targets, and
  preserve a successful isolated production restore record.
- Configure a managed secret store and exercise credential rotation. The repository
  has versioned dual-read/new-write encryption and a verified resumable re-encryption
  command; production still requires named owners, a maintenance window, preserved
  evidence, backup-expiry handling, and an exercised managed-key rotation.

## Security and migration release evidence

Before deployment, preserve the successful CI run for the exact commit and confirm
that it includes the frozen install, production dependency audit, migration catalog
validation, two consecutive migration runs, a disposable recovery drill, lint,
typecheck, tests, populated-database re-encryption proof and builds. Confirm
that branch protection requires the workflow and review. A passing dependency audit
means no finding at or above its configured high-severity threshold; moderate findings
still require triage and a recorded disposition.

Turbo now passes declared environment in strict mode; test results are not cached.
PostgreSQL suites fail without a dedicated test URL or available database. A clean
local snapshot without `.env` passes the full suite; hosted Linux/Node 22 CI evidence
remains a separate release gate. See [remediation](remediation-2026-09-07.md).

The API test runner bounds file concurrency to four workers and allows ten seconds
per test because PostgreSQL migration/integration suites otherwise contend with
Fastify unit suites on high-core hosts. A timeout remains a failure; do not treat an
isolated passing rerun as release evidence in place of a clean complete CI run.

For the immutable call-plan finalization release, run
`pnpm db:verify:call-plan-cutover` against the target database before applying the
finalizing migration. The command is read-only, emits aggregate counts only, and
must return `call_plan_cutover_ready` with an empty `blockers` array. A non-zero
recoverable legacy count, executable call without an immutable plan, active legacy
attempt, or active recompilation is a hard stop. Archived terminal plans, drafts
explicitly awaiting recompilation, unavailable terminal history, and historical
attempts without reconstructable usage/snapshots remain visible evidence but do
not become trusted execution state. See
`docs/approved-call-plan-cost-security-roadmap.md` for the mandatory two-phase
commit and migration order.

Migration tooling independently evaluates the same aggregate blockers immediately
before applying `0061_complete_immutable_call_plan_cutover.sql`. This final
fail-closed guard protects against invoking the full migration command on an
unprepared database; it does not replace the dry runs, recovery evidence, worker
drain, or preserved standalone gate output.

Production API and worker processes must pass fail-closed environment validation.
Use the read-only [deployment preflight](deployment-preflight.md) for the combined
configuration, then verify the actual processes and proxy externally. The first
deployment target is `shprohli.ch` with temporary restricted access, after B07 landing
completion; a separate staging server is not required.
Never bypass a validation issue by changing `NODE_ENV`. Verify TLS termination before
trusting HSTS, keep the main and Twilio listener ports separate, and do not reuse the
data-encryption key as the promo-code HMAC key. If an applied migration checksum
mismatch occurs, stop: restore the committed historical file and create a new forward
migration instead of updating the stored checksum.
