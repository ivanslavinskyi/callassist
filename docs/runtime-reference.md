# Runtime and API reference

Updated 2026-11-11 for holistic preparation and appointment contract repair, schema `0001`–`0116`.
Current domain behavior is documented in [the engineer guide](engineer-guide.md).
The route inventory below links to source registration modules. Configuration values describe
the repository defaults, not provider availability, supported pricing or a deployed
environment. Exact locked package versions are in [pnpm-lock.yaml](../pnpm-lock.yaml).

## Current administrative controls and diagnostics

- Versioned beta credits: PUT `/api/admin/system/beta/credit-policy`, GET `/api/admin/system/beta/credits/preview`, POST `/api/admin/system/beta/credits/apply`.
- Returned-plan list/detail/triage and reasoned sensitive access under `/api/admin/safety/plan-reviews`.
- POST `/api/admin/telemetry-exports/preview`; `includeAudio` defaults true for new exports.
- `CALL_PREPARATION_TIMEOUT_MS` defaults to 120000 including queue/retries. Generation request timeout is 35000 ms; public progress exposes five localized provider stages.
- Stage metadata stores planned pre-journal budgets; actual completion timing comes from result timestamps.
- Runtime descriptor metadata is frozen for new attempts; historical missing metadata remains null.
- GET/PUT `/api/admin/system/voice-consent` reads or changes recognition for new attempts. The migration default remains semantic; only an active superadmin can change it with an expected revision and audit reason.
- GET/PUT `/api/admin/system/preparation` reads/updates generation profile and shared limits. Mutations require an active superadmin, expected revision and audit record; comment is optional. No report is required to select a supported model or Standard/Fast. Existing jobs keep their snapshot; audit/review remain `gpt-5.6:default`.
- GET `/api/admin/system/preparation/runtime` exposes role heartbeats, queues and aggregates to authorized admins. POST `/api/admin/system/preparation/profiles` retains optional evaluation evidence for compatibility, not an activation prerequisite.
- `/health/workers` checks fresh required worker roles independently from `/health/ready`, which checks the database and selected runtime/preparation profile alignment. See [preparation runtime](preparation-runtime.md) for capacity, fencing and shutdown boundaries.

## Voice runtime selection

The recommended profile is `CALL_RUNTIME_PROFILE=native_v2`, as selected by
`.env.example`. It binds the Native v2 voice mode, compiler 17 policy and enabled
hangup. Use [runtime profiles](runtime-profiles.md) for the audited application command,
read-only check and startup diagnostics. Without a profile, the default is managed
`unified_live` with experiment `off`; low-level Native v2 requires
`VOICE_RUNTIME_DRIVER=live`, fallback disabled, `VOICE_RUNTIME_LIVE_EXPERIMENT=native_v2`,
and `REALTIME_AGENT_HANGUP_ENABLED=true`. Production is supported; the obsolete
`VOICE_RUNTIME_NATIVE_V2_LOCAL` flag is ignored.
See the maintained [native specification](native-live-runtime.md) for complete
startup context, prompt responsibilities, action profiles, declared recording,
privacy, closing and summary-v8 behavior.

The holistic preparation path uses compiler 17 / schema 11 / approval 10 and requires
migration 0116 for independent encrypted validation diagnostics. A named
profile declares the policy; its configuration command saves it and startup validates
it. Low-level voice flags and model changes alone do not update the policy.
The settings API has no `promptVersion` setter; its read-only `runtimeProfile` field
reports the selected release, compiler, expected/actual policy and alignment.
See [preparation runtime](preparation-runtime.md) and
[dated implementation evidence](reports/native-live-integrity-2026-11-08.md).

Migrations `0110_native_live_v2.sql`, `0111_native_live_attempt_scoping.sql` and
`0112_native_appointment_actions.sql` add privacy/trace and action journals. Do not
delete applied migration records to reconcile an archived local database; use a
separate verified copy. These migrations do not enable the experiment by themselves.

### Earlier native experiment

Experimental `VOICE_RUNTIME_LIVE_EXPERIMENT=native_v1` selects `live_native_v1`
for eligible informational attempts; the default `off` retains `unified_live`.
Selection happens before prewarm and is recorded with prompt/brief hashes in the
immutable runtime descriptor. Protected appointment tasks and oversized briefs use
the managed control. Switching an already-described native attempt is rejected.
Native task speech has no task-state scheduler or energy-triggered Twilio clear;
Live also speaks the closing. Playback drain uses an experimental quiet-tail/mark
heuristic and requires telephone acceptance. Admission, disclosure, consent and
recording remain shared. See [implementation status and limits](archive/2026-11/live-native-experiment-plan-2026-11-05.md#15-реализация-на-ветке-5-ноября).

### Managed Live

The `live-managed-v9` implementation with the 2026-10-06 opening fix opens native
audio forwarding after recording admission, before sending task context. Early
speech is preserved even if it arrives before context acknowledgements. Those ACKs
gate the separate start instruction without moving the opening audio/transcript
boundary; neither its ACK nor first transcript gates the first audio packet. Protected appointment playback
retains its existing resume fence. Active farewell playback remains idempotent.
The task decision deadline is `max(answerSettledAt + 5000, lastNativeVoicedAt + 2000)`;
fresh-answer, speech and backend-occupancy checks still apply. These are server event
times, not measured telephone playback boundaries. Recording admission is unchanged.
A wholly muted assistant fragment is excluded from audible coverage; uncertain output
on protected-playback resume remains a quality issue.
See [implementation and telephone acceptance](archive/2026-10/live-runtime-stability-plan-2026-10-04.md).

## Saved transcript source

Live transcripts are primary. Recording ASR is an explicitly requested additional
source; there is no automatic recording fallback for incomplete Live capture.
Migration 0093 extends encrypted `final_transcripts` into separate per-attempt
`live` and `recording_asr` artifacts while preserving existing immutable revision IDs.
`finalTranscript`/`finalTranscriptRevision` project the primary Live source;
`recordingTranscript`/`recordingTranscriptRevision` expose the optional audio source.
Legacy attempts without Live retain their labelled existing ASR result.

`live_transcript_finalization` runs without recording availability or an ASR provider.
The existing write queue drains native deltas and acknowledged application playback.
Incomplete capture publishes useful text with quality issues, never automatic ASR.
A terminal collecting capture is recovered after a 20-second drain grace period.
In the managed path, disclosure playback and a separate consent event remain in
the primary transcript; pre-consent recipient speech is excluded. Native v2 captures
the declared-recording conversation from connection and fences/removes content on
refusal; it does not synthesize an affirmative-consent event.

The browser live transcript merges persisted fragments in arrival order followed by
pending SSE fragments, deduplicated by native session/event identity. This avoids
moving a new word ahead of the saved prefix while persistence is pending. Native
partials show their speech timestamp. It does not change saved transcript boundaries.

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
and audit reason. Defaults: `onboarding=full`, `emailVerification=required`,
`swissPhonesOnly=false`. Swiss-only applies to registration, unverified corrections,
verification/resend and account phone changes; current policy is revalidated during
database mutations. Verified foreign accounts retain login and recovery. The seven
UI locales hide country selection and change guidance when enabled. An older
settings client omitting the field preserves its current value. Outbound call
destinations are independent of this account policy.
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
refusal, granted consent and substantive conversation evidence block that path.
Native v2 has a separate eligible automatic-answer path: a recording started under
`declarative_local` does not by itself prove human conversation or block repeat after
a definitive machine outcome. The shared [retry contract](../packages/contracts/src/call-retry.ts)
and repository checks remain authoritative. Technical connection is not proof of a
human answer.
The optional repeat body `uiLocale` accepts the seven supported UI languages and
captures the interface language of the new draft; omitted values fall back to the
account UI language. New preparation requests similarly snapshot `uiLocaleHint` at
submission. Neither changes the spoken call language or an existing call's immutable
`creation_ui_locale`.
See [registration/call behavior and tests](archive/registration-and-call-improvements-2026-09-25.md).

## Call lifecycle and history

Migrations 0073/0074 add stop events and final assessments. List/snapshot/Inspector responses share the `lifecycle` projection, including `assessment_pending` and `assessment_unavailable`. Operations exposes independent `lifecycle.goals` and `userGoalFeedback` counts. Those two migrations introduce no production environment variable; migration 0075 and opt-out require the additional settings below. Apply migrations before restarting all API/worker processes; do not leave an old worker using immediate refunds. History lives at `/[locale]/app/history`. [Final assessment semantics and verification](archive/post-call-assessment-diagnosis-2026-09-15.md).

`summary-v8` creates grounded summary/findings and assessment from the executed
source context and original transcript. Context v2 uses `native-summary-v3` for
schema-9 and schema-10 general and appointment profiles, or a native action. Older contexts keep
their compatible format; legacy reports remain readable. Normal short successful
inputs need one request; eligible native inputs allow one targeted grounding repair,
separately accounted under the shared request budget. Long-call consolidation can
return explicit partial coverage. See [result semantics and limits](native-live-runtime.md#results-history-and-notifications).

Display reassessment does not rewrite canonical billing evidence. The five-minute
reservation deadline starts when termination is first processed and survives
restarts; worker maintenance releases expired reservations independently of slow
text/audio processing. Model evidence quality and transcript completeness still
affect results. Optional `eval:call-assessment` and `eval:summary-calendar` commands
are paid provider evaluations requiring `ALLOW_BILLABLE_EVAL=true`; they are not
part of ordinary documentation or offline validation.

## Owner result email delivery

Migration `0109_user_call_notifications.sql` must precede the new API/worker build.
It freezes `call_briefs.creation_ui_locale` and creates the owner outbox. Legacy
locale fallback is earliest initial preparation UI hint, account UI language, then
`en`. Only new completion transitions enqueue; there is no historical email backfill.
Reports use the exact attempt, approved compilation and original transcript revision.
See [eligibility and content rules](engineer-guide.md#owner-result-emails).

| Boundary | Current behavior |
| --- | --- |
| Eligibility | Active owner with verified email, undeleted call and no pending account deletion; qualifying conversation, not just transport connection or goal success |
| Assessment wait | Five minutes before evidence-based fallback; missing evidence rechecked every 30 seconds for at most 24 hours after completion |
| Consumer | PostgreSQL only; embedded API in development or external `background`/`all` worker; no new environment flag or superadmin-notification opt-in |
| Queue | Poll every 5 seconds, up to 10 claims per drain, 120-second claim lease; one row per attempt |
| Provider retries | Up to 8 attempts, 30-second exponential delay capped at 15 minutes, respecting a longer provider `Retry-After`; at most 20 hours from the persisted first-send window |
| Idempotency | Frozen encrypted destination/body plus original transcript revision, stable key across provider retries and process restarts |
| Privacy | Recheck recipient/source under locks before send; cancel/redact on deletion, deactivation, verification loss or destination change; accepted/cancelled bodies cleared, failed bodies purged after 7 days by consumer |
| Status | `queued`, `processing`, `accepted`, `failed`, `cancelled`; `accepted` is provider acceptance, not inbox confirmation; no owner retry/admin toggle endpoint |
| Email languages | Subject/static copy use immutable creation UI locale; saved assessment prose and full original transcript are unchanged; no translation request or transcript attachment |
| Result link | Authenticated `/<creation-ui-locale>/app/calls/<id>`, preserved through login/onboarding with a strict internal-path allow-list |

Use existing `EMAIL_DRIVER`, `RESEND_API_KEY`, `EMAIL_FROM`, encryption keyring and
`NEXT_PUBLIC_SITE_URL` consistently on API and delivering workers. Real email uses
the existing Resend spending controls. The shared branded shell embeds the inline
logo; transcript content is in HTML/text bodies. No new secret is required.

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
| `NEXT_PUBLIC_SITE_URL` | Example `http://localhost:3000` | Canonical metadata, sitemap, robots, SEO, HTTPS web HSTS; API/worker email branding and authenticated result links |
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
| `REALTIME_AGENT_HANGUP_ENABLED` | Named profiles enable hangup and reject a `false` override. Without a profile: defaults false; low-level native v2 requires true at startup/initialization. Consent/error termination remains separate. |
| `DURABLE_WORKER_MODE` | `embedded`; production requires `external` |
| `WORKER_ROLE` | `all` compatibility default; scalable roles: `preparation`, `operations`, `background`; never mix role workers with `all` |
| `PREPARATION_WORKER_SLOTS` / `REVIEW_WORKER_SLOTS` | Per-process slots; prep defaults 2/1, other roles 1/1; global limits remain in the preparation settings |
| `CALL_REPOSITORY_POOL_MAX` | Call SQL pool only: default prep 4, operations 3, background/all/API 6; 1–32; additional component pools are separate |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Required for real outbound telephony |
| `VERIFICATION_DRIVER` | Example `mock`; factory infers Twilio from real telephony if unset; production API requires explicit `twilio` |
| `TWILIO_VERIFY_SERVICE_SID` | Required for Twilio SMS verification |
| `TWILIO_OPT_OUT_VERIFY_SERVICE_SID` | Required on production API: separate Verify Service for public recipient opt-out; must differ from the account service |
| `RECIPIENT_CONTACT_HASH_KEY` | Required on production API/workers: stable independent 32-byte base64 HMAC key, identical on every process; preserves opt-out eligibility after call deletion |
| `SMS_ALLOWED_COUNTRIES` | `CH,UA`; base ISO country allow-list for account verification, independently validated from outbound-call destinations. Admin `swissPhonesOnly` further restricts account flows; it does not add CH if the base list excludes it |
| `SMS_DAILY_SEND_LIMIT`, `SMS_PER_MINUTE_SEND_LIMIT` | `100` / `10`; shared across all SMS flows; each number also has 1/minute and 3/hour limits |
| `MOCK_VERIFICATION_CODE` | `000000`, local only |
| `EMAIL_DRIVER` | `mock`; production API requires `resend` |
| `MOCK_EMAIL_VERIFICATION_CODE` | `000000`; six digits for local mock email only; real Resend uses random codes |
| `RESEND_API_KEY`, `EMAIL_FROM` | Required for real verification/change/security, superadmin and owner result emails; local sender `SHPROHLI <mail@shprohli.ch>` requires verified Resend domain |
| `NEXT_PUBLIC_SITE_URL` | Also required by the API for production email footer links: public HTTPS origin, no credentials/path/query; localhost HTTP is allowed in development. Logo is embedded as a CID PNG, independent of this URL. |
| `OPENAI_API_KEY` | Required for real Realtime/Live/Responses/ASR and OpenAI compiler |
| `BRIEF_COMPILER_DRIVER` | Example `mock`; factory infers `openai` when key exists if unset. API and worker production validation both require explicit `openai`; missing/mock is rejected |
| `OPENAI_BRIEF_COMPILER_MODEL` | `gpt-5.6` constructor fallback; pinned preparation policy supplies the generation/audit model for normal preparation jobs. Change generation through Admin System |
| `OPENAI_BRIEF_COMPILER_TIMEOUT_MS` | `120000` total compiler timeout per worker attempt; generation leaves up to 25 seconds for final moderation |
| `OPENAI_BRIEF_COMPILER_REQUEST_TIMEOUT_MS` | Unset: `35000` for plan generation/repair/language audit, `25000` for moderation. Explicit values override both stages; every request and response-body read also obeys the remaining deadline |
| `TEXT_PROCESSOR_DRIVER` | Falls back to `BRIEF_COMPILER_DRIVER`, then `mock`; production generation requires `openai` |
| `TEXT_PROCESSOR_MODEL` | `gpt-5.6`; model identity is part of the artifact generator version |
| `TEXT_PROCESSOR_TIMEOUT_MS` | `45000` bounded translation/review request timeout (1–120000 ms) |
| `TEXT_SUMMARY_TIMEOUT_MS` | `90000` bounded summary request timeout (1–120000 ms); independent of UI and call languages |
| `TEXT_ARTIFACT_GENERATION_ENABLED` | Explicit `true`/`false`; absent means enabled for mock and disabled for OpenAI. Disabling generation preserves reads of retained artifacts |
| `TEXT_ARTIFACT_DIRECTIONS` | Comma-separated `kind:source:target`, e.g. `plan_review:de:ru,transcript_translation:*:ru,call_summary:*:ru`. Real provider has no enabled directions when empty. Final transcripts can contain mixed/unknown languages, so transcript translation and summary use source `*`; do not infer it from the call locale |
| `API_RATE_LIMIT_TEXT_ARTIFACTS_PER_HOUR` | `30` owner/IP generation/retry requests per hour |
| `CALL_RUNTIME_PROFILE` | Example `native_v2`; accepts `native_v2` or `managed`. Binds voice, hangup and required preparation policy. Unset preserves low-level compatibility. Conflicting overrides fail; all processes must match. |
| `VOICE_RUNTIME_DRIVER` | Without a profile: `live`; accepts `realtime` or `live`. Named profiles require Live. Invalid/conflicting values fail startup; restart required. |
| `VOICE_RUNTIME_LIVE_FALLBACK` | `false`; one Live voice session with no Realtime sockets. Explicit `true` retains the legacy hybrid pilot and startup fallback |
| `VOICE_RUNTIME_LIVE_EXPERIMENT` | `off`; accepts `native_v1` or `native_v2`. Native v1 may choose managed control for ineligible tasks; native v2 supports production with Live, fallback disabled and agent hangup enabled. |
| `VOICE_RUNTIME_NATIVE_V2_LOCAL` | Obsolete and ignored; retained configurations do not affect selection. |
| `OPENAI_LIVE_MODEL` | `gpt-live-1`; Live speech/listening. Opening, consent and closing ownership depend on the selected runtime; native v2 owns the notice and brief closing. |
| `OPENAI_LIVE_DELEGATION_MODEL` | `gpt-6-luna`; Responses task delegation (and consent in managed mode), `parallel_tool_calls=false`. Application checks own authority and action journals. |
| `OPENAI_SPEECH_MODEL` | `gpt-4o-mini-tts`; renderer retained for managed disclosure/recovery/requests/closing and failure paths. Buffered 24 kHz PCM is converted to PCMU and cached per call. Native-v2 ordinary speech, notice and closing use Live. |
| `OPENAI_LIVE_MALE_VOICE`, `OPENAI_LIVE_FEMALE_VOICE` | Fixed `cedar`, `marin`; optional legacy settings must match. Approved snapshots freeze the concrete voice ID. |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime-2.1` |
| `OPENAI_TRANSCRIPTION_MODEL` | `gpt-realtime-whisper` for the Realtime driver/legacy hybrid only; unified Live uses native transcripts |
| `OPENAI_TRANSCRIPTION_DELAY` | `high`; accepts minimal/low/medium/high/xhigh |
| `OPENAI_POST_CALL_TRANSCRIPTION_MODEL` | `gpt-transcribe`, full-file fallback |
| `OPENAI_POST_CALL_UTTERANCE_TRANSCRIPTION_MODEL` | Runtime default `gpt-4o-transcribe`, normal stereo path |
| `OPENAI_REALTIME_MALE_VOICE`, `OPENAI_REALTIME_FEMALE_VOICE` | `cedar`, `marin` |

### Managed disclosure, consent and speech

This subsection describes `UnifiedLiveCall`, not the native-v2 declarative path.

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
become available after recording admission (durable begin, provider creation and
durable attach; no wait for the recording callback). The approved initial disclosure
already contains any selected assistance explanation. Live then receives a
purpose/readiness instruction; the ordinary opening has no exact-script playback
gate. `end_call` requires `reason` and `resultSummary` (2–400 characters). Consent
uses `live_delegation` when semantic interpretation is needed; deterministic decisions
do not initiate a consent delegation. No new `live_consent_classification` operations are created.
Initial disclosure synthesis is accounted under `live_disclosure_synthesis`; other
application speech uses `live_application_synthesis`. Protected appointment speech
uses a deterministic proposal/authorization check, an action journal and an exact
application-generated question. Delegation interprets the subsequent answer; there
is no separate semantic verifier before playback or external calendar verification.
Closing persists the accepted decision and renders its summary plus localized farewell
as one finite audio unit. A no-evidence timeout uses the complete application failure
farewell once. A current uncleared Twilio mark is required for normal agent hangup;
existing interruption recovery and deadlines remain in effect.
The historical consent
stage stays readable for accounting. See [runtime details](archive/live-unified-runtime.md)
and [real-call evidence](archive/live-call-review-2026-09-28.md). Source migrations extend through 0100.
Migration 0100 stores the revisioned consent mode and pins its policy to each attempt;
existing attempts without a saved policy retain native semantic behavior. Changing the
mode requires an active superadmin, the current revision and an audited reason. Unified
Live persists linked disclosure playback, consent decision/method and recording request/start
events without storing the recipient's pre-consent speech. Initial disclosure text,
approved snapshots and the optional assistance reason are unchanged. See the
[hybrid implementation report](archive/2026-10/hybrid-consent-implementation-2026-10-04.md).
See [voice continuity](archive/live-voice-continuity-2026-09-28.md) for the two-voice catalog,
provider confirmation checks and manual acoustic acceptance.

Live protocol errors are command-scoped. The runtime correlates `error.client_event_id`, retries
an explicit rejection once, does not retry ambiguous acknowledgement timeouts, and continues past
late or uncorrelated command errors. Only a closed connection/session or an exhausted active
command/delegation enters the bounded failure-close path. Safe protocol fields are persisted as
`realtime.error`; provider messages and conversational content are not stored in that event.

The 5 November A0–A3 candidate identifies itself with runtime descriptor
`implementationVersion=live-audit-a-2026-11-05` while retaining `runtimeVersion=live-managed-v9`.
Cold disclosure rendering overlaps Live startup after the same provider reservation;
existing admission and playback gates still control release. Optional diagnostics use
a per-call queue with at most 64 active/pending writes, one writer and no retries.
Loss produces bounded `LIVE_TELEMETRY_UNAVAILABLE` warnings, not a voice disconnect.
Lifecycle outcome events, consent/action/transcript journals and provider accounting
keep their existing failure behavior. Technical startup, TTS, context-ACK and
consent-to-send measurements use `conversation.task` / `phase=diagnostic`.
They contain no speech or plan text and are not proof of audible latency. See
[implementation and measurement limits](archive/2026-11/live-runtime-a-implementation-2026-11-05.md).

Managed speaking pace is set by `buildLiveInstructions` and controlled-speech
instructions in `UnifiedLiveCall`. Native-v2 conversation/backend prompts are
assembled separately in [live-task-context.ts](../apps/api/src/voice/live-task-context.ts).
There is no numeric speech-rate environment or form control. Prompt changes apply
to new sessions after process reload; frozen attempts must not silently change
their descriptor. See [prompt responsibilities](native-live-runtime.md#prompt-responsibilities).

### Durable processing

Model strings are configurable identifiers in this code snapshot. Verify access and
behavior with approved live-provider evidence before deployment; the automated audit
does not call providers. The worker processes one durable call job at a time per
instance; ASR can make four concurrent utterance requests inside that job. Default
poll interval is one second, lease duration 120 seconds and worker heartbeat interval
five seconds. These are code options, not documented environment variables.

Durable processing includes delayed provider_call_cost_reconciliation and a separate
text_artifact_generation worker loop. Text artifact jobs persist successful chunks,
cap provider requests at 24 across three generations total (initial plus two manual
retries), allow three automatic attempts per generation, and fence source revision
plus worker/generation/attempt. A queued retry/backoff remains `queued`; `retryable`
is server-derived from terminal job state, budgets and failure classification.
`Retry-After` defers the job by at most 15 minutes. Optional summary compaction failure
preserves validated findings. See [artifact endpoints](#language-and-generated-text-endpoints).
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
See [measurements and interpretation](archive/2026-10/preparation-latency-diagnostics-2026-10-04.md).

Streaming generation/audit also record at most six checkpoints and optional numeric
stream progress. More than 256 consecutive JSON formatting whitespace characters
outside strings produces `OPENAI_STREAM_PADDING`; initial compilation can use one
compact-output schema repair. Deadlines/budgets do not reset; repeated padding fails.
Cancelled unknown upstream work retains its permit until expiry. This does not add
durable retries for ordinary HTTP 200 body timeouts. See [preparation runtime](preparation-runtime.md).

The 120-second preparation budget does not include the separately queued automatic
review translation. The desired 10–15 second target / 30-second total limit is not
an implemented end-to-end deadline. Include review and UI completion in measurements.

## Recent configuration and workers

The current schema catalog ends at **0116**. Migrations 0102–0107 implement preparation
policy/admission/observability; 0108 adds Swiss-only account-phone settings; 0109 adds
immutable creation UI language and the owner result-email outbox. Migrations 0110–0112
add native privacy/trace, attempt scoping and appointment action revisions. Catalog
availability is not deployment evidence. Operational procedures are local-only.

Migration 0116 adds preparation validation events with safe correlated metadata and
bounded encrypted evidence, including failures before plan publication. Sensitive
access is audited; cancellation, deletion and retention clear private evidence.
The Inspector reads it through
`POST /api/admin/call-preparations/:id/sensitive-access` with a superadmin reason.

Migrations 0113–0115 add the encrypted objective projection and 30-day fresh-call
default, tester grants/versioned scenarios/preparation attribution, and exact
localized retention-copy upgrades. See [task information and testing](task-input-and-testing.md)
for API endpoints, backfill and compatibility boundaries.

| Setting / subsystem | Current behavior |
| --- | --- |
| `OPENAI_ADMIN_API_KEY`, `OPENAI_PROJECT_ID` | Optional server-only, project-scoped Costs API sync; missing credentials produce not-configured status rather than zero costs |
| Twilio billing | Uses existing account SID/auth token; account-level daily context is separate from call charges |
| Billing worker | PostgreSQL-only; external background/all roles run startup/hourly sync under advisory locking; manual API command `billing:sync` / `billing:sync:prod` |
| Superadmin notifications | PostgreSQL queue/settings, disabled by default; external background/all roles deliver; returned-plan alerts support all returns or signals-only; API and the delivering worker need EMAIL_DRIVER/RESEND_API_KEY/EMAIL_FROM/public site origin; recipients/categories are configured in Admin System |
| Owner result notifications | Separate PostgreSQL outbox, independent of superadmin settings; embedded API or external background/all worker; existing email provider, keyring and public site origin; [delivery rules](#owner-result-email-delivery) |
| `ADMIN_TELEMETRY_EXPORT_ENABLED` | Enabled with PostgreSQL unless exactly `false`; use the same setting on API and worker; memory reports unavailable |
| Export worker | Embedded API or external background/all role according to DURABLE_WORKER_MODE; independent 2-second queue poll, one global builder, Calls panel heartbeat; PostgreSQL 17 |
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
| POST | `/api/call-briefs/:id/summaries` | Schema-3 summary/findings with source context, native outcome and coverage where applicable; the payload reader accepts versions 2/3/4 |
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
calculated usage; unknown costs remain pending. The versioned rate card treats
moderation as zero-cost. Migration 0072
adds the attempt lookup index. The admin view separates reported/calculated costs,
pending reserves and remaining budget. See [historical accounting calibration](archive/budget-accounting-2026-09-15.md)
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
[OG routes](../apps/api/src/og/og-routes.ts),
[telemetry routes](../apps/api/src/telemetry-export/routes.ts),
[plan-review routes](../apps/api/src/safety/plan-review-routes.ts) and
[testing routes](../apps/api/src/testing/routes.ts).
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

The v2 creation envelope accepts optional `testScenario: { id, revision }` outside
the brief and approval hashes. Origin is validated server-side; template insertion
does not bypass standard preparation. New requests with omitted audio retention
default to 30 days; explicit 0/7/30 and historical policies remain compatible.
See [testing API contracts and errors](task-input-and-testing.md#tester-capability-and-catalog)
and [attribution boundaries](task-input-and-testing.md#attribution-and-expenses).

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
not durable replay history. See [transcripts and telemetry](engineer-guide.md#telemetry-transcripts-and-audio-export).

<!-- route-inventory -->

## Registered routes

Route inventory: 155 registrations, checked against the source syntax tree on
2026-11-08, including bounded dynamic families. Source references are module links
so line movement does not make them misleading. Shared dynamic declarations link
to their registration helper.
Bounded template families and conditional OG routes are expanded into concrete paths;
inspect the linked module for authorization and validation. This inventory does not imply that
an optional subsystem is enabled in a particular environment.

| Method | Route | Registration |
| --- | --- | --- |
| POST | `/api/account/data-export` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/account/deletion` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/account/deletion` | [app.ts](../apps/api/src/app.ts) |
| PATCH | `/api/account/language-preferences` | [app.ts](../apps/api/src/app.ts) |
| PATCH | `/api/account/profile/name` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/call-outcome-metrics` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/call-preparations/:id` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/calls/:id/cost` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/admin/calls/:id/sensitive-access` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/calls/:id` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/calls` | [app.ts](../apps/api/src/app.ts) |
| PUT | `/api/admin/content/editorial/:key/draft` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/admin/content/editorial/:key/drafts` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/content/editorial/:key/preview` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/admin/content/editorial/:key/publish` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/admin/content/editorial/:key/revisions/:revisionNumber/rollback` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/content/editorial/:key/revisions` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/content/editorial/:key` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/admin/content/og/:locale/generate` | [og-routes.ts](../apps/api/src/og/og-routes.ts) |
| GET | `/api/admin/content/og/:locale/images/:hash.png` | [og-routes.ts](../apps/api/src/og/og-routes.ts) |
| POST | `/api/admin/content/og/:locale/publish` | [og-routes.ts](../apps/api/src/og/og-routes.ts) |
| POST | `/api/admin/content/og/:locale/upload` | [og-routes.ts](../apps/api/src/og/og-routes.ts) |
| GET | `/api/admin/content/og` | [og-routes.ts](../apps/api/src/og/og-routes.ts) |
| PUT | `/api/admin/content/pages/:key/draft` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/admin/content/pages/:key/drafts` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/content/pages/:key/preview` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/admin/content/pages/:key/publish` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/admin/content/pages/:key/revisions/:revisionNumber/rollback` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/content/pages/:key/revisions` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/content/pages/:key` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/content/pages` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/admin/credit-grants` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/operations/overview` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/admin/promo-codes` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/admin/recipient-suppressions/lift` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/admin/recipient-suppressions` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/admin/safety/plan-reviews/:id/emails/:deliveryId/retry` | [plan-review-routes.ts](../apps/api/src/safety/plan-review-routes.ts) |
| POST | `/api/admin/safety/plan-reviews/:id/sensitive-access` | [plan-review-routes.ts](../apps/api/src/safety/plan-review-routes.ts) |
| GET | `/api/admin/safety/plan-reviews/:id` | [plan-review-routes.ts](../apps/api/src/safety/plan-review-routes.ts) |
| PATCH | `/api/admin/safety/plan-reviews/:id` | [plan-review-routes.ts](../apps/api/src/safety/plan-review-routes.ts) |
| GET | `/api/admin/safety/plan-reviews` | [plan-review-routes.ts](../apps/api/src/safety/plan-review-routes.ts) |
| GET | `/api/admin/system/analytics` | [app.ts](../apps/api/src/app.ts) |
| PUT | `/api/admin/system/analytics` | [app.ts](../apps/api/src/app.ts) |
| PUT | `/api/admin/system/beta/credit-policy` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/admin/system/beta/credits/apply` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/system/beta/credits/preview` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/admin/system/beta/invitations/:id/revoke` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/admin/system/beta/invitations` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/system/beta` | [app.ts](../apps/api/src/app.ts) |
| PUT | `/api/admin/system/beta` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/admin/system/jobs/:jobId/retry` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/system/notifications` | [app.ts](../apps/api/src/app.ts) |
| PUT | `/api/admin/system/notifications` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/system/outbound-calls` | [app.ts](../apps/api/src/app.ts) |
| PUT | `/api/admin/system/outbound-calls` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/admin/system/preparation/profiles` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/system/preparation/runtime` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/system/preparation` | [app.ts](../apps/api/src/app.ts) |
| PUT | `/api/admin/system/preparation` | [app.ts](../apps/api/src/app.ts) |
| PUT | `/api/admin/system/registration` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/system/voice-consent` | [app.ts](../apps/api/src/app.ts) |
| PUT | `/api/admin/system/voice-consent` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/system` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/admin/telemetry-exports/:id/cancel` | [routes.ts](../apps/api/src/telemetry-export/routes.ts) |
| GET | `/api/admin/telemetry-exports/:id/download` | [routes.ts](../apps/api/src/telemetry-export/routes.ts) |
| POST | `/api/admin/telemetry-exports/:id/retry` | [routes.ts](../apps/api/src/telemetry-export/routes.ts) |
| GET | `/api/admin/telemetry-exports/:id` | [routes.ts](../apps/api/src/telemetry-export/routes.ts) |
| POST | `/api/admin/telemetry-exports/preview` | [routes.ts](../apps/api/src/telemetry-export/routes.ts) |
| GET | `/api/admin/telemetry-exports` | [routes.ts](../apps/api/src/telemetry-export/routes.ts) |
| POST | `/api/admin/telemetry-exports` | [routes.ts](../apps/api/src/telemetry-export/routes.ts) |
| PUT | `/api/admin/testing/scenarios/:id` | [testing/routes.ts](../apps/api/src/testing/routes.ts) |
| GET | `/api/admin/testing/scenarios` | [testing/routes.ts](../apps/api/src/testing/routes.ts) |
| POST | `/api/admin/testing/scenarios` | [testing/routes.ts](../apps/api/src/testing/routes.ts) |
| GET | `/api/admin/users/:id/testing-access` | [testing/routes.ts](../apps/api/src/testing/routes.ts) |
| PUT | `/api/admin/users/:id/testing-access` | [testing/routes.ts](../apps/api/src/testing/routes.ts) |
| POST | `/api/admin/users/:userId/account-deletion/:requestId/retry` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/users/:userId/credits` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/admin/users/:userId/sessions/revoke` | [app.ts](../apps/api/src/app.ts) |
| PUT | `/api/admin/users/:userId/status` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/admin/users` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/analytics` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/auth/email-change/confirm` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/auth/email-change/start` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/auth/email-verification/confirm` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/auth/email-verification/defer` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/auth/email-verification/start` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/auth/login` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/auth/logout` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/auth/me` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/auth/phone-change/confirm` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/auth/phone-change/start` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/auth/recovery/complete` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/auth/recovery/start` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/auth/recovery/verify` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/auth/register` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/auth/registration-options` | [app.ts](../apps/api/src/app.ts) |
| DELETE | `/api/auth/sessions/:sessionId` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/auth/sessions/revoke` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/auth/sessions` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/auth/verification/phone` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/auth/verification/resend` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/auth/verify-phone` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/call-briefs/:id/approvals/:approvalId` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/call-briefs/:id/approve-and-start` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/call-briefs/:id/approve` | [app.ts](../apps/api/src/app.ts) |
| PATCH | `/api/call-briefs/:id/content-language` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/call-briefs/:id/data-deletion` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/call-briefs/:id/events` | [app.ts](../apps/api/src/app.ts) |
| PUT | `/api/call-briefs/:id/feedback` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/call-briefs/:id/final-transcript/retry` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/call-briefs/:id/final-transcript/translations` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/call-briefs/:id/language-context` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/call-briefs/:id/outcome` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/call-briefs/:id/plan-review` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/call-briefs/:id/recording-transcript` | [app.ts](../apps/api/src/app.ts) |
| DELETE | `/api/call-briefs/:id/recording` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/call-briefs/:id/recording` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/call-briefs/:id/repeat` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/call-briefs/:id/start` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/call-briefs/:id/stop` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/call-briefs/:id/summaries` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/call-briefs/:id/text-artifacts/:artifactId/retry` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/call-briefs/:id/text-artifacts/:artifactId` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/call-briefs/:id/text-artifacts` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/call-briefs/:id` | [app.ts](../apps/api/src/app.ts) |
| PUT | `/api/call-briefs/:id` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/call-briefs` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/call-preparations/:id` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/call-preparations` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/content/faq` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/content/index` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/content/landing` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/content/navigation` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/content/og/:locale/images/:hash.png` | [og-routes.ts](../apps/api/src/og/og-routes.ts) |
| GET | `/api/content/og` | [og-routes.ts](../apps/api/src/og/og-routes.ts) |
| GET | `/api/content/pages/:slug` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/credits/promo-redemptions` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/language-capabilities` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/onboarding/accept` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/onboarding/status` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/recipient-opt-out/confirm` | [app.ts](../apps/api/src/app.ts) |
| POST | `/api/recipient-opt-out/verification` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/recipient-suggestions` | [app.ts](../apps/api/src/app.ts) |
| GET | `/api/testing/access` | [testing/routes.ts](../apps/api/src/testing/routes.ts) |
| GET | `/api/testing/scenarios` | [testing/routes.ts](../apps/api/src/testing/routes.ts) |
| GET | `/api/usage` | [app.ts](../apps/api/src/app.ts) |
| GET | `/health/live` | [app.ts](../apps/api/src/app.ts) |
| GET | `/health/ready` | [app.ts](../apps/api/src/app.ts) |
| GET | `/health/workers` | [app.ts](../apps/api/src/app.ts) |
| POST | `/webhooks/twilio/amd` | [app.ts](../apps/api/src/app.ts) |
| GET | `/webhooks/twilio/media` | [app.ts](../apps/api/src/app.ts) |
| POST | `/webhooks/twilio/recording` | [app.ts](../apps/api/src/app.ts) |
| POST | `/webhooks/twilio/status` | [app.ts](../apps/api/src/app.ts) |
| POST | `/webhooks/twilio/voice` | [app.ts](../apps/api/src/app.ts) |
| POST | `/webhooks/twilio/voicemail-complete` | [app.ts](../apps/api/src/app.ts) |
