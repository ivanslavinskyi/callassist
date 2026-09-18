# Superadmin notifications

Implemented 2026-09-18. All interface and email boilerplate is English. Source
objectives, model summary labels/text, next steps and criteria retain their original
language. Notification delivery never invokes a model or a translation service.

## Configuration

Apply migration 0077, then restart API and worker. PostgreSQL is required. The
memory development environment shows an explicit unavailable state. Both processes
need the existing email configuration and public site origin. Embedded mode starts
the queue in the API; external mode starts it only in the dedicated worker.

In **Admin > System > Superadmin notifications**, select recipients, categories
and enable email. Only active superadmins with verified email and phone, and no
pending account deletion, are eligible. Only superadmins can read this panel or its
`GET/PUT /api/admin/system/notifications` API. Changes require a reason and matching
revision and are audited. Defaults are disabled; no historical backfill occurs.

Disabling a category or removing a recipient cancels matching unsent messages.
Re-enabling starts with future events. An already submitted email cannot be recalled.
The settings write waits for an in-flight provider request to finish before returning.

## Event and report semantics

Database triggers atomically enqueue with the first SMS confirmation or the first
transition of an attempt's `ended_at`. Registration has a separate completion marker
so phone changes cannot produce another signup. The migration marks existing verified
users as already registered. Queue uniqueness is `(kind, source_id, recipient_user_id)`.
No network request occurs inside the registration or call transaction.

Every ended attempt, including unsuccessful calls, is eligible. The worker waits up
to five minutes from completion for the canonical assessment, then sends the available
report. A failed assessment is distinct from a goal that was not achieved. There is
no second email for late analysis or costs. The protected call inspector remains current.
Registration reports read account details when preparing the email, and retain the
original confirmation time. Call task/recipient details use the immutable compilation.

Costs reuse the existing per-request usage facts and versioned pricing calculator.
Attempt attribution follows the operation, recording or text artifact's transcript
revision. Shared preparation/translation costs appear separately. Other attempts and
account-wide billing totals are excluded. Twilio prices are provider-reported; absent
prices or usage remain unavailable/partial, never a fabricated zero. Known subtotals
are per currency and do not include the separate shared costs.

## Delivery, audit and retention

Workers claim rows with leases and `SKIP LOCKED`. The recipient and rendered message
are encrypted and frozen before delivery. Retries reuse the same payload and provider
idempotency key, respect retry delays, stop after eight attempts and never extend past
20 hours from the first send preparation. Expired leases recover after a restart.
Rejected mail and exhausted/expired attempts appear as failed in the recent log.
The first version deliberately has no manual resend that could create duplicates.

Immediately before dispatch the worker checks settings, current recipient role,
contact verification, deletion requests and source availability again. Settings changes
and dispatch share a database lock boundary. Queued ciphertext is cleared on source
deletion or recipient eligibility/contact changes. Accepted/cancelled messages clear
their bodies immediately; failed bodies expire after seven days. The encrypted column
participates in existing rotation and restore verification. Delivery audits retain IDs,
not message bodies or contact details.

The log's **accepted** state means provider API acceptance, not confirmed inbox
delivery. Provider receipt IDs support investigation. Real mailbox/bounce acceptance
is a separate operational check; automated tests use mock delivery.
