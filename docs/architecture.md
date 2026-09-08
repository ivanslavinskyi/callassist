# SHPROHLI architecture

Reviewed against the integration of `51a61da` and `14abd28` on 2026-09-07. This describes implemented
behavior. Open defects and release decisions live in the [audit](project-audit-2026-09-07.md)
and [roadmap](mvp-plan.md), rather than being presented as implemented safeguards.

The immutable-plan, provider-cost and staged database-cutover implementation is
recorded in [the delivery roadmap](approved-call-plan-cost-security-roadmap.md).
This architecture includes the integration of that mainline work with the audit fixes.

## Runtime and repository boundaries

### R21 additions — 2026-09-08

New call forms receive only the current account's ID and first/last names from the
server. Names remain directly editable for this call; stored plan inputs take precedence
over profile defaults. Initialization is one-time and keyed by account, so rerenders
do not overwrite edits. Recompilation/approval still creates immutable snapshots.
Root App Router icon assets use the supplied portal geometry with `#222B25` and
`#138553`; metadata resources bypass locale redirects.

With `REALTIME_AGENT_HANGUP_ENABLED=true`, the bridge exposes `end_call` only after
consent and opening playback. The function's validated reason requests a separate
farewell audio response. A controller correlates response IDs, speech epochs and
playback generations: a completed generation is not itself proof of playback.
Only its matching Twilio mark causes normal hangup. Speech invalidates the pending
mark before `clear`, truncates the model audio history and permits a fresh response.
Late, duplicated or cancelled responses cannot finish a different turn.

Before closing the stream (which continues existing TwiML to Hangup), the service
advances the existing attempt-bound `provider_call_reconciliation` job to two
seconds from now. The durable worker checks the provider state and stops that same
leg if needed. Retries check status again after ambiguous errors; provider callbacks
and reconciliation retain the existing status, credits, cost and ASR paths.
Migration 0062 adds the hangup event to the database vocabulary; no alternate
`stopped` transition was added. A transport `completed`
status does not prove that the business objective succeeded.

Generation has a 10-second watchdog; playback uses queued PCMU duration plus a
2-second allowance, capped at 15 seconds from the farewell request. Persistence
has a 2-second bridge deadline; on failure, the stream closes and the existing
maximum-duration recovery remains the last bound. Twilio REST requests time out
after 10 seconds. `conversation.hangup` records bounded phase/reason/trigger facts,
with normal or fallback reasons in `conversation.ended`. Feature flag rollback
requires an API restart and leaves consent/error paths and queued recovery intact.

Local implementation evidence is in [R21 verification](r21-verification-2026-09-08.md).
Live-provider acceptance is recorded separately and this addition does not close R08.

The pnpm/Turbo monorepo has three packages:

| Package | Responsibility | Main sources |
| --- | --- | --- |
| `@callassist/web` | Next.js 15 App Router, React 19, customer/admin UI, SSR session guards, SEO | [app](../apps/web/app), [components](../apps/web/components), [lib](../apps/web/lib) |
| `@callassist/api` | Fastify 5, application services, Twilio ingress, Realtime bridge, SQL repositories, workers | [API entry](../apps/api/src/index.ts), [worker entry](../apps/api/src/worker.ts), [routes](../apps/api/src/app.ts) |
| `@callassist/contracts` | Zod 4 schemas, public/domain DTOs and controlled vocabularies | [exports](../packages/contracts/src/index.ts) |

```text
Browser -- HTTP / credentialed SSE --> main Fastify API (0.0.0.0:4000)
Next.js SSR -- forwarded Cookie ----> private main-API origin
                                         |
                                     PostgreSQL
                          state / ledger / audit / durable leases
                             |                        |
                     LISTEN / NOTIFY          dedicated worker
                     invalidation only        compilation / transcription
                             |                retention / reconciliation
                         API instances        account-deletion loop

Twilio PSTN <--> Media Stream <--> Twilio listener (127.0.0.1:4001)
                                      | same API process
                                      +--> main OpenAI Realtime session
                                      +--> isolated consent-recognition session

Twilio consented WAV --> worker download --> channel utterances --> final ASR
                                            mono/unsupported --> full-file ASR
```

The two Fastify listeners share `CallService` and the API process. The Twilio listener
exposes signed voice/status/recording callbacks and the Media Stream WebSocket, no
application API or health routes. A reverse proxy must be able to reach its loopback
bind; a separate container cannot reach it through another container's loopback.
No production deployment manifest currently resolves that topology.

`DURABLE_WORKER_MODE=embedded` runs workers inside the API for development.
`external` makes the API enqueue initial preparations and durable call work; the
standalone worker owns startup recovery, seeding, polling, leases and heartbeats.
`AccountDeletionService` uses a separate leased request/attempt store in the same
worker process; it is separate from the six `durable_jobs` types. Production requires external
mode. [Configuration and endpoints](runtime-reference.md) describe the actual inputs.

## Browser, session and role boundaries

Customer/public routes live under `/en` and `/de`: Landing, content slugs,
register/verify/login/recover, onboarding, opt-out, redeem, `/app`, `/app/account`,
and `/app/calls/[id]`. Admin is English-only under `/admin`, with separate console
and preview route groups. Removed localized admin and old call routes have no
compatibility redirects. See [admin architecture](admin-interface-architecture.md).

The URL selects customer UI locale; middleware negotiates absent locales from a
browser cookie, `Accept-Language`, then English. `users.ui_locale` is stored at
registration, but there is no dedicated account-language preference update API.
Typed feature catalogues translate customer controls; CMS publishes EN/DE editorial
content independently of the English admin interface. Call locale and fallback locale
remain explicit brief fields and never change when the interface language changes.

Authentication uses scrypt password hashes and random opaque session tokens. Only
token hashes are stored; the browser receives an HttpOnly, SameSite=Lax cookie.
Production adds Secure and the host-only name `__Host-callassist_session`; development
uses `callassist_session`. Session listing exposes at most 50 categorized
browser/platform summaries, not tokens or raw User-Agent. Current, selected and all
sessions can be revoked. Suspension revokes sessions atomically; unsuspension does
not revive them. Expired/revoked/suspended/deleted identities cannot authenticate new
requests. Established SSE streams revalidate durable authorization before each
frame and heartbeat; revocation also closes existing connections (R19 implemented).

Next.js SSR forwards the cookie received by the web host to the private API. Deploy
web and browser-facing `/api` on the same public hostname: separate `www` and `api`
hostnames do not share this host-only cookie, even if CORS allows both. Internal
service origins can differ. Fastify does not configure `trustProxy`, so edge IP-based
budgets need a reviewed proxy/IP policy before deployment.

| Role | Customer calls | Content/SEO | Operational admin | Sensitive call text |
| --- | --- | --- | --- | --- |
| `user` | Own calls | No | No | Own calls |
| `support` | Own calls under normal customer authorization | No | No | Own calls only |
| `content_editor` | Denied | Yes | No | No |
| `admin` | Own calls | Yes | Yes, scoped user controls | Own calls only |
| `superadmin` | Own calls | Yes | Yes | Separate reasoned, audited read |

Navigation is not authorization. Layouts, route helpers and API handlers enforce
session, current legal acceptance, role and resource ownership independently.
Normal call reads/mutations/SSE/media/retries derive the owner from the session and
return `CALL_NOT_FOUND` for foreign resources. Preparation IDs have their own
owner-scoped boundary. Nullable legacy call owners remain hidden pending a migration
policy. Signed provider callbacks use signature and provider/call identity instead
of browser sessions.

## Accounts and legal acceptance

Registration requires explicit first/last names and SMS phone verification; verification
grants three signup credits exactly once. Registration OTP is not login MFA.
Password recovery uses a non-enumerating start, a ten-minute/eight-attempt OTP challenge
and a separate fifteen-minute single-use hashed grant. Password reset atomically
revokes all sessions. Login rechecks the verified password hash under the repository
lock to prevent a stale-password session race.

Phone/email replacement requires the current password and a ten-minute/eight-attempt
challenge bound to the initiating session. The new contact remains pending until
verified; completion preserves that session, revokes others and invalidates unused
password recovery capabilities. Email uses Resend in production and an independent
HMAC key for codes. At challenge creation, verification to the new address and a
notice to the old address are sent together; either delivery failure invalidates
the challenge and returns a controlled error. There is no durable notification outbox
or separate completion notice. Name editing is an owner-scoped PATCH.
See [recovery](password-recovery-policy.md), [phone change](phone-change-policy.md) and
[account profile](account-profile-improvement-plan.md).

Onboarding has **one required Terms/AUP checkbox** and informational consent,
retention, use-limit and credit text. The API still receives four legacy
`acknowledge* = true` compatibility fields. They are not four separately checked
user agreements. Immutable acceptance references the exact published Terms/AUP
revision IDs; material publication requires re-acceptance before call/credit/admin
access. Public content reads never expose drafts. Web public-content fetches use
60-second revalidation; publication is not an immediate cache-invalidation push.

## Call preparation and policy

1. The browser normalizes a brief and binds a UUID idempotency key to a fingerprint
   in owner-scoped session storage, without storing raw form text there.
2. `POST /api/call-preparations` validates ownership, field limits, Swiss destination,
   idempotency and rate limits. One transaction persists encrypted input and a
   `brief_compilation` job; the response is `202` with a `Location` header.
3. A worker compiles/moderates the request. Fenced publication inserts one brief,
   marks preparation `succeeded` and erases its input in one transaction. Failed or
   cancelled preparations also erase input. At-least-once execution converges on one
   call through the creation key. Status polling returns bounded progress or a
   controlled failure; a browser timeout does not cancel durable work.
4. Editing or clarifying an existing call also queues an idempotent encrypted
   preparation. The worker compiles the captured target revision; publication checks
   the immutable compilation ID, increments revision, resets approval and erases
   input atomically. Failure/stale publication leaves the previous revision intact;
   starting is blocked during active recompilation.
5. Approval and approve-and-start require the exact reviewed revision and snapshot
   hash. Append-only compilation/approval rows bind each attempt and stream token to
   that plan. There is no synchronous POST /api/call-briefs create endpoint.

The OpenAI compiler produces strict structured output: detected source language,
localized objective/opening/questions, task classification, allowed-fact translations,
success/unresolved/stop criteria, assumptions, risk signals and fixed clarification
codes. Source facts must round-trip exactly. Raw input and generated runtime text
are moderated separately. Deterministic policy decides review/clarification/blocking;
the model cannot approve itself. Formal addressing, captured spoken results and
voicemail without private details are explicit defaults.

Immutable call_compilations rows are the authoritative source for plans. The
canonical hash is revalidated at reads, approvals and attempt reservation. Realtime
receives an ApprovedExecutionSnapshot projection of the reviewed plan; raw authoring
fields are excluded. Full runtime text is moderated and protected identifiers must
be preserved. The legacy mutable reader/dual-write and media adapter are removed.
Model tool dispatch for request_approval/end_call and deterministic in-call disclosure
control remain separate acceptance work under R08.

Profiles are `sebastian`, `daniel`, `martin`, `anna`, `sofia`, `maria`; name/gender
snapshots are server-derived. Assistance reasons are `none` (default, no disclosure),
`speech_impairment` and `language_barrier`. Explicit represented-person first/last
names are required. Supported call locales are `de-CH`, `de-DE`, `fr-CH`, `it-CH`,
`en-GB`, `en-US`, `ru-RU`; Swiss Standard German does not imply dialect recognition.

## Consent, audio and transcription

Twilio creates calls with recording disabled and connects a signed Media Stream with
an attempt-scoped HMAC token bound to the approved snapshot hash. Two OpenAI sockets are opened. The **main audio
session** speaks the short AI identity/represented-person/recording question. The
separate text-output session recognizes recipient consent speech with automatic
response creation disabled. It does not generate the spoken disclosure.

After the disclosure playback mark, recipient media can enter only the consent
recognizer. A deterministic locale-aware classifier returns affirmative, negative or
unclear. Recognized negatives take precedence. Affirmatives must match a complete
allow-listed phrase; questions, quotes, extra conditions and unrecognized suffixes
cannot grant consent. Regression fixtures include qualified EN/DE/RU refusals.

There is one clarification, then
DTMF fallback; `1` is accepted only in that fallback stage. Timeout or refusal ends
the call. The application does not persist the raw recognized consent phrase or
pre-consent audio; this makes no claim about provider-side retention.

On grant, the server closes the consent socket, persists consent method/locale/time
and starts dual-channel recording. Failure produces a same-voice notice and termination.
The main conversation receives recipient media only after recording startup **and**
the mandatory opening playback mark. Optional assistance disclosure occurs after
consent. The opening asks whether it is convenient to continue; later conversational
readiness and fact limits depend partly on model instructions. Realtime disconnects
end the call; reconnecting that model session is unsupported.

The final-transcription worker downloads authenticated Twilio media (browser playback
uses a separate owner-authorized proxy). For supported stereo WAV it extracts speech
regions: channel 1 recipient, channel 2 assistant. It transcribes assistant utterances
first, then recipient utterances using the nearest preceding recording-derived
assistant text as bounded context. Each phase has concurrency four. Roles/times come
from recording channels and local speech detection. Live transcript text/roles are
ignored by this path. Mono/unsupported/unextractable audio takes one whole-file
plain-text fallback with no invented speaker roles.

Runtime defaults are `gpt-4o-transcribe` for utterances and `gpt-transcribe` for fallback.
The transcriber class alone falls back to its full-file model if no utterance model is
passed; runtime wiring explicitly supplies the utterance model. Input is bounded to
25 MiB and requests to 180 seconds each. A failed/empty utterance fails the final
result; partial output is not published as completed. Legacy alignment utilities and
historical `unknown` segments remain readable but are not the production ASR path.
See [transcription](post-call-transcription-plan.md) and [channel decision](channel-aware-final-transcription-plan.md).

Audio retention is 0, 7 (default) or 30 days. The deletion deadline is assigned from
successful final-transcript completion, not the call-start timestamp; regeneration
updates that deadline. Zero-day audio becomes eligible immediately then. Failed
transcription can retain audio for retry. Retention work is durable and monitored, not a wall-clock guarantee during
provider/worker outages. Deletion of a terminal call deletes provider audio before
local redaction and fences content jobs. Account anonymization processes owned calls
before tombstoning identity and revoking sessions. Contact challenges are erased
atomically; startup/hourly maintenance enforces their 30-day limit. See [data lifecycle](data-deletion-policy.md).

## Credits, admission and abuse

The ledger grants `+3` on verification. Starting reserves `-1`; provider connection
(`in-progress` or `completed`) settles with a zero-value `call_charge`. A failure
before connection refunds `+1` once. Refusals after connection can still consume the
credit. PostgreSQL locks and unique constraints serialize starts, protect balances
and enforce one active attempt per user. Promo plaintext is stored only as a keyed
digest; redemption and manual reasoned grants are transactional/idempotent.

Admission checks active user, approved policy, CH number, global switch, recipient
suppression and quotas before reservation. Defaults: three starts/hour, ten/UTC day,
two/recipient/UTC day, 900 seconds maximum. Failed/refunded starts still consume abuse
quotas. Disabling outbound calls blocks new starts and does not stop active calls.
Admins can disable; only superadmins can resume. SMS-verified public opt-out and
reasoned staff/complaint suppression/lift are implemented; in-call spoken opt-out and
complaint queues are not.

Shared PostgreSQL rate limiting uses independent-key HMAC identifiers, atomic grouped
decisions, bounded fixed windows, expiry and a cardinality cap. `429` includes
`Retry-After`; store errors fail closed before sensitive work. Recovery's
eligibility-sensitive SMS decision preserves the generic response. Scope-only hourly
metrics have 30-day retention. [Rate-limit policy](rate-limit-policy.md) lists limits.

## Persistence and encryption

The current catalog is **62 migrations**, `0001` through
`0062_agent_hangup_telemetry.sql`, producing **58 public tables** including
`schema_migrations`. The catalog is contiguous/checksummed; advisory locking and
per-file transactions protect forward migration/replay. The legacy
`0013_final_transcript_quality.sql` tombstone is accepted only as a pre-catalog record.
Applied files must never be edited to resolve drift. Before 0061, populated databases
must pass the immutable cutover gate: backfill/classify through 0060, drain legacy
attempts/recompilations, verify zero blockers, then deploy the final cutover. The
migration runner enforces the gate; see the [rollout sequence](approved-call-plan-cost-security-roadmap.md#migration-and-rollout-sequence).

| Data family | Representation and protection |
| --- | --- |
| Users, sessions, recovery/contact challenges | Relational identity and capability lifecycle; password/session/grant hashes; pending replacement contacts remain plaintext |
| Call briefs and compilation | Searchable recipient/name/phone/profile fields; encrypted context/facts/assistance; immutable encrypted call_compilations and approval snapshots are authoritative |
| Preparation requests | Encrypted normalized input while pending; retained fingerprint/idempotency/status; erased input on terminal state |
| Attempts, recordings | Immutable approved execution snapshot/hash; provider IDs/status, consent/time/duration/channels/deadline; audio held at Twilio |
| Live transcript and approvals | Relational plaintext transcript and proposed disclosure text, access-controlled |
| Final transcript | Encrypted text/segments and resumable encrypted transcription chunks; model/status/error/usage metadata |
| Provider accounting | Deduplicated operations, request results, raw usage and reported costs; versioned calculated rates separate from actual/fallback/unknown |
| Feedback/outcomes | Encrypted optional comment; immutable categorical ratings/outcomes and provenance |
| Credits/promos/suppression | Immutable ledger/redemptions, code HMACs, retained safety evidence; suppression phone/reason remain personal data |
| Content/editorial/onboarding | Private drafts, immutable publications/audit, localized slugs, legal revision acceptances |
| Jobs/operations/audit | Six durable call-job types, separate deletion requests, leases/attempts/heartbeats, bounded technical and action events |

AES-256-GCM `v2` envelopes authenticate key ID as additional data; the keyring supports
an active write key, up to four decrypt-only previous keys and an explicit legacy `v1`
mapping. Rotation and restore verification share an inventory of all thirteen ciphertext
families, including `call_preparation_requests.input_ciphertext`. An integration test
checks the inventory against the migrated schema and completes a queued preparation
after rotating and removing the old runtime key. See the [recovery runbook](database-recovery-and-secrets.md).

Immutable audit/financial/consent evidence is separate from removable call content.
Narrow privacy-redaction triggers allow feedback comments to be removed without
rewriting scores. “Encrypted private fields” does not mean full-database encryption
or anonymization of all evidence. Database/disk/backup encryption, retention schedules
and deletion replay are separate deployment obligations.

## Jobs, live state and operations

`brief_compilation`, `final_transcription`, `recording_retention`,
`provider_call_reconciliation`, `provider_call_cost_reconciliation`,
`provider_recording_reconciliation` are the six call
job types. Transactions enqueue; expiring leases, renewal and fencing prevent stale
workers from publishing; retries/backoff/dead letters retain immutable attempt
evidence. Provider operations may repeat after a crash. External execution is not
exactly-once. Erased failed preparation input makes manual preparation dead-letter
retry unavailable; the user needs a new request.

Signed callbacks are primary. Reconciliation recovers controlled status fields after
lost callbacks or restart. Recoverable Twilio attempts are not synthetically refunded
just because the API restarted; unrecoverable/mock calls fail closed.
PostgreSQL `LISTEN/NOTIFY` carries process and call UUID invalidations without call
content. API subscribers re-read snapshots; local draft deltas stay with the media
process. SSE uses response-lifecycle cleanup, five-second heartbeats and proxy
buffering headers; reconnect reads canonical state. Every send/heartbeat checks
durable session/account/role/onboarding/ownership; failed or two-second timed-out
checks close the connection. Idle revocation is bounded by five-second heartbeat plus
two-second lookup, subject to event-loop scheduling. Queues are capped at 64 frames.

`CallEvent` is an ephemeral SSE envelope; `DurableCallEvent` is the bounded append-only
technical timeline. Staff/action audit and superadmin sensitive-access evidence are
separate. Default Admin Calls omits recipient identity, call text and private comments.
Technical completion never implies semantic success: user feedback supplies goal
result and transcript-quality ratings with independent provenance.

Admin overview exposes 24-hour/7-day/30-day creation cohorts with explicit denominators,
sample counts and null/unavailable semantics. Optional versioned micro-dollar rates
produce bounded estimates, excluding compilation/consent-session request accounting
and invoice reconciliation. System shows DB/request-path state, configured providers,
jobs, external-worker heartbeats, webhook buckets, rate-limit aggregates and local
snapshot alerts. It does not probe upstream provider health or deliver notifications.

`/health/live` is process-only; `/health/ready` checks storage. Both are non-cacheable
on the main listener. Bounded body/time limits, unsafe-origin checks, secure cookies
and API/web headers exist. Web CSP permits inline scripts/styles for the current
Next.js implementation; it is not a nonce-based CSP. PII-safe logger configuration
and controlled telemetry are tested. Protected log storage, WAF, monitoring/paging,
named owners and exercised deployment recovery remain open.

Compiler attempts consume a cumulative preparation request budget across retries;
terminal failures do not retry. Completed ASR chunks are reused on retry, with usage
retained even when a request fails. Admin views expose per-call and failed-preparation
costs, raw usage and separate provider-reported/calculated/fallback/unknown amounts.
Public-rate assumptions live in the versioned provider-pricing-policy module.

## Verification and limits

The [dated audit](project-audit-2026-09-07.md) records actual test/build/migration/restore
results, runtime defects and dependency findings. The [remediation record](remediation-2026-09-07.md)
records fixes and fresh verification. Turbo declares env/cache inputs, database tests
fail on missing configuration, and both production runtimes require the OpenAI compiler.

A clean build is not proof of browser accessibility, live provider
quality, secure deployment or legal readiness.

Deferred: browser softphone/native apps, teams, payments, external CRM/calendar/RAG,
automatic language switching, model-session reconnect, transcript click-to-seek and
operator-corrected revisions, media CMS and indefinite audio retention. High-risk,
bulk/marketing/emergency calls are outside the current product boundary.
