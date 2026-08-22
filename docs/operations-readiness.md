# Operations readiness and incident runbooks

This document defines the repository-owned operational contract. It does not claim
that a production monitor, pager, log destination, provider probe, or named human
rotation is configured. Those deployment controls remain release blockers.

## Health contract

The authenticated API listener exposes two unauthenticated, non-cacheable endpoints:

- `GET /health/live` returns `200 {"status":"alive"}` when the process can serve a
  request. It deliberately performs no database or provider operation.
- `GET /health/ready` returns `200` only after a PostgreSQL ping. It returns a bounded
  `503 {"status":"not_ready","checks":{"database":"unavailable"}}` on failure and
  never returns a connection string or exception text.

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
stable event code on an unhandled operation or shutdown failure.

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

Inspect only the controlled job type, attempt count, run-after time and error code.
Determine whether an external side effect may already have occurred. Fix the provider,
configuration, capacity, or database cause first. A superadmin may retry dead-letter
work with a specific incident reason; never bulk retry uncertain provider operations.
Verify the immutable attempt history and final canonical call state.

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
