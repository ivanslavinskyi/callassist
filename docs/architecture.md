# CallAssist Architecture

## Purpose

CallAssist is a personal assistant that places outbound calls under a narrowly scoped call brief. During a call, the operator can monitor the transcript, stop the call, and approve or reject sensitive disclosures.

## System overview

```text
Next.js console ── HTTPS / SSE ──► Fastify API ──► PostgreSQL
                                         │              │
                                         │              └── encrypted private fields
                                         │
                              input moderation + Brief Compiler
                                         │
                              OpenAI Structured Outputs
                                         │
                              deterministic Policy Gate
                                         │
                              operator review and approval
                                         │
                                Twilio Programmable Voice
                                         │
                              bidirectional Media Stream
                                         │
                              server-side Realtime bridge
                                         │
                                OpenAI Realtime session

Twilio dual-channel recording ──► authenticated API download
                                             │
                                             └── channel split + voice activity turns
                                                               │
                                                               └── OpenAI post-call transcription
                                                                             │
                                                                             └── encrypted final turns
```

- `apps/web`: the Next.js operator console.
- `apps/api`: the Node.js/TypeScript Fastify API, policy boundary, Twilio gateway, and server-side Realtime connection.
- PostgreSQL: call briefs, attempts, draft transcripts, recordings, final transcripts, approvals, and audit events.
- Identity and tenancy foundation: PostgreSQL users and revocable server-side sessions, scrypt password hashes, explicit first/last names, localized registration/verification/login screens, Twilio Verify phone confirmation, and opaque HttpOnly session cookies. New call briefs store their authenticated owner. Every browser call list/read/write/action/SSE/media route authenticates the session and checks that owner without accepting a browser-supplied user ID; provider webhooks keep their independent signature/provider-ID boundary. Narrow admin/superadmin account-control routes atomically suspend/unsuspend users or revoke their sessions with a mandatory reason and immutable audit event. Suspension also blocks session creation and PostgreSQL call creation/reservation under row locks; unsuspension never restores revoked tokens. Paginated administrator search exposes only name, email, role/status, verification state, and activity dates before a separately authorized ledger read; it excludes phone numbers, password hashes, and session credentials. The selected-user console composes the narrow status, session-revocation, and idempotent credit-grant APIs, requires reasons and destructive confirmations, and mirrors server eligibility rules without replacing them. Ordinary admins can discover only `user` accounts, while superadmins may inspect staff roles. Pre-authentication rows remain hidden pending an explicit archive/backfill decision.
- Usage boundary: an immutable `credit_transactions` ledger grants three credits once after phone verification. Promo plaintext is normalized only in memory and persisted as a keyed HMAC-SHA-256 digest. Campaign creation, redemption, global/per-user limits, and manual administrator grants use UUID idempotency keys; PostgreSQL row/advisory locks atomically pair each unique redemption or documented admin grant with its ledger entry. Promo redemptions are immutable and manual grants retain actor and reason. A per-user PostgreSQL advisory transaction lock, an active-attempt unique index, and an idempotent attempt settlement constraint serialize starts, prevent negative balances, and allow only one outbound call per user. Reservation is the `-1` balance movement; a zero-amount `call_charge` records that the provider confirmed a successful connection, while a `+1 call_refund` reverses busy, unanswered, canceled, and technical failures before connection. The in-memory repository implements the same transitions for local use and contract tests.
- Call-admission boundary: under the same serialized start transaction, the API checks the global `outbound_calls` control, an active normalized recipient suppression, rolling-hour and UTC-day user starts, and same-recipient UTC-day starts before inserting an attempt or reserving credit. Refunded failures still count toward abuse quotas but never become charges. A service timer stops calls at the configured maximum duration. Defaults are 3 starts/hour, 10/day, 2/recipient/day, and 900 seconds; all are positive-integer environment settings.
- Emergency-control boundary: PostgreSQL persists recipient suppression history and an outbound-call singleton control. A public recipient opt-out requires proof of phone control through the SMS verification provider and rate-limits hashed phone/IP buckets before creating a global `recipient_request` suppression without requiring an account. Staff and complaint suppressions plus lifts require an active `admin` or `superadmin`, an allowed origin, and an explicit operational reason. Suppression source, actor where applicable, phone, and reason are captured by immutable `safety_events`. The global switch rejects new reservations without changing calls that are already active.
- Request-abuse boundary: registration and authentication actions plus expensive brief preparation, call start, promo redemption, recording download, and transcription retry endpoints use fixed-window application limits. Expensive endpoint limits are evaluated atomically across hashed user and IP buckets, return `Retry-After`, and cap bucket cardinality to avoid turning the limiter into a memory-exhaustion vector. The current state is process-local and must move to a shared durable store before horizontal API scaling.
- Twilio: outbound PSTN calls, signed webhooks, DTMF consent, a bidirectional Media Stream, and temporary consent-gated recordings. REST Call resource statuses and progress-webhook `CallStatus` values are modeled separately because the callback-only `initiated` value maps to domain `dialing` but is not returned as a REST resource status.
- OpenAI Responses: multilingual brief compilation into a strict JSON schema.
- OpenAI Moderation: checks both raw input and generated runtime text.
- OpenAI Realtime: direct speech-to-speech conversation. External actions remain under server control.
- OpenAI file transcription: post-call processing of the complete recording with bounded call context.
- PostgreSQL durable jobs: transactional enqueue, exclusive expiring leases, worker fencing, bounded retry/dead-letter state, and immutable attempt evidence for final transcription, recording retention, and Twilio call/recording status reconciliation. Local development defaults to an embedded worker; `DURABLE_WORKER_MODE=external` turns the API into an enqueue-only process and moves recovery, seeding, polling, lease renewal, runtime heartbeats, and execution to the dedicated worker entry point.
- Cross-process live state: PostgreSQL `LISTEN/NOTIFY` carries only a versioned invalidation signal containing a random process UUID and application call UUID. It never carries a brief, phone number, transcript, provider identifier, or credential. Receiving API processes re-read the authorized canonical snapshot and emit the existing SSE envelope to their local subscribers.
- Webhook delivery evidence: bounded hourly PostgreSQL aggregates for accepted, rejected, unmatched, and failed Twilio HTTP callbacks. They retain controlled error codes and timestamps for 30 days, never provider/call IDs or payloads, and do not replace signature validation or upstream monitoring.

## Storage boundary

The API depends on a `CallRepository` interface. The in-memory and PostgreSQL repositories implement the same contract, keeping telephony and Realtime independent from storage. SQL migrations are versioned with the API.

Raw briefs, compiled plans, policy decisions, context, and approved facts are encrypted before persistence. Audit events do not include source text, transcript content, or private fact values. Call audit events, account-admin events, safety events, and credit transactions are protected against mutation and deletion at the PostgreSQL layer.

On embedded-runtime startup, or when the dedicated worker starts, pending approvals expire and recovery is recorded in the audit trail. An unfinished Twilio call with a stored provider SID remains active until a due reconciliation job reads the provider state; it is not assigned a synthetic failure or refund merely because the process restarted. Mock calls and attempts without a recoverable provider identity still fail closed. Incomplete provider recordings, available recordings, and due retention work are transactionally seeded or advanced in durable jobs; interrupted leases expire and may be reclaimed without allowing a stale worker to publish domain state. Graceful worker shutdown stops new claims, waits for the active handler, marks its runtime heartbeat stopped, and then closes storage; a restarted worker claims remaining or expired work through the same fencing boundary. A killed worker becomes stale after 15 seconds. Heartbeat rows are bounded to a 30-day operational window and expose counts/timestamps only. Webhook delivery is summarized in hourly, low-cardinality buckets and old rows are removed on subsequent writes; the admin view queries only its bounded recent window.

## Brief Compiler and policy boundary

Every new application-level call starts as a `RawCallBrief`. Field lengths, locale
IDs, assistant profile, assistance reason, and fact counts are validated before any
model request. Destination numbers are parsed with maintained `libphonenumber-js/max`
metadata, must resolve to a valid Swiss number, and are stored as canonical E.164.
The same deterministic check runs again before an attempt can be reserved or a
provider call created; the Twilio adapter also fails closed on direct bypass. Input
moderation runs before compilation.

The OpenAI Responses API converts the raw brief into versioned `CompiledCallBrief`
Structured Output. It contains the detected source language, localized objective,
task type, tone, a mandatory recipient-and-purpose opening, ordered questions, conditional follow-ups, success and unresolved
criteria, stop conditions, fact translations, prohibited actions, named entities,
risk signals, fixed-code blocking issues, and applied product assumptions. The source text of every approved fact must
round-trip character-for-character and in the same order; otherwise the server blocks
the plan. Generated runtime text is moderated separately after compilation.

The model does not make the final authorization decision. A deterministic policy
gate maps the compiled result to `ready_for_review`, `needs_clarification`, or
`blocked`. Any supported risk signal, unsupported task type, moderation flag, model
refusal, fact-integrity failure, or selected-option mismatch prevents approval.
Ordinary preferences are resolved through explicit product defaults: spoken answers
are saved in CallAssist, all recipients are addressed formally unless the operator
explicitly selects automatic or informal addressing, refusals end politely, and
voicemail does not expose call details. These assumptions never block a call. Clarification is limited to an
allow-list of fixed issue codes whose answers can materially change the task.

For a reviewable plan, the server stores an encrypted source/compiled snapshot,
compiler model and version, policy version, response ID, and SHA-256 snapshot hash.
Editing or answering a clarification recompiles the same call ID, increments the
compilation revision, resets approval, and records an audit event containing only
hashes and version metadata. The operator sees a compact call-language plan, including
the exact opening spoken after consent; source, guardrail, policy, and snapshot metadata
remain available under technical details.
The combined approve-and-call action records `approvedAt` before starting Twilio;
Twilio cannot start from `review_required`, `needs_clarification`, or `blocked`.

The stored runtime `CallBrief` contains only the localized objective, compiled
background plan, and translated approved facts. Raw objective, context, and facts are
available for operator review inside the encrypted compilation snapshot but are never
passed to Realtime or post-call transcription. `deterministic-dev` is a local/test
compiler only; real evaluation and deployment use the configured OpenAI compiler.

## Telephony and consent boundary

`TelephonyProvider` isolates the transport. The mock provider supplies deterministic local scenarios; the Twilio provider creates and terminates real calls. Provider call identifiers and raw statuses are stored with each `CallAttempt`, while signed status callbacks map them into domain statuses and SSE events.

The Twilio voice webhook immediately opens a bidirectional Media Stream with call recording disabled. OpenAI Realtime uses the selected voice to disclose the AI identity, represented person, accessibility context, recording purpose, and retention period. Before the recipient presses `1`, the server discards inbound media frames and does not forward them to OpenAI.

After DTMF consent, the API persists the consent timestamp and asks Twilio to start a dual-channel recording of both tracks on the active call. Recipient media remains blocked until Twilio confirms recording startup. Only then does the same Realtime session read the approved opening in the same voice: it addresses the intended recipient, states the specific purpose and scope, and asks whether it is convenient to continue. The response stops there. An affirmative answer advances to the first objective question, an immediate substantive answer is treated as willingness to continue, and a refusal ends the call politely. A failed recording start produces a same-voice technical notice and terminates the call.

Twilio sends call and recording lifecycle events to signed webhooks, which remain the primary synchronization path. Each HTTP callback records only its kind and accepted/rejected/unmatched/failed outcome in an hourly aggregate; instrumentation failures are logged but never change the webhook response. Provider IDs also transactionally schedule bounded reconciliation jobs after the maximum call window; startup recovery advances unfinished work immediately, and a terminal callback advances its queued reconciliation job so it can complete without an unnecessary provider read. A leased worker may fetch controlled call/recording status from Twilio when a callback is lost. Provider reads and stop requests may repeat after a crash, while repository lease fencing ensures that only the current worker can publish domain state. A completed recording transition transactionally creates an idempotent post-call transcription job. That worker downloads the complete consented media with server-side Twilio credentials and submits it to the configured OpenAI transcription model. The request includes only bounded compiled context, literal names, the selected call language, any explicitly allowed fallback language, and the expected writing system. The final wording comes only from this recording request; it is never replaced or merged with the live draft. A deterministic local aligner may use already stored live events as a role/time scaffold without copying their words. It emits approximate structured segments only when the evidence is sufficient, marks unresolved spans as `unknown`, and otherwise keeps the canonical result as plain text. Browser audio playback is proxied through the main API so critical details can be checked while the Twilio recording is retained; the media URL and credentials remain server-side.

The complete decision, constraints, and deferred improvements are documented in
[the post-call transcription plan](./post-call-transcription-plan.md#stable-mvp-transcription-decision).

The main API listens on port `4000`. In Twilio mode, a separate Fastify listener on `127.0.0.1:4001` exposes only voice/status webhooks and the Media Stream WebSocket. It does not expose `/api/*`, SSE, or a health endpoint. HTTP and WebSocket requests require valid Twilio signatures, and the stream also requires a call-scoped HMAC token. After consent, recipient audio remains gated until Twilio confirms that the complete mandatory opening has played; normal interruption is enabled for the rest of the conversation.

Production should preserve this boundary with a dedicated ingress route or service rather than exposing the main API.

## Durable call telemetry

The live `CallEvent` union remains an ephemeral SSE/UI envelope. Operational reconstruction uses the separately named, schema-versioned `DurableCallEvent` contract and append-only `call_events` rows. Each row has a per-call sequence and call/attempt/owner correlation plus deterministic source, stage, and severity fields. PostgreSQL rejects updates and deletes; the memory repository mirrors the same contract for deterministic tests. Persisted changes publish a small best-effort invalidation after commit. Each API ignores its own signal, rehydrates remote state only when it has a local subscriber, and emits `call.updated`; the browser already refreshes the full owner-authorized snapshot for every non-delta event. Notification loss is not a correctness boundary because initial load/reconnect reads PostgreSQL. Non-persisted Realtime transcript deltas remain local to the process that owns the media stream.

Each event name owns a strict, bounded metadata schema. Durable telemetry may contain lifecycle states, controlled failure codes, compiler/provider/model versions, recording duration/channels, and credit settlement classification. It never contains phone numbers, names, objectives, approved facts, transcript text, credentials, raw provider payloads, or arbitrary exception bodies. Staff/action `audit_events` remain a separate evidence stream, and live SSE behavior is unchanged.

State transitions and their durable events share a PostgreSQL transaction where practical. Per-call advisory locking, sequence uniqueness, and idempotency keys make callback replay safe. A credit charge is emitted only with provider-confirmed connection evidence (`in-progress` or provider `completed`); busy, no-answer, stopped, recovery, and other pre-connection terminal paths emit one refund. A terminal domain status by itself is not treated as proof of a conversation.

## Call outcomes and owner feedback

Technical classification and semantic task success are separate. The current technical view is derived from the bounded durable event stream and records connection evidence, terminal state, consent, recording/transcription state, and a controlled failure stage/code. Provider completion alone never means that the user's goal was resolved.

`call_outcome_revisions` is an immutable, schema-versioned provenance chain. System revisions capture technical-state changes without a semantic outcome; user or authorized staff revisions require an actor. `call_feedback_revisions` is a separate immutable owner-feedback chain for Yes/Partly/No goal result, optional final-transcript quality, and an optional 500-character comment. The comment is encrypted at rest. Idempotency keys make retries safe while conflicting replay is rejected.

Owner API reads and writes use the same tenant boundary as call detail. Aggregate metrics expose counts only and omit call text, comments, phone numbers, and user identity.

## Admin Calls privacy boundary

The operational `/api/admin/calls` read model is purpose-built from call rows, the latest outcome/feedback revisions, recording state, and bounded durable telemetry. Its default list and Inspector DTOs expose only call/owner UUIDs, locale, lifecycle and technical state, outcome provenance, comment-free feedback ratings, duration, event counts, the ordered sanitized event timeline, and outcome history. They do not reuse the owner call-detail response and do not include recipient names, phone numbers, objectives, context, approved facts, transcript text, recording URLs, private feedback comments, credentials, or raw provider payloads.

Active admins and superadmins may read the minimized list and Inspector. Sensitive content is served by a distinct POST capability, requires a 3–500 character operational reason, and is restricted to superadmins. The PostgreSQL transaction appends a `call_sensitive_access_events` row before decrypting and returning content. Foreign keys retain actor/call attribution, and the shared immutable-row trigger rejects updates and deletes. This access evidence is intentionally separate from the reconstructable technical `call_events` timeline.

## Operational overview and system control

`GET /api/admin/operations/overview` builds a privacy-safe cohort snapshot directly
from call rows, the latest outcome/feedback revisions, recordings, and bounded durable
events. Supported creation-time windows are 24 hours, 7 days, and 30 days. Every rate
returns its numerator and denominator: connection is connected/attempted, consent is
consented/connected, technical failure is failed/terminal, feedback is responses/terminal,
and resolution is resolved/classified semantic outcomes. A zero denominator produces
`null`, not a synthetic 0%. Duration and first-audio aggregates expose sample counts
and `no_samples`; Realtime reconnects are explicitly `not_supported` because a broken
session currently ends the call.

Cost output is an operational estimate, never an invoice. Completed bounded usage is
multiplied by optional integer USD micro-dollar-per-minute rates from environment
configuration. Any configured rate requires `ADMIN_COST_PRICING_VERSION`; partial
configuration remains `partial`, and no configured rates remains `unavailable`.
Active usage, provider discounts, taxes, rounding differences, and invoice
reconciliation are outside this read model.

`GET /api/admin/system` confirms the API and database request path, reports bounded
workload, recent durable warning/error counts, bounded transcription/retention/provider-reconciliation
job state, and a recent webhook-delivery window. Webhook facts expose hourly aggregate
counts, last accepted time/age, and the latest controlled problem only; they contain no
call/provider identity or payload. Queue counts, oldest due time, attempts, controlled
error codes, and recent dead-letter work likewise exclude private call text and provider
payloads. A superadmin may restart dead-letter work only with a recorded reason; the audit event is immutable.
The view distinguishes local component configuration from upstream health. Twilio and OpenAI entries therefore set
`upstreamChecked: false`; they must not be interpreted as provider availability.
`generatedAt` is the snapshot freshness boundary. Runtime facts distinguish an
API-embedded worker from external-worker topology. In external mode they expose the
fresh/stale/offline heartbeat state, healthy/stale instance counts, active leased-job
count, and last-seen age without exposing a worker identifier. The current view deliberately does
evaluates a versioned set of snapshot alert thresholds for worker availability,
dead-letter/backlogged jobs, overdue retention, callback processing, and recent
technical errors. These signals do not claim delivery to a production pager:
provider probes, notification routing, and named ownership remain deployment work.

The main API also separates `GET /health/live` (process-only) from
`GET /health/ready` (PostgreSQL-backed). Both are non-cacheable and expose a bounded
contract without exception or configuration detail. The isolated Twilio listener
continues to expose no health or authenticated application routes. Generic Fastify
logs use registered route templates, safe error shapes, and explicit redaction rather
than raw URLs, headers, request bodies, identifiers, private call text, or provider
payloads. See `docs/operations-readiness.md` for thresholds and response procedures.

Admins and superadmins may read both views. Either role may immediately disable new
outbound calls with a 3–500 character reason, but only a superadmin may re-enable
them. The existing repository transaction updates the singleton control and appends
an immutable safety event; active calls are unaffected.

## Call language

Language is a required `CallBrief` property rather than a profile default. One operator can therefore create calls in different languages without mixing instructions or transcripts.

```ts
type CallLanguage = {
  locale: string;           // BCP 47: de-CH, de-DE, en-GB, fr-CH, it-CH, ru-RU
  fallbackLocale?: string;  // only with explicit operator permission
  allowSwitch: boolean;     // false by default
};
```

The current allow-list is `de-CH`, `de-DE`, `en-GB`, `en-US`, `fr-CH`, `it-CH`, and `ru-RU`. The server stores the BCP 47 locale, so the list can grow without a schema migration.

Rules:

1. The operator selects the language before starting and sees it on the brief and live-call pages.
2. Realtime instructions receive the locale, required speaking style, and the language-switch policy.
3. If the recipient uses another language, the assistant asks them to continue in the selected language. Switching is allowed only when `allowSwitch` is true.
4. Every transcript segment stores the locale used for that segment. Partial text is not an authoritative final record.
5. Approval prompts use the active call language and show the exact proposed disclosure to the operator.

`de-CH` means Swiss Standard German. Dialect handling and voice selection are separate concerns and must not be inferred from the locale alone.

## Assistant identity and assistance reason

The public brief does not accept a free-form assistant identity. The operator selects
one stable profile ID from the server-owned catalogue:

- male voice: `sebastian`, `daniel`, `martin`;
- female voice: `anna`, `sofia`, `maria`.

The API derives the spoken display name and voice gender from that profile. Clients
cannot override either derived value. The brief stores both the stable profile ID and
the derived name/gender snapshot so historical calls remain reproducible if the
catalogue changes. Older briefs created before this boundary may have a null profile
ID while retaining their historical snapshots.

Every new brief also requires one locale-neutral assistance reason:

- `speech_impairment`;
- `language_barrier`.

The reason is not free-form and is intentionally extensible through versioned contract
changes. The server combines the reason, represented person, and call locale into a
controlled disclosure. It stores both the reason and the exact disclosure snapshot
encrypted at rest. The future Brief Compiler may translate and structure the
user's objective, but it cannot rename the assistant, invent an assistance reason, or
modify this disclosure.

These domain values are deliberately independent from presentation copy. Future
interface locale catalogues will translate profile groups, reason labels, help text,
validation messages, and preview labels without changing stored IDs or the language
spoken during the call.

## Multilingual boundaries

Four language concerns remain separate throughout contracts, storage, and UI state:

1. `uiLocale` controls interface copy and formatting.
2. `sourceLocale` describes or detects the language used to author the raw brief.
3. `callLocale` controls the disclosure, compiled instructions, speech, and ASR.
4. `fallbackLocale` is an optional second call language enabled by explicit permission.

The compiler now stores detected source-language metadata with the encrypted snapshot.
The account/i18n phase will add a persisted UI preference. No domain enum or database
value may depend on an English UI label, and changing the UI locale must never change
an approved call plan.

## MVP data model

- `CallBrief`: recipient, objective, assistant profile, represented person,
  assistance reason, controlled disclosure snapshot, language, context, approved
  facts, and policy settings.
- `CallCompilation`: encrypted raw brief, structured compiled plan, policy decision,
  compiler/policy versions, response ID, approval time, and immutable snapshot hash.
- `CallAttempt`: provider call ID, raw and domain status, timestamps, and stop reason.
- `CallOutcomeRevision`: immutable technical/semantic classification with explicit provenance, actor, reason, schema version, and revision number.
- `CallFeedbackRevision`: immutable owner rating revision; optional bounded comment is encrypted at rest and excluded from aggregate metrics.
- `CallSensitiveAccessEvent`: immutable superadmin access evidence with call, actor, reason, and timestamp; stored separately from technical telemetry.
- `PromoCode` / `PromoRedemption`: keyed code hash, bounded campaign/window limits,
  immutable per-user redemptions, idempotency, actor, reason, and timestamps.
- `RecipientSuppression`: normalized recipient phone, source, reason, actor, creation,
  and optional audited lift.
- `SystemControl` / `SafetyEvent`: durable outbound-call state and immutable reasoned
  changes for recipient and emergency controls.
- `DurableJob` / `DurableJobAttempt`: transactional recording work, generation,
  retry/lease/fencing state, controlled failure code, and immutable attempt history.
- `DurableJobAdminEvent`: immutable superadmin retry evidence with actor, reason,
  action, and timestamp.
- `TranscriptSegment`: speaker role, text, locale, timestamp, and partial/final state.
- `CallRecording`: consent timestamp, provider IDs, lifecycle, duration, channels, and deletion deadline.
- `FinalTranscript`: encrypted recording-based turns, roles, timestamps, compatibility text, model, lifecycle, and failure metadata.
- `ApprovalRequest`: category, proposed speech, reason, expiry, and operator decision.
- `AuditEvent`: append-only control event without secrets or unnecessary transcript content.

## Sensitive-data policy

Private values are stored separately and encrypted. Raw values may enter the isolated
Brief Compiler and moderation boundary, but they must not enter Realtime, the telephone
conversation, or post-call ASR context before the compiled snapshot is approved.

For addresses, dates of birth, medical information, contact details, or legal commitments, the intended production flow is a server-owned `request_approval` action. The API creates a one-time request, publishes it to the console, and waits for the operator. Rejection or expiry means no disclosure.

`stop_call`, `request_approval`, and `end_call` remain server-owned capabilities. Brief
authorization is now deterministic, while some in-call disclosure and conversation
limits still rely partly on Realtime prompt rules and require stronger tool-level
enforcement before production use.

## MVP exclusions

The first release does not include a browser softphone, a native Android app, automatic language switching, CRM/calendar integrations, RAG, click-to-seek transcript/audio alignment, operator-verified transcript revisions, or indefinite audio retention.
