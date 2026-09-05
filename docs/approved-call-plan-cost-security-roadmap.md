# Approved call plan, cost, and security roadmap

## Status

- Owner: engineering
- Branch: `codex/approved-call-plan-safety`
- Scope: the call lifecycle from brief preparation through Realtime execution,
  provider usage capture, cost calculation, and administrator reporting
- Delivery rule: ship in small, backward-compatible increments; do not make a
  new call attempt depend on a partially deployed schema or worker

## Implementation progress

Completed in the first branch increment:

- added the versioned `ApprovedExecutionSnapshot` contract and one canonical
  projection from an approved compilation;
- changed the Realtime system prompt and mandatory opening builder to accept only
  that execution contract;
- included the compiled objective, background, questions, follow-ups, outcome
  criteria, approved call-language facts, and prohibited actions in the prompt;
- removed the raw-brief legacy opening fallback;
- made an unapproved or blocked compilation fail closed before provider sockets
  are opened;
- added regression coverage for raw objective, context, facts, clarification, and
  delivery markers, plus the unapproved-stream failure path.
- changed public approval and approve-and-start requests to compare-and-set the
  exact reviewed compilation revision and snapshot hash;
- captured an encrypted execution snapshot atomically when reserving a call
  attempt and made Realtime load that attempt snapshot instead of current brief
  state;
- bound Twilio media parameters and their HMAC to call ID, attempt ID, and
  compilation snapshot hash, with fail-closed mismatch and terminal-state checks;
- added owner-erasure and encryption-key-rotation handling for attempt snapshots.
- retained a bounded rollout adapter for pre-migration Twilio tokens only when the
  active attempt has all new snapshot columns `NULL`; new attempts cannot enter
  this path, and the adapter should be removed after the maximum active-call drain
  window.
- centralized the existing compilation hash format, recompute it from
  schema-normalized content, and reject integrity failures at create, recompile,
  approval, and attempt-reservation storage boundaries.
- added append-only compilation revision and approval tables, dual-write for new
  and recompiled briefs, lazy materialization of the latest recoverable legacy
  revision, and a database `compilation_id` binding on new call attempts;
- added immutable logical-identity triggers while preserving the narrowly scoped
  ciphertext-only updates required for owner erasure and key rotation.
- made output moderation consume the same canonical execution-plan projection as
  Realtime, including question purposes, follow-up conditions, all outcome/stop
  criteria, and prohibited actions;
- added local preservation checks for email, phone, numeric date, long numeric,
  and opaque reference identifiers in approved facts and objectives, and reject
  identifiers invented by the compiled runtime plan.

Items 1 through 3 are implemented in code with a dual-read/dual-write rollout
path. Migrations 0051 through 0054 and the database-backed concurrency,
immutability, owner-erasure, legacy-backfill, provider-event deduplication, and
Realtime audio-token tests pass locally against PostgreSQL. The mutable current
`call_briefs` blob remains only as a compatibility projection; immutable revision
rows are the new audit anchor.
Item 4 is partially implemented: full-plan output moderation and the beta opaque
identifier guard are present; broader address/name extraction and review UI still
remain.
Item 5 now has explicit durable retry disposition for compiler failures: network,
timeout, 408/409/429, and 5xx remain retryable; exhausted structured-output
validation, malformed responses, and permanent 4xx failures dead-letter after
one durable attempt. A preparation-scoped provider-request counter is reserved
atomically before every physical compiler or moderation request and caps all
transport and durable retries at eight requests. A crash after reservation is
deliberately fail-closed and may consume budget without sending the request; the
provider-operation ledger in item 6 will make that distinction observable.
Post-call transcription uses the same transient HTTP classification; empty or
oversized audio, malformed successful responses, and permanent OpenAI 4xx errors
are terminal instead of multiplying cost across all three durable attempts.
Item 6 has compiler and Realtime vertical slices: every compiler/moderation HTTP
attempt is reserved as an immutable provider operation before network I/O, its
bounded outcome is stored even on failure, and Responses token usage is written
to a separate append-only usage record before schema/policy publication. Pricing and
calculated cost are intentionally not part of these records. Each accepted media
stream now reserves its main and consent-transcription Realtime sessions before
opening provider sockets. `response.done` persists returned text, audio, cached,
and total token counters, while input-audio transcription completion persists the
provider's token or duration usage variant. Stable provider event/response IDs
deduplicate replay, response/transcription operations point to the exact parent
session, and locally observed session duration is retained even on interruption.
Ledger persistence failure closes the stream to cap untracked spend. Post-call
transcription now reserves every physical OpenAI request before HTTP, persists
the returned token or duration usage (including `x-request-id`) on success and
failure, and keeps pricing out of raw usage. Twilio
outbound legs are now reserved before the create-call request and terminal status
callbacks persist connected `CallDuration` separately from the callback's billed
`Duration`; callback replay and reconciliation converge on one leg operation.
Provider-reported Twilio price and recording cost still remain.
Item 8 is implemented for the current dual-channel utterance path: successful
chunks are stored encrypted with recording ID, durable-job generation, role/stage,
chronological key, exact-request fingerprint, model, and provider operation. A
same-generation durable retry loads matching chunks and submits only missing
work. A deliberate administrative retry increments the generation and therefore
does not silently reuse an earlier result. Partial chunks remain internal, are
never published as a final transcript, participate in key rotation/recovery
verification, and are erased with recording or owner-data deletion.

## Why this roadmap exists

The current production path already replaces the stored runtime `objective`,
`context`, and `allowedFacts` with a projection of `CompiledCallBrief`. Raw task
content remains in the encrypted compilation snapshot for editing, recompilation,
history, and export. The main risk is therefore not a direct raw-context bypass in
the normal path. The risk is that this boundary is implicit: Realtime still accepts
a `CallBrief`, approval is not bound to the exact reviewed revision, some
user-controlled identity text is added outside the compiled plan, and provider
usage is not durably recorded.

The target invariant is:

```text
untrusted brief
  -> bounded input
  -> moderation and compilation
  -> local schema, policy, and identifier validation
  -> reviewed immutable execution snapshot
  -> approval of that exact hash
  -> call attempt bound to that snapshot
  -> Realtime execution and durable provider usage
```

## Non-negotiable invariants

1. Realtime cannot accept a raw call brief as task instructions.
2. A call attempt always identifies the exact approved compilation it executes.
3. The operator approves every task-specific field that can affect the call.
4. Provider usage is recorded even when the enclosing business operation fails.
5. Provider retries are bounded across the complete durable operation, not reset
   for every worker attempt.
6. Raw usage, pricing assumptions, and calculated monetary cost remain separate.
7. Historical records with unavailable usage are `unknown`, never zero.

## Release classes

- **Production blocker:** items 1 through 7. These establish the execution trust
  boundary, immutable approval, bounded retries, and minimum actual usage capture.
- **Public-beta requirement:** item 8 and the beta subset of items 9 and 10.
- **Can follow a limited invite alpha:** advanced admin percentiles, invoice
  reconciliation, document upload, answering-machine detection, and historical
  usage backfill that cannot be reconstructed exactly.

## 1. Explicit `ApprovedExecutionSnapshot`

### Objective

Replace the semantic overloading of `CallBrief` with an explicit runtime contract.
Realtime must receive a reviewed call plan and a narrow set of trusted technical
metadata, never a raw user form object.

### Contract

The execution snapshot contains only:

- compilation schema version, revision, and snapshot hash;
- call locale and approved spoken identities;
- localized objective and background summary;
- mandatory opening;
- ordered questions and required flags;
- conditional follow-ups;
- success, unresolved, and stop criteria;
- approved call-language facts and protected identifiers;
- application-owned policy controls;
- tone, addressing, result handling, refusal, and voicemail behaviour.

Technical runtime metadata remains separate:

- call, attempt, compilation, and provider stream identifiers;
- trusted assistant profile and voice;
- locale-switch policy;
- static disclosure, consent, recording, and retention policy;
- audio format, VAD, timeout, and model settings.

Phone number is telephony metadata and must not enter the model prompt. Raw
objective, context, facts, clarification answers, delivery instructions, and raw
identity strings are forbidden in the Realtime API surface.

### Work

- Add versioned schemas and types under `packages/contracts`.
- Add one canonical projection function from a validated compilation.
- Make prompt builders accept the new contract rather than `CallBrief`.
- Add compile-time and runtime tests proving raw fields cannot be supplied.
- Keep a temporary legacy adapter only for already-active legacy attempts.

### Definition of done

- No new-call Realtime function accepts `RawCallBrief` or `CallBrief`.
- The snapshot schema rejects missing revision/hash and unapproved plans.
- Characterization tests prove every required compiled field is preserved.
- Raw injection markers used in fixtures are absent from all Realtime messages.

## 2. Immutable compilation and approval by hash

### Objective

Make every compilation revision reconstructable and bind approval to the exact
content shown to the operator.

### Data model

- Add append-only `call_compilations` rows keyed by call and revision.
- Store encrypted raw brief, compiled plan, execution projection, policy decision,
  compiler/model versions, provider response ID, and canonical snapshot hash.
- Add immutable `call_compilation_approvals` keyed by compilation ID.
- Approval input is `{ revision, snapshotHash }`; while holding the call row lock,
  the server resolves that unique pair to `compilationId` and stores the ID in the
  immutable approval and attempt records.
- Never mutate an approved compilation; editing creates a new revision.

### Compatibility

- Dual-write the current encrypted blob and the new tables during rollout.
- Backfill the latest recoverable legacy compilation only and mark it as backfilled.
- Do not invent lost historical revisions.

### Definition of done

- Concurrent recompile/approve tests cannot approve an unseen revision.
- Database triggers prevent logical compilation and approval mutation/deletion,
  with a ciphertext-only exception for key rotation and owner erasure.
- Audit/export can reconstruct the exact approved plan.

## 3. Attempt-bound Realtime

### Objective

Ensure the media stream can execute only the compilation selected when the call
attempt was reserved.

### Work

- Add `call_attempts.compilation_id` and execution snapshot hash.
- Atomically verify approval and bind the compilation inside `startAttempt`.
- Bind the Twilio stream token to call ID, attempt ID, compilation hash, and expiry.
- Resolve Realtime state by active attempt/provider Call SID, not by mutable current
  call-brief state.
- Reject absent, terminal, mismatched, unapproved, or expired streams.
- Remove the legacy opening fallback for all new attempts.

### Definition of done

- Recompilation cannot affect an existing attempt.
- A token for revision N cannot start revision N+1.
- Restart/reconciliation still resolves the same execution snapshot.

## 4. Complete runtime validation, moderation, and identifier integrity

### Objective

Validate exactly what Realtime will execute and preserve critical identifiers.

### Work

- Serialize one canonical execution projection and send that exact projection to
  output moderation.
- Include follow-up conditions, success/unresolved/stop criteria, prohibited
  actions, and every other runtime string.
- Replace model-generated free-text policy guardrails with trusted policy codes
  expanded by application-owned copy wherever possible.
- Validate recipient and represented-person spoken identities locally or include
  their approved forms in the reviewed compiled plan.
- Extract protected identifiers locally from source facts: case/reference IDs,
  email addresses, phone numbers, dates, postal addresses, and names.
- Require exact preservation for opaque identifiers. Store canonical and approved
  spoken renderings separately where natural-language rendering is necessary.
- Show source and spoken fact text side by side in review.

### Definition of done

- Injection placed in any raw field cannot reach a Realtime message unchanged.
- Injection placed in an omitted compiled field is detected by full-output checks.
- Mutation or loss of a protected identifier blocks approval.
- The operator can verify every execution-relevant field.

## 5. Retry classification and cumulative request budget

### Objective

Retry transient provider failures without replaying terminal semantic or
configuration failures and without multiplicative cost amplification.

### Error policy

- Retryable: timeout/network, HTTP 408, documented transient 409, HTTP 429 with
  `Retry-After`, and HTTP 5xx.
- Terminal: ordinary OpenAI 4xx, authentication/authorization, missing model or
  endpoint, permanent configuration, input moderation rejection, model refusal,
  invalid structured output after one correction, internal schema mismatch, and
  invalid media such as empty/oversized audio.
- A malformed successful HTTP response may receive one transport retry; a second
  malformed response is terminal and both attempts remain visible.

### Work

- Add typed `retryDisposition`, provider stage, status, and error code.
- Persist request counters on the logical preparation/recompilation operation.
- Enforce one cumulative budget across worker attempts.
- Honour provider backoff with jitter.
- Give recompilation the same durable idempotency boundary as initial preparation.
- Record ambiguous requests separately because a timed-out request may have been
  processed and billed by the provider.

### Initial safety budget

Start with at most four Responses submissions and four moderation submissions per
compilation revision. Revisit only after production measurements and evaluation.

### Implemented increment

- `call_preparation_requests.provider_request_count` persists the cumulative
  budget across worker restarts and durable attempts.
- The compiler reserves budget before each HTTP request, including transport
  retries, and refuses to call the provider when reservation is denied.
- `OPENAI_REQUEST_BUDGET_EXHAUSTED` is terminal and maps to the existing
  privacy-safe unavailable result at the public preparation boundary.
- Initial preparation is covered now. Durable recompilation remains part of the
  later recompilation/idempotency work.

### Definition of done

- Terminal failures never re-enter the durable queue automatically.
- Schema correction does not trigger a second complete durable compilation.
- Request counts remain bounded after worker restart and lease replay.

## 6. Raw usage ledger

### Objective

Persist immutable provider facts independently of calculated money and business
success.

### Data model

- `provider_operations`: logical run, actual HTTP request, Realtime session/response,
  telephony leg/recording, or transcription chunk, with parent-child correlation.
- `usage_records`: token, cached token, cache-write, reasoning, text/audio/image,
  duration, billable duration, and request-count facts returned by providers.
- Link usage to preparation even if no call is created; additionally link to
  compilation, call, attempt, job attempt, session, or recording where applicable.
- Preserve provider response/request/session/SID identifiers as deduplication keys.
- Keep raw provider usage JSON in a bounded schema-versioned column for forward
  compatibility; never store prompts or transcripts there.

### Write semantics

- Write usage immediately after a provider response/event is parsed and before
  downstream schema validation or business-state publication.

### Implemented compiler and Realtime slices

- `provider_operations` records physical request identity, requested model,
  stage, preparation, durable job generation, and start time. A reserved row
  without a result explicitly represents an ambiguous crash/interruption.
- `provider_operation_results` records one deduplicated outcome, provider
  request/response IDs, actual returned model, HTTP status, duration, and a
  bounded error code.
- `provider_usage_records` stores request count plus independent text, cached,
  reasoning, audio, and duration dimensions. Compiler Responses currently fill
  only counters actually returned by the API; moderation tokens remain unknown.
- The bounded raw `usage` object is retained for forward-compatible parsing,
  while prompts, brief content, and provider error bodies are never stored.
- The normalized Responses mapping follows the official API fields
  [`input_tokens`, cached/cache-write input details, `output_tokens`, reasoning
  details, and `total_tokens`](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).
- Realtime `response.done` records response status/model plus the returned text,
  audio, cached-text, cached-audio, output, and total token counters. Cancelled,
  failed, and incomplete responses retain any usage already returned.
- Realtime input-audio transcription completion records either its token
  breakdown or processed seconds, exactly matching the provider usage variant.
- Main and consent-transcription sessions are reserved together before either
  WebSocket is opened. Child operations reference their exact session, and stable
  provider response/event IDs converge replay on one immutable operation.
- All three tables reject update/delete at the database boundary and are included
  in the recovery drill's critical-table set.
- Usage insertion must not roll back with call creation, compilation validation, or
  final transcript assembly.
- Duplicate provider events converge on one record.
- Missing usage is `unknown`; an app-side duration estimate is a separate fact.

### Definition of done

- Failed preparation and failed call/session retain already incurred usage.
- Idempotent replay cannot double-count a provider response.
- Distinct provider retries are never incorrectly deduplicated.

## 7. Provider instrumentation

### Brief compiler

Capture model, response ID, input/cached/cache-write/output/total/reasoning tokens,
logical schema attempt, correction count, transport retry, moderation request count,
duration, and terminal status.

### Realtime

Capture both the main and consent-transcription WebSocket sessions. Record model,
session attempt, response ID/status, text/audio/image input, cached input details,
text/audio output, local session duration, and disconnect/reconnect reason. Record
cancelled, failed, and incomplete responses when usage is present.

### Twilio

Capture Call SID/Recording SID, connected seconds, provider billed duration, start,
end and queue times, final call and recording price/currency, and webhook sequence
metadata. Provider-reported Call price covers connectivity only; recording and other
features remain separate components.

Implemented: outbound leg reservation, Call SID deduplication, terminal callback
`CallDuration`, billed callback `Duration`, callback timestamp/sequence, and REST
reconciliation of connected seconds. Pending: eventually consistent final call
price/currency, recording price, and explicit queue/start/end timestamps.

### Post-call transcription

Capture response usage exactly as returned: token breakdown or processed seconds,
model, request ID, chunk duration/hash/index, retry, and total duration.

### Definition of done

- A single call can be reconciled from preparation through every provider operation.
- Instrumentation failure is observable and does not silently convert usage to zero.
- Admin coverage reports actual/calculated/fallback/unknown proportions.

## 8. Resumable transcription chunks

### Objective

Do not retranscribe successful dual-channel utterances when one chunk fails.

### Work

- Persist chunk identity as recording ID, transcript generation, chronological
  index, role, and audio hash.
- Persist encrypted chunk text and its provider operation immediately.
- On retry, load completed chunks and submit only missing/retryable chunks.
- Assemble the final transcript only after every required chunk succeeds.
- Keep the one-request full-recording path for mono/unsupported media.

### Definition of done

- A failure in chunk N does not resubmit chunks 1 through N-1.
- Partial chunks never appear as a completed final transcript.
- Usage of every successful and failed attempt is retained.

## 9. Existing administrator cost/usage section

### Objective

Extend the existing operations dashboard instead of creating a competing telemetry
system.

### Beta scope

- Per preparation/call: compilation, Realtime text, Realtime audio, Realtime input
  transcription, telephony connectivity, recording, post-call transcription, total.
- Show underlying units, provider/model, attempts/retries, and cost basis.
- Aggregate preparation/call/success/failure counts, connected/billed minutes,
  average duration, compiler and Realtime token totals, transcription usage, total
  spend, average preparation/call/successful-call cost, component/provider/model
  breakdown, time trend, and usage coverage.
- Add incurred-at aggregation; retain call-created cohort for operational outcomes.

### Later scope

- p50/p95 cost, anomaly detection, destination/SKU analysis, CSV export, and invoice
  reconciliation drill-down.

### Definition of done

- Estimates are never labelled actual.
- Failed preparations are visible even without a call ID.
- Historical unknown usage is excluded from averages or shown with explicit coverage.

## 10. Input UX and further analytics

### Beta input policy

- Reuse exported server constants in the form.
- Preserve current per-field limits initially.
- Add a 16,000-character soft warning and a 20,000-code-point hard aggregate limit
  across objective, context, allowed facts, clarification answers, and delivery
  instruction.
- Count after trim, Unicode NFC normalization, and line-ending normalization.
- Enforce the same function on the API; arrays cannot bypass the aggregate limit.
- Add `maxLength`, per-field counters, a total counter, fact-count limits, and
  field-specific API errors.

Twenty thousand is intentionally above the initial 12–16k guideline: the currently
supported 12k context plus 4k objective already consumes 16k and leaves no room for
facts needed in Gemeinde, Krankenkasse, school, social-service, and medical use
cases.

### Long documents

Move larger documents to a later upload/extraction/OCR/summarization pipeline with
its own file, security, moderation, token, citation, identifier, and approval
budgets. Never place a complete uploaded document in Realtime instructions.

### Definition of done

- Browser and direct API enforce identical limits.
- Unicode and whitespace handling is deterministic.
- Oversized input produces actionable field and aggregate errors.

## Pricing and calculated cost

Raw usage is immutable. Monetary calculation uses separate versioned tables:

- `pricing_rates`: provider, model/SKU, usage metric, unit scale, currency,
  effective interval, source, and version;
- `cost_records`: usage record, rate/version, amount/currency, calculation time, and
  basis (`provider_reported_actual`, `calculated`, `fallback_estimate`, `unknown`).

Evolution of current configured per-minute rates:

- Realtime USD/min becomes a legacy fallback when token usage is missing.
- Telephony USD/min remains a fallback until Twilio final price is available.
- Transcription USD/min remains valid only for duration-priced models and as a
  fallback for legacy records.
- Compiler pricing is added from versioned token rates.
- No provider prices are hardcoded in business logic.

## Migration and rollout sequence

1. Characterization tests and explicit execution contracts.
2. Full canonical runtime projection and validation.
3. Add immutable compilation/approval schema and dual writes.
4. Bind attempts and media streams to compilation IDs/hashes.
5. Introduce retry dispositions and cumulative budgets.
6. Add provider operation, usage, pricing, and cost ledgers.
7. Instrument compiler, Realtime, Twilio, and transcription.
8. Make transcription chunks resumable.
9. Extend admin APIs and UI.
10. Add shared input limits/counters and advanced analytics.
11. Backfill recoverable legacy records and cut over readers.
12. Remove mutable/legacy execution paths after active legacy work drains.

## Test matrix

At minimum cover:

- raw task fields and injection markers absent from Realtime;
- every required compiled field present;
- approved revision/hash compare-and-set and attempt binding;
- protected identifiers preserved;
- direct API and frontend limit parity, arrays, Unicode, and whitespace;
- retryable versus terminal provider errors and cumulative budgets;
- every billable compiler attempt, Realtime response/session, Twilio leg/recording,
  and transcription chunk;
- failure-path usage retention and duplicate-event convergence;
- reconnect and multi-session aggregation;
- actual/calculated/fallback/unknown admin totals and averages;
- migration, dual-read/write, active-job compatibility, export, and deletion.

## Risks intentionally left outside this roadmap

- Legal/privacy launch approval and production infrastructure readiness remain in
  `docs/mvp-plan.md`.
- Answering-machine detection and automatic redial require separate product policy.
- Historical provider usage that was never captured cannot be reconstructed exactly.
- Full app-level encryption of remaining searchable PII requires a separate threat
  model and blind-index design.
- A long-document upload pipeline is a separate product and security project.
