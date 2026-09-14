# Runtime and API reference

Reviewed 2026-09-14 for the email/SMS checkpoint following `f172a1a`, including email-verification routes. Configuration values here describe
the repository defaults, not provider availability, supported pricing or a deployed
environment. Exact locked package versions are in [pnpm-lock.yaml](../pnpm-lock.yaml).

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

### Preserving the local test runtime when restarting

The accepted R21 test originally enabled ordinary-call hangup only on a temporary
QA process. On 2026-09-09 the main local `.env` was explicitly updated with
`REALTIME_AGENT_HANGUP_ENABLED=true`; keep this setting when restarting that local
runtime. Do not reconstruct its settings from `.env.example`, whose repository
default remains `false`, or rely on flags from a previous shell session.

Before replacing the API process, check that no calls/attempts are active and no
preparation is processing. Preserve the current text-provider driver, enabled
directions, mock SMS choice and public tunnel URL. Only the API needs restarting
for this flag; its bridge captures the value at startup. Existing process variables
override `.env`, so an explicit inherited `false` must not override the intended
local value. From `apps/api`, this read-only check prints only the effective flag:

```powershell
node --import tsx --import ./src/config/load-env.ts -e "console.log(process.env.REALTIME_AGENT_HANGUP_ENABLED === 'true')"
```

Expect `true` for this local test setup, then restart the API with the preserved
settings and verify main API readiness plus the Twilio gateway. A later authorized
call should emit `conversation.hangup` and end after the farewell playback mark;
do not place a verification call merely as part of restarting. Implementation and
configuration evidence: [hangup restoration](hangup-runtime-restoration-2026-09-09.md).

## Storage, identity and network settings

| Variable | Example/default behavior | Consumers / boundary |
| --- | --- | --- |
| `NODE_ENV` | Set explicitly to `production` for API/worker deployment | Enables fail-closed production checks and secure API cookie |
| `STORAGE_DRIVER` | Example `postgres`; factory fallback `memory` | Calls, auth, content and shared rate limiter |
| `DATABASE_URL` | Example `localhost:56432/callassist` | Server-only database credentials; production validator rejects loopback |
| `TEST_DATABASE_URL` | Separate `callassist_test` on the selected server | Integration tests require a dedicated `*_test` database; missing/unavailable URL fails |
| `POSTGRES_PORT` / `POSTGRES_PASSWORD` | Example `56432` / development password | Compose; port fallback without variable is `55432` |
| `DATA_ENCRYPTION_KEY` | Independent base64 32-byte key | API/worker private JSON encryption |
| `DATA_ENCRYPTION_ACTIVE_KEY_ID` | Example `local-1` | Explicit production write-key ID |
| `DATA_ENCRYPTION_PREVIOUS_KEYS` | JSON key-ID to base64 key map, empty normally | Up to four decrypt-only retained keys |
| `DATA_ENCRYPTION_LEGACY_V1_KEY_ID` | Example `local-1` | Resolves old v1 ciphertext to a retained key |
| `PROMO_CODE_HASH_KEY` | Generated independently by env:init | Promo HMAC; legacy local fallback to data key, independent key required in production API |
| `RATE_LIMIT_HASH_KEY` | Generated independently by env:init | Shared identifier HMAC; independent production API key |
| `EMAIL_VERIFICATION_HASH_KEY` | Generated independently by env:init | Initial email verification and email-change OTP HMAC; independent production API key |
| `PORT` | `4000` | Main API binds `0.0.0.0` |
| `TWILIO_WEBHOOK_PORT` | `4001` | Twilio-mode listener binds `127.0.0.1`; must differ from main port |
| `PUBLIC_BASE_URL` | Public HTTPS Twilio ingress origin | Signature validation, callback and Media Stream URLs |
| `WEB_ORIGIN` | Example localhost/127.0.0.1 port 3000 | Comma-separated browser-origin allow-list; production HTTPS required |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` fallback | Browser HTTP/SSE, web CSP; public build-time value |
| `NEXT_PUBLIC_SITE_URL` | Example `http://localhost:3000` | Canonical metadata, sitemap, robots, SEO, HTTPS web HSTS |
| `INTERNAL_API_URL` | Falls back to public API URL then localhost:4000 | Private web SSR session/content lookups |
| `NEXT_DIST_DIR` | `.next` | Optional separate output for a parallel local QA web server, e.g. `.next-r21`; use the same value with direct Next build/start commands |

For web development, create `apps/web/.env.local` with only the three web settings
above if overriding localhost defaults. In production, use the public web hostname
for browser API access and proxy `/api/*` to Fastify. SSR can use a private API origin.
Keep the Twilio public ingress separate. Set up trusted proxy IP handling explicitly
before treating the direct-peer IP as the individual caller's address (R09).

## Provider and worker settings

| Variable | Repository default / requirement |
| --- | --- |
| `TELEPHONY_DRIVER` | `mock`; production requires `twilio` |
| `REALTIME_AGENT_HANGUP_ENABLED` | `false` by default; apply migration 0062 first. Exact `true` enables ordinary-call `end_call` after opening playback. Read at API startup; restart required. Does not affect consent/error hangup. |
| `DURABLE_WORKER_MODE` | `embedded`; production requires `external` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | Required for real outbound telephony |
| `VERIFICATION_DRIVER` | Example `mock`; factory infers Twilio from real telephony if unset; production API requires explicit `twilio` |
| `TWILIO_VERIFY_SERVICE_SID` | Required for Twilio SMS verification |
| `SMS_ALLOWED_COUNTRIES` | `CH,UA`; comma-separated ISO countries for account verification, independently validated from outbound-call destinations |
| `SMS_DAILY_SEND_LIMIT`, `SMS_PER_MINUTE_SEND_LIMIT` | `100` / `10`; shared across all SMS flows; each number also has 1/minute and 3/hour limits |
| `MOCK_VERIFICATION_CODE` | `000000`, local only |
| `EMAIL_DRIVER` | `mock`; production API requires `resend` |
| `MOCK_EMAIL_VERIFICATION_CODE` | `000000`; six digits for local mock email only; real Resend uses random codes |
| `RESEND_API_KEY`, `EMAIL_FROM` | Required for initial email verification/change/security notices; local sender `SHPROHLI <mail@shprohli.ch>` requires verified Resend domain |
| `NEXT_PUBLIC_SITE_URL` | Also required by the API for production email footer links: public HTTPS origin, no credentials/path/query; localhost HTTP is allowed in development. Logo is embedded as a CID PNG, independent of this URL. |
| `OPENAI_API_KEY` | Required for real Realtime/ASR and OpenAI compiler |
| `BRIEF_COMPILER_DRIVER` | Example `mock`; factory infers `openai` when key exists if unset. API and worker production validation both require explicit `openai`; missing/mock is rejected |
| `OPENAI_BRIEF_COMPILER_MODEL` | `gpt-5.6` |
| `OPENAI_BRIEF_COMPILER_TIMEOUT_MS` | `120000` total compiler timeout per worker attempt; generation leaves up to 25 seconds for final moderation |
| `OPENAI_BRIEF_COMPILER_REQUEST_TIMEOUT_MS` | Unset: `60000` for plan generation, `25000` for moderation. Explicit values override both stages; every request and response-body read also obeys the remaining deadline |
| `TEXT_PROCESSOR_DRIVER` | Falls back to `BRIEF_COMPILER_DRIVER`, then `mock`; production generation requires `openai` |
| `TEXT_PROCESSOR_MODEL` | `gpt-5.6`; model identity is part of the artifact generator version |
| `TEXT_PROCESSOR_TIMEOUT_MS` | `45000` bounded translation/review request timeout (1–120000 ms) |
| `TEXT_SUMMARY_TIMEOUT_MS` | `90000` bounded summary request timeout (1–120000 ms); independent of UI and call languages |
| `TEXT_ARTIFACT_GENERATION_ENABLED` | Explicit `true`/`false`; absent means enabled for mock and disabled for OpenAI. Disabling generation preserves reads of retained artifacts |
| `TEXT_ARTIFACT_DIRECTIONS` | Comma-separated `kind:source:target`, e.g. `plan_review:de:ru,transcript_translation:*:ru,call_summary:*:ru`. Real provider has no enabled directions when empty. Final transcripts can contain mixed/unknown languages, so transcript translation and summary use source `*`; do not infer it from the call locale |
| `API_RATE_LIMIT_TEXT_ARTIFACTS_PER_HOUR` | `30` owner/IP generation/retry requests per hour |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime-2.1` |
| `OPENAI_TRANSCRIPTION_MODEL` | `gpt-realtime-whisper` for live/consent recognition |
| `OPENAI_TRANSCRIPTION_DELAY` | `high`; accepts minimal/low/medium/high/xhigh |
| `OPENAI_POST_CALL_TRANSCRIPTION_MODEL` | `gpt-transcribe`, full-file fallback |
| `OPENAI_POST_CALL_UTTERANCE_TRANSCRIPTION_MODEL` | Runtime default `gpt-4o-transcribe`, normal stereo path |
| `OPENAI_REALTIME_MALE_VOICE`, `OPENAI_REALTIME_FEMALE_VOICE` | `cedar`, `marin` |

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
browser polls each explicit submission for up to two minutes between responses;
reaching that deadline leaves the server operation running and shows a pending
message. Retrying unchanged input reuses its operation key. Only a server-confirmed
terminal failure retires that key. An explicit resubmit of an older uncertain
operation may create one replacement after confirming failure; a failed fresh
operation stops. Creation, editing and clarification answers use this recovery
rule. No retry approves a plan or starts a call. Existing configured timeout values
remain overrides; updating code alone does not replace an explicit 25-second value.

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
[rate policy](rate-limit-policy.md) and auth service for those controls.

## Operations-only configuration

Database cutover commands: pnpm db:backfill:call-plans,
pnpm db:classify:legacy-call-plans and pnpm db:verify:call-plan-cutover.
The last is a read-only gate required before migration 0061; follow the
[staged rollout](approved-call-plan-cost-security-roadmap.md#migration-and-rollout-sequence).

| Variable/group | Meaning |
| --- | --- |
| `ADMIN_COST_PRICING_VERSION` | Required if any cost rate is configured; otherwise estimates are unavailable |
| `ADMIN_COST_TELEPHONY_USD_MICROS_PER_MINUTE` | Optional nonnegative integer connected-minute estimate |
| `ADMIN_COST_REALTIME_USD_MICROS_PER_MINUTE` | Optional nonnegative integer connected-minute estimate |
| `ADMIN_COST_TRANSCRIPTION_USD_MICROS_PER_MINUTE` | Optional nonnegative integer recorded-minute estimate |
| `DATA_ENCRYPTION_REENCRYPT_CONFIRM` | Must equal active key ID; rotation verifies all seventeen ciphertext columns |
| `DATA_ENCRYPTION_REENCRYPT_BATCH_SIZE` | 1–500; default 100 |
| `RECOVERY_SOURCE_DATABASE_URL` | Overrides DATABASE_URL for the local recovery drill |
| `RECOVERY_POSTGRES_CONTAINER` | Explicit Docker PostgreSQL container, otherwise discovered through Compose |
| `CLOUDFLARED_PATH` | Tunnel executable override; helper otherwise uses the Windows installation or PATH and always targets port 4001 |
| `REAL_CALL_DRILL_REVISION`, `REAL_CALL_DRILL_SNAPSHOT_HASH`, `REAL_CALL_DRILL_MODE`, `REAL_CALL_DRILL_EMAIL`, `REAL_CALL_DRILL_PASSWORD`, `REAL_CALL_DRILL_TARGET`, `REAL_CALL_DRILL_IDEMPOTENCY_KEY`, `REAL_CALL_DRILL_CONFIRM`, `REAL_CALL_DRILL_API_URL` | Two-stage runner: prepare (default), then reviewed/authorized start; existing verified account only. See [drill procedure](real-provider-drills.md) |
| `REAL_CALL_DRILL_CALL_ID`, `REAL_CALL_DRILL_EXPECT` | Prepared call UUID for start/inspector; inspector `worker_backlog`/`settled` expectation |

The CLI start implementation currently submits revision/hash without v2 review
evidence; a new plan without an existing receipt is rejected with `CALL_REVIEW_REQUIRED`.
Use the signed-in UI for current supervised starts. This limitation and the pending
CLI/harness update are R06; the environment variables do not provide that missing evidence.

One dollar is 1,000,000 micros. The three optional minute rates above are coarse
fallback estimates. The separate provider ledger records requests/usage for compilation,
Realtime, consent recognition, ASR and text artifacts, alongside reported/calculated
amounts. Neither is an invoice reconciliation system.

The outbound-control CLI accepts `enable|disable` and a reason as command arguments:
`corepack pnpm --filter @callassist/api calls:disable "reviewed incident reason"`
(or `calls:enable`). It requires PostgreSQL access, has no browser-session RBAC and
uses privileged operational database credentials. Restrict execution accordingly;
the normal admin API preserves the admin-disable/superadmin-enable role distinction.

## API conventions

The list below is extracted from registrations in [app.ts](../apps/api/src/app.ts).
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

103 HTTP method/path registrations in the 2026-09-14 email/SMS checkpoint, including the two
paths expanded by the text-artifact loop. The media GET upgrades to WebSocket.
Lines point to registrations, not authorization rules; use the handler and contracts
for those rules. This inventory was extracted from the TypeScript syntax tree.

| Method | Path | Registration |
| --- | --- | --- |
| GET | `/api/content/index` | [app.ts:428](../apps/api/src/app.ts#L428) |
| GET | `/api/content/faq` | [app.ts:434](../apps/api/src/app.ts#L434) |
| GET | `/api/content/landing` | [app.ts:451](../apps/api/src/app.ts#L451) |
| GET | `/api/content/navigation` | [app.ts:468](../apps/api/src/app.ts#L468) |
| GET | `/api/content/pages/:slug` | [app.ts:487](../apps/api/src/app.ts#L487) |
| POST | `/api/recipient-opt-out/verification` | [app.ts:507](../apps/api/src/app.ts#L507) |
| POST | `/api/recipient-opt-out/confirm` | [app.ts:528](../apps/api/src/app.ts#L528) |
| POST | `/api/auth/register` | [app.ts:550](../apps/api/src/app.ts#L550) |
| POST | `/api/auth/verification/resend` | [app.ts:570](../apps/api/src/app.ts#L570) |
| POST | `/api/auth/verification/phone` | [app.ts:587](../apps/api/src/app.ts#L587) |
| POST | `/api/auth/verify-phone` | [app.ts:597](../apps/api/src/app.ts#L597) |
| POST | `/api/auth/login` | [app.ts:619](../apps/api/src/app.ts#L619) |
| POST | `/api/auth/recovery/start` | [app.ts:638](../apps/api/src/app.ts#L638) |
| POST | `/api/auth/recovery/verify` | [app.ts:659](../apps/api/src/app.ts#L659) |
| POST | `/api/auth/recovery/complete` | [app.ts:679](../apps/api/src/app.ts#L679) |
| POST | `/api/auth/phone-change/start` | [app.ts:699](../apps/api/src/app.ts#L699) |
| POST | `/api/auth/phone-change/confirm` | [app.ts:728](../apps/api/src/app.ts#L728) |
| POST | `/api/auth/logout` | [app.ts:756](../apps/api/src/app.ts#L756) |
| POST | `/api/auth/sessions/revoke` | [app.ts:767](../apps/api/src/app.ts#L767) |
| GET | `/api/auth/sessions` | [app.ts:782](../apps/api/src/app.ts#L782) |
| DELETE | `/api/auth/sessions/:sessionId` | [app.ts:797](../apps/api/src/app.ts#L797) |
| GET | `/api/auth/me` | [app.ts:826](../apps/api/src/app.ts#L826) |
| POST | `/api/auth/email-verification/start` | [app.ts:836](../apps/api/src/app.ts#L836) |
| POST | `/api/auth/email-verification/confirm` | [app.ts:849](../apps/api/src/app.ts#L849) |
| POST | `/api/auth/email-change/start` | [app.ts:862](../apps/api/src/app.ts#L862) |
| POST | `/api/auth/email-change/confirm` | [app.ts:891](../apps/api/src/app.ts#L891) |
| PATCH | `/api/account/language-preferences` | [app.ts:919](../apps/api/src/app.ts#L919) |
| PATCH | `/api/account/profile/name` | [app.ts:930](../apps/api/src/app.ts#L930) |
| POST | `/api/account/data-export` | [app.ts:957](../apps/api/src/app.ts#L957) |
| GET | `/api/account/deletion` | [app.ts:989](../apps/api/src/app.ts#L989) |
| POST | `/api/account/deletion` | [app.ts:1001](../apps/api/src/app.ts#L1001) |
| GET | `/api/onboarding/status` | [app.ts:1041](../apps/api/src/app.ts#L1041) |
| POST | `/api/onboarding/accept` | [app.ts:1061](../apps/api/src/app.ts#L1061) |
| GET | `/api/admin/content/pages` | [app.ts:1084](../apps/api/src/app.ts#L1084) |
| GET | `/api/admin/content/pages/:key` | [app.ts:1092](../apps/api/src/app.ts#L1092) |
| GET | `/api/admin/content/pages/:key/preview` | [app.ts:1112](../apps/api/src/app.ts#L1112) |
| GET | `/api/admin/content/pages/:key/revisions` | [app.ts:1134](../apps/api/src/app.ts#L1134) |
| POST | `/api/admin/content/pages/:key/drafts` | [app.ts:1151](../apps/api/src/app.ts#L1151) |
| PUT | `/api/admin/content/pages/:key/draft` | [app.ts:1170](../apps/api/src/app.ts#L1170) |
| POST | `/api/admin/content/pages/:key/publish` | [app.ts:1200](../apps/api/src/app.ts#L1200) |
| POST | `/api/admin/content/pages/:key/revisions/:revisionNumber/rollback` | [app.ts:1227](../apps/api/src/app.ts#L1227) |
| GET | `/api/admin/content/editorial/:key` | [app.ts:1262](../apps/api/src/app.ts#L1262) |
| GET | `/api/admin/content/editorial/:key/preview` | [app.ts:1283](../apps/api/src/app.ts#L1283) |
| GET | `/api/admin/content/editorial/:key/revisions` | [app.ts:1306](../apps/api/src/app.ts#L1306) |
| POST | `/api/admin/content/editorial/:key/drafts` | [app.ts:1327](../apps/api/src/app.ts#L1327) |
| PUT | `/api/admin/content/editorial/:key/draft` | [app.ts:1351](../apps/api/src/app.ts#L1351) |
| POST | `/api/admin/content/editorial/:key/publish` | [app.ts:1383](../apps/api/src/app.ts#L1383) |
| POST | `/api/admin/content/editorial/:key/revisions/:revisionNumber/rollback` | [app.ts:1412](../apps/api/src/app.ts#L1412) |
| GET | `/api/usage` | [app.ts:1450](../apps/api/src/app.ts#L1450) |
| POST | `/api/credits/promo-redemptions` | [app.ts:1462](../apps/api/src/app.ts#L1462) |
| POST | `/api/admin/promo-codes` | [app.ts:1487](../apps/api/src/app.ts#L1487) |
| POST | `/api/admin/credit-grants` | [app.ts:1503](../apps/api/src/app.ts#L1503) |
| GET | `/api/admin/call-outcome-metrics` | [app.ts:1520](../apps/api/src/app.ts#L1520) |
| GET | `/api/admin/operations/overview` | [app.ts:1528](../apps/api/src/app.ts#L1528) |
| GET | `/api/admin/system` | [app.ts:1547](../apps/api/src/app.ts#L1547) |
| GET | `/api/admin/system/outbound-calls` | [app.ts:1555](../apps/api/src/app.ts#L1555) |
| PUT | `/api/admin/system/outbound-calls` | [app.ts:1565](../apps/api/src/app.ts#L1565) |
| POST | `/api/admin/system/jobs/:jobId/retry` | [app.ts:1590](../apps/api/src/app.ts#L1590) |
| GET | `/api/admin/calls` | [app.ts:1624](../apps/api/src/app.ts#L1624) |
| GET | `/api/admin/calls/:id` | [app.ts:1676](../apps/api/src/app.ts#L1676) |
| GET | `/api/admin/calls/:id/cost` | [app.ts:1694](../apps/api/src/app.ts#L1694) |
| GET | `/api/admin/call-preparations/:id` | [app.ts:1712](../apps/api/src/app.ts#L1712) |
| POST | `/api/admin/calls/:id/sensitive-access` | [app.ts:1732](../apps/api/src/app.ts#L1732) |
| GET | `/api/admin/users` | [app.ts:1760](../apps/api/src/app.ts#L1760) |
| GET | `/api/admin/users/:userId/credits` | [app.ts:1813](../apps/api/src/app.ts#L1813) |
| PUT | `/api/admin/users/:userId/status` | [app.ts:1842](../apps/api/src/app.ts#L1842) |
| POST | `/api/admin/users/:userId/sessions/revoke` | [app.ts:1870](../apps/api/src/app.ts#L1870) |
| POST | `/api/admin/users/:userId/account-deletion/:requestId/retry` | [app.ts:1896](../apps/api/src/app.ts#L1896) |
| POST | `/api/admin/recipient-suppressions` | [app.ts:1925](../apps/api/src/app.ts#L1925) |
| POST | `/api/admin/recipient-suppressions/lift` | [app.ts:1941](../apps/api/src/app.ts#L1941) |
| GET | `/health/live` | [app.ts:1958](../apps/api/src/app.ts#L1958) |
| GET | `/health/ready` | [app.ts:1964](../apps/api/src/app.ts#L1964) |
| GET | `/api/call-briefs` | [app.ts:1984](../apps/api/src/app.ts#L1984) |
| GET | `/api/recipient-suggestions` | [app.ts:2014](../apps/api/src/app.ts#L2014) |
| GET | `/api/language-capabilities` | [app.ts:2040](../apps/api/src/app.ts#L2040) |
| GET | `/api/call-briefs/:id/language-context` | [app.ts:2048](../apps/api/src/app.ts#L2048) |
| PATCH | `/api/call-briefs/:id/content-language` | [app.ts:2053](../apps/api/src/app.ts#L2053) |
| GET | `/api/call-briefs/:id/text-artifacts` | [app.ts:2067](../apps/api/src/app.ts#L2067) |
| GET | `/api/call-briefs/:id/text-artifacts/:artifactId` | [app.ts:2072](../apps/api/src/app.ts#L2072) |
| POST | `/api/call-briefs/:id/plan-review` | [app.ts:2079](../apps/api/src/app.ts#L2079) |
| POST | `/api/call-briefs/:id/final-transcript/translations` | [app.ts:2093](../apps/api/src/app.ts#L2093) |
| POST | `/api/call-briefs/:id/summaries` | [app.ts:2093](../apps/api/src/app.ts#L2093) |
| POST | `/api/call-briefs/:id/text-artifacts/:artifactId/retry` | [app.ts:2107](../apps/api/src/app.ts#L2107) |
| POST | `/api/call-preparations` | [app.ts:2119](../apps/api/src/app.ts#L2119) |
| GET | `/api/call-preparations/:id` | [app.ts:2186](../apps/api/src/app.ts#L2186) |
| GET | `/api/call-briefs/:id` | [app.ts:2204](../apps/api/src/app.ts#L2204) |
| GET | `/api/call-briefs/:id/outcome` | [app.ts:2217](../apps/api/src/app.ts#L2217) |
| PUT | `/api/call-briefs/:id/feedback` | [app.ts:2234](../apps/api/src/app.ts#L2234) |
| PUT | `/api/call-briefs/:id` | [app.ts:2263](../apps/api/src/app.ts#L2263) |
| GET | `/api/call-briefs/:id/recording` | [app.ts:2341](../apps/api/src/app.ts#L2341) |
| DELETE | `/api/call-briefs/:id/recording` | [app.ts:2371](../apps/api/src/app.ts#L2371) |
| POST | `/api/call-briefs/:id/data-deletion` | [app.ts:2387](../apps/api/src/app.ts#L2387) |
| POST | `/api/call-briefs/:id/final-transcript/retry` | [app.ts:2434](../apps/api/src/app.ts#L2434) |
| POST | `/api/call-briefs/:id/approve` | [app.ts:2459](../apps/api/src/app.ts#L2459) |
| POST | `/api/call-briefs/:id/approve-and-start` | [app.ts:2479](../apps/api/src/app.ts#L2479) |
| POST | `/api/call-briefs/:id/start` | [app.ts:2511](../apps/api/src/app.ts#L2511) |
| POST | `/api/call-briefs/:id/stop` | [app.ts:2535](../apps/api/src/app.ts#L2535) |
| POST | `/api/call-briefs/:id/approvals/:approvalId` | [app.ts:2551](../apps/api/src/app.ts#L2551) |
| GET | `/api/call-briefs/:id/events` | [app.ts:2576](../apps/api/src/app.ts#L2576) |
| POST | `/webhooks/twilio/voice` | [app.ts:2834](../apps/api/src/app.ts#L2834) |
| GET | `/webhooks/twilio/media` | [app.ts:2903](../apps/api/src/app.ts#L2903) |
| POST | `/webhooks/twilio/status` | [app.ts:2918](../apps/api/src/app.ts#L2918) |
| POST | `/webhooks/twilio/recording` | [app.ts:2987](../apps/api/src/app.ts#L2987) |
