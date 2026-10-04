# Runtime and API reference

Updated 2026-10-04 after the hybrid consent, Live stability and preparation diagnostics review. Current domain behavior is documented in [the engineer guide](engineer-guide.md).
The route inventory below was regenerated from source. Configuration values describe
the repository defaults, not provider availability, supported pricing or a deployed
environment. Exact locked package versions are in [pnpm-lock.yaml](../pnpm-lock.yaml).

## Preproduction additions

- Versioned beta credits: PUT `/api/admin/system/beta/credit-policy`, GET `/api/admin/system/beta/credits/preview`, POST `/api/admin/system/beta/credits/apply`.
- Returned-plan list/detail/triage and reasoned sensitive access under `/api/admin/safety/plan-reviews`.
- POST `/api/admin/telemetry-exports/preview`; `includeAudio` defaults true for new exports.
- `CALL_PREPARATION_TIMEOUT_MS` defaults to 120000 including queue/retries. Generation request timeout is 35000 ms; public progress exposes five localized provider stages.
- Stage metadata stores planned pre-journal budgets; actual completion timing comes from result timestamps.
- Runtime descriptor metadata is frozen for new attempts; historical missing metadata remains null.
- GET/PUT `/api/admin/system/voice-consent` reads or changes recognition for new attempts. The migration default remains semantic; only an active superadmin can change it with an expected revision and audit reason.

## Saved transcript source

The `live-managed-v9` implementation (2026-10-04) prepares task context silently after
recording admission, waits for every correlated preparation ACK, then opens native
audio before a separate short instruction to begin. The start instruction's ACK and
first transcript no longer gate the first audio packet. Protected appointment playback
retains its existing resume fence. Active farewell playback remains idempotent.
The task decision deadline is `max(answerSettledAt + 5000, lastNativeVoicedAt + 2000)`;
fresh-answer, speech and backend-occupancy checks still apply. These are server event
times, not measured telephone playback boundaries. Recording admission is unchanged.
A wholly muted assistant fragment is excluded from audible coverage; uncertain output
on protected-playback resume remains a quality issue.
See [implementation and telephone acceptance](live-runtime-stability-plan-2026-10-04.md).

[Live primary implementation](archive/live-native-primary-implementation-2026-10-01.md) supersedes the automatic recording fallback.
Migration 0093 extends encrypted `final_transcripts` into separate per-attempt
`live` and `recording_asr` artifacts while preserving existing immutable revision IDs.
`finalTranscript`/`finalTranscriptRevision` project the primary Live source;
`recordingTranscript`/`recordingTranscriptRevision` expose the optional audio source.
Legacy attempts without Live retain their labelled existing ASR result.

`live_transcript_finalization` runs without recording availability or an ASR provider.
The existing write queue drains native deltas and acknowledged application playback.
Incomplete capture publishes useful text with quality issues, never automatic ASR.
A terminal collecting capture is recovered after a 20-second drain grace period.
Disclosure playback and a separate consent event remain in the primary transcript;
pre-consent recipient speech is excluded.

Owner-authenticated `POST /api/call-briefs/:id/recording-transcript` atomically saves
an explicit request and queues `final_transcription`. The former
`POST /api/call-briefs/:id/final-transcript/retry` is a compatibility alias with the
same authorization. GET, opening a tab, callback and restart never initiate ASR.
Cached completed audio transcripts return without new work. Provider reservations
require the durable request, active owner, available/unexpired recording and lease;
`provider_operations.recording_transcript_request_id` identifies authorization.
Successful chunks are reusable across retries by recording/stage/model/fingerprint.

Retention is scheduled once when recording becomes available, independently of
both transcript jobs. Existing deadlines are retained; ASR never extends them.
Zero-day recordings become immediately eligible for deletion. The model-free
`db:backfill:live-transcripts` command defaults to dry run; `--execute` publishes
historical native projections without regenerating summaries or changing old evidence.
No new provider or environment switch is required. Display labels remain SHPROHLI.

## Registration policy and call retries

These are database settings, not new environment flags. Superadmin
`PUT /api/admin/system/registration` requires the expected beta-settings revision
and audit reason. Defaults: `onboarding=full`, `emailVerification=required`.
`GET /api/auth/registration-options?locale=...` returns no-store public policy,
legal documents and allowed SMS countries. In `registration` mode agreement is
recorded with account creation; stale document revisions fail atomically.
After SMS the email screen remains mandatory to visit; `deferrable` adds the
explicit `POST /api/auth/email-verification/defer` action. Deferral is durable for
the address without verification. Switching back to `required` gates new starts.

`POST /api/call-briefs/:id/repeat` requires an owned, definitively unanswered and
settled source attempt. It returns a new draft using the saved compilation, with
one clone per source attempt. Review/approval and all admission checks run again;
unchanged plans do not invoke the compiler. Migration 0083 preserves provenance.
Settled `completed` attempts with `consent_not_received` also qualify; explicit
refusal, granted consent, conversation evidence and recordings do not. Technical
connection is not treated as proof of a human answer.
See [registration/call behavior and tests](archive/registration-and-call-improvements-2026-09-25.md).

## Call lifecycle and history

Migrations 0073/0074 add stop events and final assessments. List/snapshot/Inspector responses share the `lifecycle` projection, including `assessment_pending` and `assessment_unavailable`. Operations exposes independent `lifecycle.goals` and `userGoalFeedback` counts. Those two migrations introduce no production environment variable; migration 0075 and opt-out require the additional settings below. Apply migrations before restarting all API/worker processes; do not leave an old worker using immediate refunds. History lives at `/[locale]/app/history`. [Final assessment semantics and verification](archive/post-call-assessment-diagnosis-2026-09-15.md).

`summary-v4:grounded-v3` combines the final summary, cited appointment extraction and canonical assessment, followed by pure server calendar composition. Legacy `summary-v3` remains readable. Normal short calls use one request; transient failures allow one automatic retry per generation. The five-minute reservation deadline starts when termination is first processed and survives restarts. Worker maintenance releases expired reservations independently of slow model/transcription work. Actual model availability and diarization still affect assessment quality. Optional billable smoke evaluations: `ALLOW_BILLABLE_EVAL=true pnpm --filter @callassist/api eval:call-assessment` (eight synthetic examples; `ASSESSMENT_EVAL_CASE` selects one) and `eval:summary-calendar` (six synthetic examples, five languages; no calls).

## Processes and configuration loading

| Runtime | Command (repository root) | Configuration |
| --- | --- | --- |
| Development API | `corepack pnpm --filter @callassist/api dev` | Imports `config/load-env.ts`; checks working-dir `.env`, then root `../../.env`; existing process env wins |
| Development worker | `corepack pnpm --filter @callassist/api worker` | Same env loader; explicit external runtime with worker enabled |
| Development web | `corepack pnpm --filter @callassist/web dev` | Next.js project env takes precedence; config imports only the three web settings from root `.env` |
| Production API | `corepack pnpm --filter @callassist/api start` | Built `dist/index.js`; deployment must set `NODE_ENV=production` |
| Production worker | `corepack pnpm --filter @callassist/api start:worker` | Built `dist/worker.js`; deployment must set `NODE_ENV=production` |
| Production web | `corepack pnpm --filter @callassist/web start` | `next start` after build; browser public settings are build-time inputs |
| Migrations | `pnpm db:migrate` / API `db:migrate:prod` | Explicit operation; API startup is not the migration runner |

Turbo uses strict mode with declared test/build env, hashed `.env` inputs and web
origins. Test caching is disabled. `dev` is uncached and passes process env through;
direct API/worker commands also preserve process env. Use ordinary `pnpm test`.
Missing/unavailable test databases fail; the isolated rotation/retention suites need
CREATEDB on the test role. API test workers are capped at four.

The API/worker factory defaults to memory storage if `STORAGE_DRIVER` is absent;
`.env.example` explicitly selects PostgreSQL. Merely building or running `node dist`
does not activate the API production validator: it checks `NODE_ENV` exactly.

## Storage, identity and network settings

| Variable | Example/default behavior | Consumers / boundary |
| --- | --- | --- |
| `NODE_ENV` | Set explicitly to `production` for API/worker deployment | Enables fail-closed production checks and secure API cookie |
| `STORAGE_DRIVER` | Example `postgres`; factory fallback `memory` | Calls, auth, content and shared rate limiter |
| `DATABASE_URL` | Example `localhost:56432/callassist` | Server-only database credentials; production accepts loopback only with `ALLOW_LOOPBACK_DATABASE=true` |
| `ALLOW_LOOPBACK_DATABASE` | Unset by default; `true` for a reviewed local PostgreSQL cluster | API/worker production validator; does not weaken public-origin validation |
| `TEST_DATABASE_URL` | Separate `callassist_test` on the selected server | Integration tests require a dedicated `*_test` database; missing/unavailable URL fails |
| `POSTGRES_PORT` / `POSTGRES_PASSWORD` | Example `56432` / development password | Compose; port fallback without variable is `55432` |
| `DATA_ENCRYPTION_KEY` | Independent base64 32-byte key | API/worker private JSON encryption |
| `DATA_ENCRYPTION_ACTIVE_KEY_ID` | Example `local-1` | Explicit production write-key ID |
| `DATA_ENCRYPTION_PREVIOUS_KEYS` | JSON key-ID to base64 key map, empty normally | Up to four decrypt-only retained keys |
| `DATA_ENCRYPTION_LEGACY_V1_KEY_ID` | Example `local-1` | Resolves old v1 ciphertext to a retained key |
| `PROMO_CODE_HASH_KEY` | Generated independently by env:init | Promo HMAC; legacy local fallback to data key, independent key required in production API |
| `RATE_LIMIT_HASH_KEY` | Generated independently by env:init | Shared identifier HMAC; independent production API key |
| `EMAIL_VERIFICATION_HASH_KEY` | Generated independently by env:init | Initial email verification and email-change OTP HMAC; independent production API key |
| `PORT` | `4000` | Main API port |
| `API_HOST` | Production default `127.0.0.1`; development default `0.0.0.0` | Literal main API bind address; set explicitly for a private container interface |
| `TWILIO_WEBHOOK_PORT` | `4001` | Twilio-mode listener; must differ from main port |
| `TWILIO_WEBHOOK_HOST` | `127.0.0.1` | Literal listener IP; use a private, unpublished interface when containerised |
| `TRUSTED_PROXY_CIDRS` | Development fallback `none` | Explicit production API choice: trusted literal IPs/CIDRs or `none`; no trust-all/hop counts/named networks |
| `PUBLIC_BASE_URL` | Public HTTPS Twilio ingress origin | Signature validation, callback and Media Stream URLs |
| `WEB_ORIGIN` | Example localhost/127.0.0.1 port 3000 | Comma-separated browser-origin allow-list; production HTTPS required |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` fallback | Browser HTTP/SSE, web CSP; public build-time value |
| `NEXT_PUBLIC_SITE_URL` | Example `http://localhost:3000` | Canonical metadata, sitemap, robots, SEO, HTTPS web HSTS |
| `INTERNAL_API_URL` | Falls back to public API URL then localhost:4000 | Private web SSR session/content lookups |
| `NEXT_DIST_DIR` | `.next` | Optional separate output for a parallel local QA web server, e.g. `.next-r21`; use the same value with direct Next build/start commands |

For web development, create `apps/web/.env.local` with only the three web settings
above if overriding localhost defaults. In production, use the public web hostname
for browser API access and proxy `/api/*` to Fastify. SSR can use a private API origin.
Keep the Twilio public ingress separate. Configure `TRUSTED_PROXY_CIDRS` for the actual
proxy peers, strip incoming forwarding headers at the edge and isolate API ports.
`corepack pnpm deployment:check` validates the intended combined production settings
without DB/provider traffic; it does not prove external readiness or actual process
parity. See deployment preflight and the chosen first-release target (local operational document; excluded from Git).

## Provider and worker settings

| Variable | Repository default / requirement |
| --- | --- |
| `TELEPHONY_DRIVER` | `mock`; production requires `twilio` |
| `REALTIME_AGENT_HANGUP_ENABLED` | `false` by default; apply migration 0062 first. Exact `true` enables ordinary-call `end_call` in the task stage. Unified Live enters this stage after recording starts and any optional assistance disclosure finishes playing; its ordinary opening is native. Read at API startup; restart required. Does not affect consent/error hangup. |
| `DURABLE_WORKER_MODE` | `embedded`; production requires `external` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Required for real outbound telephony |
| `VERIFICATION_DRIVER` | Example `mock`; factory infers Twilio from real telephony if unset; production API requires explicit `twilio` |
| `TWILIO_VERIFY_SERVICE_SID` | Required for Twilio SMS verification |
| `TWILIO_OPT_OUT_VERIFY_SERVICE_SID` | Required on production API: separate Verify Service for public recipient opt-out; must differ from the account service |
| `RECIPIENT_CONTACT_HASH_KEY` | Required on production API/workers: stable independent 32-byte base64 HMAC key, identical on every process; preserves opt-out eligibility after call deletion |
| `SMS_ALLOWED_COUNTRIES` | `CH,UA`; comma-separated ISO countries for account verification, independently validated from outbound-call destinations |
| `SMS_DAILY_SEND_LIMIT`, `SMS_PER_MINUTE_SEND_LIMIT` | `100` / `10`; shared across all SMS flows; each number also has 1/minute and 3/hour limits |
| `MOCK_VERIFICATION_CODE` | `000000`, local only |
| `EMAIL_DRIVER` | `mock`; production API requires `resend` |
| `MOCK_EMAIL_VERIFICATION_CODE` | `000000`; six digits for local mock email only; real Resend uses random codes |
| `RESEND_API_KEY`, `EMAIL_FROM` | Required for initial email verification/change/security notices; local sender `SHPROHLI <mail@shprohli.ch>` requires verified Resend domain |
| `NEXT_PUBLIC_SITE_URL` | Also required by the API for production email footer links: public HTTPS origin, no credentials/path/query; localhost HTTP is allowed in development. Logo is embedded as a CID PNG, independent of this URL. |
| `OPENAI_API_KEY` | Required for real Realtime/Live/Responses/ASR and OpenAI compiler |
| `BRIEF_COMPILER_DRIVER` | Example `mock`; factory infers `openai` when key exists if unset. API and worker production validation both require explicit `openai`; missing/mock is rejected |
| `OPENAI_BRIEF_COMPILER_MODEL` | `gpt-5.6` |
| `OPENAI_BRIEF_COMPILER_TIMEOUT_MS` | `120000` total compiler timeout per worker attempt; generation leaves up to 25 seconds for final moderation |
| `OPENAI_BRIEF_COMPILER_REQUEST_TIMEOUT_MS` | Unset: `35000` for plan generation/repair/language audit, `25000` for moderation. Explicit values override both stages; every request and response-body read also obeys the remaining deadline |
| `TEXT_PROCESSOR_DRIVER` | Falls back to `BRIEF_COMPILER_DRIVER`, then `mock`; production generation requires `openai` |
| `TEXT_PROCESSOR_MODEL` | `gpt-5.6`; model identity is part of the artifact generator version |
| `TEXT_PROCESSOR_TIMEOUT_MS` | `45000` bounded translation/review request timeout (1–120000 ms) |
| `TEXT_SUMMARY_TIMEOUT_MS` | `90000` bounded summary request timeout (1–120000 ms); independent of UI and call languages |
| `TEXT_ARTIFACT_GENERATION_ENABLED` | Explicit `true`/`false`; absent means enabled for mock and disabled for OpenAI. Disabling generation preserves reads of retained artifacts |
| `TEXT_ARTIFACT_DIRECTIONS` | Comma-separated `kind:source:target`, e.g. `plan_review:de:ru,transcript_translation:*:ru,call_summary:*:ru`. Real provider has no enabled directions when empty. Final transcripts can contain mixed/unknown languages, so transcript translation and summary use source `*`; do not infer it from the call locale |
| `API_RATE_LIMIT_TEXT_ARTIFACTS_PER_HOUR` | `30` owner/IP generation/retry requests per hour |
| `VOICE_RUNTIME_DRIVER` | `live`; accepts `realtime` or `live`, invalid values fail startup; API restart required. Set `realtime` explicitly only for rollback. |
| `VOICE_RUNTIME_LIVE_FALLBACK` | `false`; one Live voice session with no Realtime sockets. Explicit `true` retains the legacy hybrid pilot and startup fallback |
| `OPENAI_LIVE_MODEL` | `gpt-live-1`; native Live listening, consent interpretation, opening and conversation when fallback is disabled; v5 terminal speech uses the existing selected-voice renderer |
| `OPENAI_LIVE_DELEGATION_MODEL` | `gpt-6-luna`; native Responses consent/task delegation plus protected appointment semantic checks; `parallel_tool_calls=false` |
| `OPENAI_SPEECH_MODEL` | `gpt-4o-mini-tts`; application-owned exact disclosure synthesis. Raw 24 kHz PCM is converted locally to Twilio PCMU and cached per call. |
| `OPENAI_LIVE_MALE_VOICE`, `OPENAI_LIVE_FEMALE_VOICE` | Fixed `cedar`, `marin`; optional legacy settings must match. Approved snapshots freeze the concrete voice ID. |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime-2.1` |
| `OPENAI_TRANSCRIPTION_MODEL` | `gpt-realtime-whisper` for the Realtime driver/legacy hybrid only; unified Live uses native transcripts |
| `OPENAI_TRANSCRIPTION_DELAY` | `high`; accepts minimal/low/medium/high/xhigh |
| `OPENAI_POST_CALL_TRANSCRIPTION_MODEL` | `gpt-transcribe`, full-file fallback |
| `OPENAI_POST_CALL_UTTERANCE_TRANSCRIPTION_MODEL` | Runtime default `gpt-4o-transcribe`, normal stereo path |
| `OPENAI_REALTIME_MALE_VOICE`, `OPENAI_REALTIME_FEMALE_VOICE` | `cedar`, `marin` |

Unified Live starts with no tools while the application plays the exact Speech API
disclosure. Recipient audio still reaches Live immediately; barge-in clears playback and
causes a complete cached replay after the recipient stops. Only an uninterrupted matching
Twilio mark opens consent recognition; pre-mark speech is not reused as affirmative
consent. The default `semantic_native` mode exposes `report_consent` with a strict
decision enum after the existing 900 ms settle window. Admin System can select
`hybrid_deterministic_v1` for new attempts: a bounded phrase classifier runs after
200 ms settle, and only unclear candidates enable semantic delegation at the original
900 ms total window. The unchanged activity detector adds its own 600 ms silence
window. Live deltas have no finality signal, so a delayed qualification can arrive
after a hybrid decision. Semantic `unclear` retains the existing clarification and
DTMF recovery. A delayed native transcript is
compared with the same audio-time boundary. Task tools (`end_call`, and authorized appointment tools)
become available after recording
startup and playback of any optional assistance disclosure. Live then receives a
purpose/readiness instruction; the ordinary opening has no exact-script playback
gate. `end_call` accepts a reason only, not a recap. Consent
uses `live_delegation` when semantic interpretation is needed; deterministic decisions
do not initiate a consent delegation. No new `live_consent_classification` operations are created.
Speech synthesis is accounted under `live_disclosure_synthesis`; only protected
appointment speech retains semantic pre-playback verification. Closing uses the
normal tool-result/backend continuation, followed by a bounded completion check
and playback confirmation; it does not verify business truth after speech.
The historical consent
stage stays readable for accounting. See [runtime details](archive/live-unified-runtime.md)
and [real-call evidence](archive/live-call-review-2026-09-28.md). Source migrations extend through 0100.
Migration 0100 stores the revisioned consent mode and pins its policy to each attempt;
existing attempts without a saved policy retain native semantic behavior. Changing the
mode requires an active superadmin, the current revision and an audited reason. Unified
Live persists linked disclosure playback, consent decision/method and recording request/start
events without storing the recipient's pre-consent speech. Initial disclosure text,
approved snapshots and the optional assistance reason are unchanged. See the
[hybrid implementation report](hybrid-consent-implementation-2026-10-04.md).
See [voice continuity](archive/live-voice-continuity-2026-09-28.md) for the two-voice catalog,
provider confirmation checks and manual acoustic acceptance.

Live protocol errors are command-scoped. The runtime correlates `error.client_event_id`, retries
an explicit rejection once, does not retry ambiguous acknowledgement timeouts, and continues past
late or uncorrelated command errors. Only a closed connection/session or an exhausted active
command/delegation enters the bounded failure-close path. Safe protocol fields are persisted as
`realtime.error`; provider messages and conversational content are not stored in that event.

The [28 September simplification report](archive/live-simplification-implementation-2026-09-28.md)
records shared approved context, grounded next-step statements, compiler version 6
and neutral/formal defaults with superadmin-only overrides. The local API was
restarted at 17:56 CEST with Live/fallback=false; health and database readiness passed.
See local testing (local operational document; excluded from Git)
for new-plan versus historical-approval behavior and the remaining manual checks.

Native Live speaking pace is defined in `buildLiveInstructions`, with a reminder
in `UnifiedLiveCall` controlled speech: calm, slightly slower than ordinary
conversation, brief sentence pauses and clear names/dates/numbers. It applies to
both voices and all call stages. There is no speed environment variable, numeric
playback-rate setting or form control. Restart API/embedded worker after prompt
changes so subsequent sessions use the new instructions; no database migration or
new plan approval is required for a pace-only change.

Model strings are configurable identifiers in this code snapshot. Verify access and
behavior with approved live-provider evidence before deployment; the automated audit
does not call providers. The worker processes one durable call job at a time per
instance; ASR can make four concurrent utterance requests inside that job. Default
poll interval is one second, lease duration 120 seconds and worker heartbeat interval
five seconds. These are code options, not documented environment variables.

The seven job types include delayed provider_call_cost_reconciliation and a separate
text_artifact_generation worker loop. Text artifact jobs persist successful chunks,
cap provider requests at 24 across three generations total (initial plus two manual
retries), allow three automatic attempts per generation, and fence source revision
plus worker/generation/attempt. A queued retry/backoff remains `queued`; `retryable`
is server-derived from terminal job state, budgets and failure classification.
`Retry-After` defers the job by at most 15 minutes. Optional summary compaction failure
preserves validated findings. See [artifact semantics](architecture.md#plan-translations-and-result-artifacts).
Compiler
requests share a cumulative preparation budget; transcription retries reuse persisted
successful chunks. Provider usage, reported costs and versioned calculated rates are
separate from configured minute-based fallback estimates.

Plan preparation distinguishes a provider failure from a policy rejection. The
browser waits up to eight minutes across polling and recovery attempts for an
explicit submission, reporting queued/preparing/retrying/delayed state in a
viewport-fixed panel. This is a recovery allowance, not a normal latency target;
reaching the deadline leaves the server operation running and shows a pending
message. Retrying unchanged input reuses its operation key. Only a server-confirmed
terminal failure retires that key. An explicit resubmit of an older uncertain
operation may create one replacement after confirming failure; a failed fresh
operation stops. Creation, editing and clarification answers use this recovery
rule. No retry approves a plan or starts a call. Existing configured timeout values
remain overrides; updating code alone does not replace an explicit 25-second value.
The compiler sets `max_output_tokens: 20_000`, including reasoning, with compact
JSON and low verbosity. Incomplete Responses envelopes are rejected and retain
usage evidence. Earlier [latency measurements](archive/plan-preparation-quality-2026-09-15.md)
were taken at a 5,000-token ceiling and are not a benchmark of the new ceiling.

Preparation transport diagnostics are stored with each provider result (schema
0101) and shown in the existing admin preparation inspector. They distinguish
database reservation, request/socket/body-send offsets, response headers, body
read/parse and allowlisted network errors. Worker attempt history and retry gaps
come from the existing durable job ledger. Optional processing/rate-limit headers
are numeric only; request IDs and usage correlate the measurements. Missing
historical/transport evidence remains unknown. Offsets overlap and must not be
summed; waiting for headers alone cannot prove a provider-internal cause.
No prompt, raw header, URL, exception message or audio is added to these fields.
See [measurements and interpretation](preparation-latency-diagnostics-2026-10-04.md).

## Recent configuration and workers

The current schema catalog ends at **0101**. Catalog availability is not deployment evidence. Operational procedures are local-only.

| Setting / subsystem | Current behavior |
| --- | --- |
| `OPENAI_ADMIN_API_KEY`, `OPENAI_PROJECT_ID` | Optional server-only, project-scoped Costs API sync; missing credentials produce not-configured status rather than zero costs |
| Twilio billing | Uses existing account SID/auth token; account-level daily context is separate from call charges |
| Billing worker | PostgreSQL-only; runs on worker startup and hourly under advisory locking; manual API command `billing:sync` / `billing:sync:prod` |
| Superadmin notifications | PostgreSQL queue/settings, disabled by default; returned-plan alerts support all returns or signals-only; API and worker need EMAIL_DRIVER/RESEND_API_KEY/EMAIL_FROM/public site origin; recipients/categories are configured in Admin System |
| `ADMIN_TELEMETRY_EXPORT_ENABLED` | Enabled with PostgreSQL unless exactly `false`; use the same setting on API and worker; memory reports unavailable |
| Export worker | Embedded API or external worker according to DURABLE_WORKER_MODE; independent 2-second queue poll, one global builder, Calls panel heartbeat; PostgreSQL 17 |
| Export storage | Same database/keyring; encrypted parts ≤1 MiB, ready TTL at most 24 hours and no later than the earliest eligible source retention deadline, source-deletion/access-change revocation; cleanup requires running consumer |
| Analytics | Revisioned beta settings exposed via protected Admin System API; public read returns tracker settings; consent/acknowledgement policy is separate |
| Homepage OG | No external image service; migration 0078, bundled logo/font and seven fallback PNGs; API build copies assets |

Details: [notifications](archive/superadmin-notifications.md), [current export contract and limits](engineer-guide.md#telemetry-transcripts-and-audio-export),
[Analytics/locales](archive/localization-and-analytics.md), [OG publication](archive/home-og-images.md).

## Language and generated-text endpoints

Language preferences are separate from UI routing and the immutable executable plan.
Mutations use the existing session/origin/ownership/deletion boundaries; artifact
reads are private and never authorize access by artifact UUID alone. Cached ready
results return `200`; queued generation returns `202`. Original transcript and retained
ready artifacts remain readable when a direction is disabled.

| Method | Path | Purpose |
| --- | --- | --- |
| PATCH | `/api/account/language-preferences` | Account UI/content-language preferences |
| GET | `/api/language-capabilities` | Enabled text operations/directions and selectable call locales |
| GET | `/api/call-briefs/:id/language-context` | Captured task language resolution and selection revision |
| PATCH | `/api/call-briefs/:id/content-language` | Pre-approval task choice with expected selection revision |
| POST | `/api/call-briefs/:id/plan-review` | Translate the exact compilation ID/revision/hash; also serves clarification review according to the plan state |
| GET | `/api/call-briefs/:id/text-artifacts` | Owner's generated-text states/results |
| GET | `/api/call-briefs/:id/text-artifacts/:artifactId` | One owner-scoped artifact |
| POST | `/api/call-briefs/:id/final-transcript/translations` | Translate the current immutable transcript revision |
| POST | `/api/call-briefs/:id/summaries` | Strict schema-2 compact summary/findings from original transcript and executed plan |
| POST | `/api/call-briefs/:id/text-artifacts/:artifactId/retry` | Bounded retry of a current failed artifact |

New approval requests include exact revision/hash and original/translated review
evidence. A translated review names the ready artifact ID/hash, language and selection
revision. Legacy v1 applies only to exact pre-cutover approved compilations; new or
unapproved plans require v2 receipts. New call choices use British English (`en-GB`);
historical `en-US` remains readable. See [architecture](architecture.md) for source
identity and lifecycle details.

## Admission and endpoint budgets

PostgreSQL API/worker use the versioned **Beta access and spending** settings in
`/admin/system`, introduced by migration 0070. The `CALL_MAX_*` variables below
are fallback values for memory/test mode. Initial PostgreSQL settings: open public
cap 30, additional one-use invitations, maximum 420 seconds, 1 call/account and
2 globally, 3 starts/hour and 10/UTC day per account, 2 starts/recipient/rolling 24 h
across all accounts. The USD amount for the last 24 hours is initially unset and
blocks paid requests until a superadmin configures it. Values and pause switch are
shared by API and worker without restart; existing calls keep their admitted duration.
The admission ledger now reconciles eligible reserves with provider charges and
calculated usage; unknown costs remain pending. Moderation is free. Migration 0072
adds the attempt lookup index. The admin view separates reported/calculated costs,
pending reserves and remaining budget. See [current accounting and local calibration](archive/budget-accounting-2026-09-15.md)
and [admission/operator procedure](archive/beta-controls-2026-09-14.md). Local revision 3
(20 USD/24 h, 0.60 USD/min, 0.15 USD/paid text) is not a production default.

| Variable | Default |
| --- | --- |
| `CALL_MAX_STARTS_PER_HOUR` | 3 |
| `CALL_MAX_STARTS_PER_DAY` | 10, UTC-day admission window |
| `CALL_MAX_STARTS_PER_RECIPIENT_PER_DAY` | 2, UTC-day admission window |
| `CALL_MAX_DURATION_SECONDS` | 900 |
| `API_RATE_LIMIT_BRIEF_PREPARATION_PER_HOUR` | 15 |
| `API_RATE_LIMIT_CALL_START_PER_15_MINUTES` | 10 |
| `API_RATE_LIMIT_PROMO_REDEMPTION_PER_HOUR` | 10 |
| `API_RATE_LIMIT_RECORDING_DOWNLOAD_PER_HOUR` | 30 |
| `API_RATE_LIMIT_TRANSCRIPTION_RETRY_PER_DAY` | 5 |
| `API_RATE_LIMIT_TEXT_ARTIFACTS_PER_HOUR` | 30 |
| `API_RATE_LIMIT_DATA_EXPORT_PER_DAY` | 2 |
| `API_RATE_LIMIT_CALL_DATA_DELETION_PER_DAY` | 5 |
| `API_RATE_LIMIT_ACCOUNT_DELETION_PER_DAY` | 3 |

Endpoint values are user budgets; IP budgets are five times larger. Auth, recovery,
phone/email change and public opt-out also have code-owned limits. See the
[rate policy](archive/rate-limit-policy.md) and auth service for those controls.

## Public recipient opt-out contract

`POST /api/recipient-opt-out/verification` accepts a Swiss `phoneE164` and optional `uiLocale`.
After input validation and rate limiting it returns HTTP 202 with
`{ status: "verification_required", challengeToken }`, including when no SMS is sent
because there is no contact evidence, an existing suppression, a cooldown or a
provider-send failure. The token is 64 hexadecimal characters; it is not evidence
that an SMS was delivered.

`POST /api/recipient-opt-out/confirm` requires `phoneE164`, `code` and that
`challengeToken`. Only a matching, active, sent challenge reaches the dedicated Verify
Service. Success returns `{ status: "suppressed" }`; invalid/expired/consumed proof
returns `INVALID_OPT_OUT_VERIFICATION`. Request limits are 3/phone and 10/IP per hour;
confirmation limits are 8/phone and 20/IP per 15 minutes. Each challenge also has
eight attempts, a ten-minute lifetime and a thirty-second verification lease.

Apply migration 0075 and configure both new settings before starting the API/worker;
startup backfills trusted historical contact in batches. Deploy matching web/API
versions because older clients do not send the required token. See
[eligibility, backfill and operations](archive/recipient-opt-out.md).

## Selectable call languages

`GET /api/language-capabilities` advertises current call choices `de-CH`, `fr-CH`,
`it-CH`, `en-GB`, plus `ru-RU` only for a superadmin. Historical `de-DE`/`en-US`
remain in persisted schemas but are not selectable capabilities.

## Operations-only configuration

Database cutover commands: pnpm db:backfill:call-plans,
pnpm db:classify:legacy-call-plans and pnpm db:verify:call-plan-cutover.
The last is a read-only gate required before migration 0061; follow the
[staged rollout](archive/approved-call-plan-cost-security-roadmap.md#migration-and-rollout-sequence).

| Variable/group | Meaning |
| --- | --- |
| `ADMIN_COST_PRICING_VERSION` | Required if any cost rate is configured; otherwise estimates are unavailable |
| `ADMIN_COST_TELEPHONY_USD_MICROS_PER_MINUTE` | Optional nonnegative integer connected-minute estimate |
| `ADMIN_COST_REALTIME_USD_MICROS_PER_MINUTE` | Optional nonnegative integer connected-minute estimate |
| `ADMIN_COST_TRANSCRIPTION_USD_MICROS_PER_MINUTE` | Optional nonnegative integer recorded-minute estimate |
| `DATA_ENCRYPTION_REENCRYPT_CONFIRM` | Must equal active key ID; rotation verifies every ciphertext column in `src/db/encrypted-columns.ts` |
| `DATA_ENCRYPTION_REENCRYPT_BATCH_SIZE` | 1–500; default 100 |
| `RECOVERY_SOURCE_DATABASE_URL` | Overrides DATABASE_URL for the local recovery drill |
| `RECOVERY_POSTGRES_CONTAINER` | Explicit Docker PostgreSQL container, otherwise discovered through Compose |
| `CLOUDFLARED_PATH` | Tunnel executable override; helper otherwise uses the Windows installation or PATH and always targets port 4001 |
| `REAL_CALL_DRILL_REVISION`, `REAL_CALL_DRILL_SNAPSHOT_HASH`, `REAL_CALL_DRILL_MODE`, `REAL_CALL_DRILL_EMAIL`, `REAL_CALL_DRILL_PASSWORD`, `REAL_CALL_DRILL_TARGET`, `REAL_CALL_DRILL_IDEMPOTENCY_KEY`, `REAL_CALL_DRILL_CONFIRM`, `REAL_CALL_DRILL_API_URL` | Two-stage runner: prepare (default), then reviewed/authorized start; existing verified account only. See drill procedure (local operational document; excluded from Git) |
| `REAL_CALL_DRILL_CALL_ID`, `REAL_CALL_DRILL_EXPECT` | Prepared call UUID for start/inspector; inspector `worker_backlog`/`settled` expectation |

The CLI start implementation currently submits revision/hash without v2 review
evidence; a new plan without an existing receipt is rejected with `CALL_REVIEW_REQUIRED`.
Use the signed-in UI for current supervised starts. This limitation and the pending
CLI/harness update are R06; the environment variables do not provide that missing evidence.

One dollar is 1,000,000 micros. The three optional minute rates above are coarse
fallback estimates. The separate provider ledger records requests/usage for compilation,
Realtime, native Live duration, Responses delegation, consent recognition, ASR and text artifacts, alongside reported/calculated
amounts. Neither is an invoice reconciliation system.

The outbound-control CLI accepts `enable|disable` and a reason as command arguments:
`corepack pnpm --filter @callassist/api calls:disable "reviewed incident reason"`
(or `calls:enable`). It requires PostgreSQL access, has no browser-session RBAC and
uses privileged operational database credentials. Restrict execution accordingly;
the normal admin API preserves the admin-disable/superadmin-enable role distinction.

## API conventions

The list below is extracted from registrations in [app.ts](../apps/api/src/app.ts),
[OG routes](../apps/api/src/og/og-routes.ts) and
[telemetry routes](../apps/api/src/telemetry-export/routes.ts).
It is a route inventory, not a generated OpenAPI specification. Schemas/DTOs come
from [contracts](../packages/contracts/src/index.ts); method-specific authorization
and errors remain in each handler. Content/auth/admin routes are mounted when their
services are supplied; the normal entry point supplies them.

Browser writes enforce allowed supplied Origin, session and the appropriate role or
owner. Public auth/opt-out routes apply their challenge/limiter rules instead.
Provider routes use Twilio signatures; media also requires the scoped stream token.
Onboarding acceptance is required for call/credit/admin access, while recovery and
account lifecycle endpoints retain their own eligibility rules.

Initial creation uses `POST /api/call-preparations`, required UUID `Idempotency-Key`,
`202`, and owner-only `GET /api/call-preparations/:id`. Replay is `202` even when
already succeeded. The status includes the eventual call ID; load that call's
snapshot before navigation. `POST /api/call-briefs` is absent. Existing-brief edit
and recompile also enqueue durable preparation with UUID idempotency and return 202.
Approval/start require reviewed revision and snapshotHash; stale plans fail.

Errors use controlled codes; field validation can include structured issues.
Rate denial is `429` plus `Retry-After`; limiter outage is `503` except the documented
generic recovery-send path. Owner-call misses and foreign IDs share `CALL_NOT_FOUND`.
SSE uses authenticated cookies, a snapshot followed by events, five-second comments
as heartbeats and snapshot refresh after reconnect. Sensitive/export/media responses
use their handler-specific no-store/private boundaries.

SSE rechecks durable session, account, role, current onboarding and ownership before
every private frame and five-second heartbeat. Checks time out after two seconds;
revocation or lookup failure closes the stream. Idle revocation is detected within
seven seconds under a responsive event loop. At most 64 frames may queue; backpressure
closes the connection so the client can reconnect to canonical state.

Transcript SSE uses matching part identity for delta/final and `transcript.discarded`
for cancelled or failed partials. The client merges finalized events immediately,
guards against stale HTTP snapshots and refreshes after reconnect. Draft deltas are
not durable replay history. See [live state](architecture.md#jobs-live-state-and-operations).

<!-- route-inventory -->

## Registered routes

Generated from source route declarations on 2026-10-01. Template placeholders such
as `{action}` represent a bounded route family; inspect the linked module for its
allowed actions, authorization and validation. This inventory does not imply that
an optional subsystem is enabled in a particular environment.

| Method | Path | Declaration |
| --- | --- | --- |
| POST | `/api/account/data-export` | [app.ts:1068](../apps/api/src/app.ts#L1068) |
| GET | `/api/account/deletion` | [app.ts:1100](../apps/api/src/app.ts#L1100) |
| POST | `/api/account/deletion` | [app.ts:1112](../apps/api/src/app.ts#L1112) |
| PATCH | `/api/account/language-preferences` | [app.ts:1030](../apps/api/src/app.ts#L1030) |
| PATCH | `/api/account/profile/name` | [app.ts:1041](../apps/api/src/app.ts#L1041) |
| GET | `/api/admin/call-outcome-metrics` | [app.ts:1631](../apps/api/src/app.ts#L1631) |
| GET | `/api/admin/call-preparations/:id` | [app.ts:1948](../apps/api/src/app.ts#L1948) |
| GET | `/api/admin/calls` | [app.ts:1860](../apps/api/src/app.ts#L1860) |
| GET | `/api/admin/calls/:id` | [app.ts:1912](../apps/api/src/app.ts#L1912) |
| GET | `/api/admin/calls/:id/cost` | [app.ts:1930](../apps/api/src/app.ts#L1930) |
| POST | `/api/admin/calls/:id/sensitive-access` | [app.ts:1968](../apps/api/src/app.ts#L1968) |
| GET | `/api/admin/content/editorial/:key` | [app.ts:1373](../apps/api/src/app.ts#L1373) |
| PUT | `/api/admin/content/editorial/:key/draft` | [app.ts:1462](../apps/api/src/app.ts#L1462) |
| POST | `/api/admin/content/editorial/:key/drafts` | [app.ts:1438](../apps/api/src/app.ts#L1438) |
| GET | `/api/admin/content/editorial/:key/preview` | [app.ts:1394](../apps/api/src/app.ts#L1394) |
| POST | `/api/admin/content/editorial/:key/publish` | [app.ts:1494](../apps/api/src/app.ts#L1494) |
| GET | `/api/admin/content/editorial/:key/revisions` | [app.ts:1417](../apps/api/src/app.ts#L1417) |
| POST | `/api/admin/content/editorial/:key/revisions/:revisionNumber/rollback` | [app.ts:1523](../apps/api/src/app.ts#L1523) |
| GET | `/api/admin/content/og` | [og-routes.ts:9](../apps/api/src/og/og-routes.ts#L9) |
| POST | `/api/admin/content/og/:locale/{action}` | [og-routes.ts:30](../apps/api/src/og/og-routes.ts#L30) |
| GET | `/api/admin/content/pages` | [app.ts:1195](../apps/api/src/app.ts#L1195) |
| GET | `/api/admin/content/pages/:key` | [app.ts:1203](../apps/api/src/app.ts#L1203) |
| PUT | `/api/admin/content/pages/:key/draft` | [app.ts:1281](../apps/api/src/app.ts#L1281) |
| POST | `/api/admin/content/pages/:key/drafts` | [app.ts:1262](../apps/api/src/app.ts#L1262) |
| GET | `/api/admin/content/pages/:key/preview` | [app.ts:1223](../apps/api/src/app.ts#L1223) |
| POST | `/api/admin/content/pages/:key/publish` | [app.ts:1311](../apps/api/src/app.ts#L1311) |
| GET | `/api/admin/content/pages/:key/revisions` | [app.ts:1245](../apps/api/src/app.ts#L1245) |
| POST | `/api/admin/content/pages/:key/revisions/:revisionNumber/rollback` | [app.ts:1338](../apps/api/src/app.ts#L1338) |
| POST | `/api/admin/credit-grants` | [app.ts:1614](../apps/api/src/app.ts#L1614) |
| GET | `/api/admin/operations/overview` | [app.ts:1639](../apps/api/src/app.ts#L1639) |
| POST | `/api/admin/promo-codes` | [app.ts:1598](../apps/api/src/app.ts#L1598) |
| POST | `/api/admin/recipient-suppressions` | [app.ts:2161](../apps/api/src/app.ts#L2161) |
| POST | `/api/admin/recipient-suppressions/lift` | [app.ts:2177](../apps/api/src/app.ts#L2177) |
| GET | `/api/admin/safety/plan-reviews/:id` | [plan-review-routes.ts:33](../apps/api/src/safety/plan-review-routes.ts#L33) |
| PATCH | `/api/admin/safety/plan-reviews/:id` | [plan-review-routes.ts:43](../apps/api/src/safety/plan-review-routes.ts#L43) |
| POST | `/api/admin/safety/plan-reviews/:id/emails/:deliveryId/retry` | [plan-review-routes.ts:50](../apps/api/src/safety/plan-review-routes.ts#L50) |
| POST | `/api/admin/safety/plan-reviews/:id/sensitive-access` | [plan-review-routes.ts:37](../apps/api/src/safety/plan-review-routes.ts#L37) |
| GET | `/api/admin/system` | [app.ts:1658](../apps/api/src/app.ts#L1658) |
| GET | `/api/admin/system/analytics` | [app.ts:1676](../apps/api/src/app.ts#L1676) |
| PUT | `/api/admin/system/analytics` | [app.ts:1682](../apps/api/src/app.ts#L1682) |
| GET | `/api/admin/system/beta` | [app.ts:1694](../apps/api/src/app.ts#L1694) |
| PUT | `/api/admin/system/beta` | [app.ts:1766](../apps/api/src/app.ts#L1766) |
| PUT | `/api/admin/system/beta/credit-policy` | [app.ts:1700](../apps/api/src/app.ts#L1700) |
| POST | `/api/admin/system/beta/credits/apply` | [app.ts:1720](../apps/api/src/app.ts#L1720) |
| GET | `/api/admin/system/beta/credits/preview` | [app.ts:1713](../apps/api/src/app.ts#L1713) |
| POST | `/api/admin/system/beta/invitations` | [app.ts:1778](../apps/api/src/app.ts#L1778) |
| POST | `/api/admin/system/beta/invitations/:id/revoke` | [app.ts:1788](../apps/api/src/app.ts#L1788) |
| POST | `/api/admin/system/jobs/:jobId/retry` | [app.ts:1826](../apps/api/src/app.ts#L1826) |
| GET | `/api/admin/system/notifications` | [app.ts:1730](../apps/api/src/app.ts#L1730) |
| PUT | `/api/admin/system/notifications` | [app.ts:1738](../apps/api/src/app.ts#L1738) |
| GET | `/api/admin/system/outbound-calls` | [app.ts:1666](../apps/api/src/app.ts#L1666) |
| PUT | `/api/admin/system/outbound-calls` | [app.ts:1801](../apps/api/src/app.ts#L1801) |
| PUT | `/api/admin/system/registration` | [app.ts:1754](../apps/api/src/app.ts#L1754) |
| GET | `/api/admin/telemetry-exports` | [routes.ts:22](../apps/api/src/telemetry-export/routes.ts#L22) |
| POST | `/api/admin/telemetry-exports` | [routes.ts:30](../apps/api/src/telemetry-export/routes.ts#L30) |
| GET | `/api/admin/telemetry-exports/:id` | [routes.ts:41](../apps/api/src/telemetry-export/routes.ts#L41) |
| POST | `/api/admin/telemetry-exports/:id/{action}` | [routes.ts:46](../apps/api/src/telemetry-export/routes.ts#L46) |
| GET | `/api/admin/telemetry-exports/:id/download` | [routes.ts:52](../apps/api/src/telemetry-export/routes.ts#L52) |
| POST | `/api/admin/telemetry-exports/preview` | [routes.ts:36](../apps/api/src/telemetry-export/routes.ts#L36) |
| GET | `/api/admin/users` | [app.ts:1996](../apps/api/src/app.ts#L1996) |
| POST | `/api/admin/users/:userId/account-deletion/:requestId/retry` | [app.ts:2132](../apps/api/src/app.ts#L2132) |
| GET | `/api/admin/users/:userId/credits` | [app.ts:2049](../apps/api/src/app.ts#L2049) |
| POST | `/api/admin/users/:userId/sessions/revoke` | [app.ts:2106](../apps/api/src/app.ts#L2106) |
| PUT | `/api/admin/users/:userId/status` | [app.ts:2078](../apps/api/src/app.ts#L2078) |
| GET | `/api/analytics` | [app.ts:257](../apps/api/src/app.ts#L257) |
| POST | `/api/auth/email-change/confirm` | [app.ts:1002](../apps/api/src/app.ts#L1002) |
| POST | `/api/auth/email-change/start` | [app.ts:973](../apps/api/src/app.ts#L973) |
| POST | `/api/auth/email-verification/confirm` | [app.ts:960](../apps/api/src/app.ts#L960) |
| POST | `/api/auth/email-verification/defer` | [app.ts:637](../apps/api/src/app.ts#L637) |
| POST | `/api/auth/email-verification/start` | [app.ts:947](../apps/api/src/app.ts#L947) |
| POST | `/api/auth/login` | [app.ts:730](../apps/api/src/app.ts#L730) |
| POST | `/api/auth/logout` | [app.ts:867](../apps/api/src/app.ts#L867) |
| GET | `/api/auth/me` | [app.ts:937](../apps/api/src/app.ts#L937) |
| POST | `/api/auth/phone-change/confirm` | [app.ts:839](../apps/api/src/app.ts#L839) |
| POST | `/api/auth/phone-change/start` | [app.ts:810](../apps/api/src/app.ts#L810) |
| POST | `/api/auth/recovery/complete` | [app.ts:790](../apps/api/src/app.ts#L790) |
| POST | `/api/auth/recovery/start` | [app.ts:749](../apps/api/src/app.ts#L749) |
| POST | `/api/auth/recovery/verify` | [app.ts:770](../apps/api/src/app.ts#L770) |
| POST | `/api/auth/register` | [app.ts:646](../apps/api/src/app.ts#L646) |
| GET | `/api/auth/registration-options` | [app.ts:629](../apps/api/src/app.ts#L629) |
| GET | `/api/auth/sessions` | [app.ts:893](../apps/api/src/app.ts#L893) |
| DELETE | `/api/auth/sessions/:sessionId` | [app.ts:908](../apps/api/src/app.ts#L908) |
| POST | `/api/auth/sessions/revoke` | [app.ts:878](../apps/api/src/app.ts#L878) |
| POST | `/api/auth/verification/phone` | [app.ts:698](../apps/api/src/app.ts#L698) |
| POST | `/api/auth/verification/resend` | [app.ts:681](../apps/api/src/app.ts#L681) |
| POST | `/api/auth/verify-phone` | [app.ts:708](../apps/api/src/app.ts#L708) |
| GET | `/api/call-briefs` | [app.ts:2220](../apps/api/src/app.ts#L2220) |
| GET | `/api/call-briefs/:id` | [app.ts:2450](../apps/api/src/app.ts#L2450) |
| PUT | `/api/call-briefs/:id` | [app.ts:2509](../apps/api/src/app.ts#L2509) |
| POST | `/api/call-briefs/:id/{path}` | [app.ts:2335](../apps/api/src/app.ts#L2335) |
| POST | `/api/call-briefs/:id/approvals/:approvalId` | [app.ts:2837](../apps/api/src/app.ts#L2837) |
| POST | `/api/call-briefs/:id/approve` | [app.ts:2742](../apps/api/src/app.ts#L2742) |
| POST | `/api/call-briefs/:id/approve-and-start` | [app.ts:2763](../apps/api/src/app.ts#L2763) |
| PATCH | `/api/call-briefs/:id/content-language` | [app.ts:2295](../apps/api/src/app.ts#L2295) |
| POST | `/api/call-briefs/:id/data-deletion` | [app.ts:2637](../apps/api/src/app.ts#L2637) |
| GET | `/api/call-briefs/:id/events` | [app.ts:2862](../apps/api/src/app.ts#L2862) |
| PUT | `/api/call-briefs/:id/feedback` | [app.ts:2480](../apps/api/src/app.ts#L2480) |
| POST | `/api/call-briefs/:id/final-transcript/retry` | [app.ts:2709](../apps/api/src/app.ts#L2709) |
| GET | `/api/call-briefs/:id/language-context` | [app.ts:2290](../apps/api/src/app.ts#L2290) |
| GET | `/api/call-briefs/:id/outcome` | [app.ts:2463](../apps/api/src/app.ts#L2463) |
| POST | `/api/call-briefs/:id/plan-review` | [app.ts:2321](../apps/api/src/app.ts#L2321) |
| DELETE | `/api/call-briefs/:id/recording` | [app.ts:2621](../apps/api/src/app.ts#L2621) |
| GET | `/api/call-briefs/:id/recording` | [app.ts:2591](../apps/api/src/app.ts#L2591) |
| POST | `/api/call-briefs/:id/recording-transcript` | [app.ts:2684](../apps/api/src/app.ts#L2684) |
| POST | `/api/call-briefs/:id/repeat` | [app.ts:2734](../apps/api/src/app.ts#L2734) |
| POST | `/api/call-briefs/:id/start` | [app.ts:2796](../apps/api/src/app.ts#L2796) |
| POST | `/api/call-briefs/:id/stop` | [app.ts:2821](../apps/api/src/app.ts#L2821) |
| GET | `/api/call-briefs/:id/text-artifacts` | [app.ts:2309](../apps/api/src/app.ts#L2309) |
| GET | `/api/call-briefs/:id/text-artifacts/:artifactId` | [app.ts:2314](../apps/api/src/app.ts#L2314) |
| POST | `/api/call-briefs/:id/text-artifacts/:artifactId/retry` | [app.ts:2349](../apps/api/src/app.ts#L2349) |
| POST | `/api/call-preparations` | [app.ts:2361](../apps/api/src/app.ts#L2361) |
| GET | `/api/call-preparations/:id` | [app.ts:2432](../apps/api/src/app.ts#L2432) |
| GET | `/api/content/faq` | [app.ts:509](../apps/api/src/app.ts#L509) |
| GET | `/api/content/index` | [app.ts:503](../apps/api/src/app.ts#L503) |
| GET | `/api/content/landing` | [app.ts:526](../apps/api/src/app.ts#L526) |
| GET | `/api/content/navigation` | [app.ts:543](../apps/api/src/app.ts#L543) |
| GET | `/api/content/og` | [og-routes.ts:8](../apps/api/src/og/og-routes.ts#L8) |
| GET | `/api/content/pages/:slug` | [app.ts:562](../apps/api/src/app.ts#L562) |
| POST | `/api/credits/promo-redemptions` | [app.ts:1573](../apps/api/src/app.ts#L1573) |
| GET | `/api/language-capabilities` | [app.ts:2279](../apps/api/src/app.ts#L2279) |
| POST | `/api/onboarding/accept` | [app.ts:1172](../apps/api/src/app.ts#L1172) |
| GET | `/api/onboarding/status` | [app.ts:1152](../apps/api/src/app.ts#L1152) |
| POST | `/api/recipient-opt-out/confirm` | [app.ts:603](../apps/api/src/app.ts#L603) |
| POST | `/api/recipient-opt-out/verification` | [app.ts:582](../apps/api/src/app.ts#L582) |
| GET | `/api/recipient-suggestions` | [app.ts:2253](../apps/api/src/app.ts#L2253) |
| GET | `/api/usage` | [app.ts:1561](../apps/api/src/app.ts#L1561) |
| GET | `/health/live` | [app.ts:2194](../apps/api/src/app.ts#L2194) |
| GET | `/health/ready` | [app.ts:2200](../apps/api/src/app.ts#L2200) |
| POST | `/webhooks/twilio/amd` | [app.ts:3216](../apps/api/src/app.ts#L3216) |
| GET | `/webhooks/twilio/media` | [app.ts:3267](../apps/api/src/app.ts#L3267) |
| POST | `/webhooks/twilio/recording` | [app.ts:3370](../apps/api/src/app.ts#L3370) |
| POST | `/webhooks/twilio/status` | [app.ts:3282](../apps/api/src/app.ts#L3282) |
| POST | `/webhooks/twilio/voice` | [app.ts:3123](../apps/api/src/app.ts#L3123) |
| POST | `/webhooks/twilio/voicemail-complete` | [app.ts:3240](../apps/api/src/app.ts#L3240) |
