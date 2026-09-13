# Runtime and API reference

Reviewed 2026-09-13 against the working tree based on `ef36cfa`, including B02 routes. Configuration values here describe
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
| `EMAIL_VERIFICATION_HASH_KEY` | Generated independently by env:init | Email-change OTP HMAC; independent production API key |
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
| `MOCK_VERIFICATION_CODE` | `000000`, local only |
| `EMAIL_DRIVER` | `mock`; production API requires `resend` |
| `RESEND_API_KEY`, `EMAIL_FROM` | Required for real email change/notification |
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

100 HTTP method/path registrations after B02 remediation (working tree based on
`ef36cfa`), including the two
paths expanded by the text-artifact loop. The media GET upgrades to WebSocket.
Lines point to registrations, not authorization rules; use the handler and contracts
for those rules. This inventory was extracted from the TypeScript syntax tree.

| Method | Path | Registration |
| --- | --- | --- |
| GET | `/api/content/index` | [app.ts:419](../apps/api/src/app.ts#L419) |
| GET | `/api/content/faq` | [app.ts:425](../apps/api/src/app.ts#L425) |
| GET | `/api/content/landing` | [app.ts:442](../apps/api/src/app.ts#L442) |
| GET | `/api/content/navigation` | [app.ts:459](../apps/api/src/app.ts#L459) |
| GET | `/api/content/pages/:slug` | [app.ts:478](../apps/api/src/app.ts#L478) |
| POST | `/api/recipient-opt-out/verification` | [app.ts:498](../apps/api/src/app.ts#L498) |
| POST | `/api/recipient-opt-out/confirm` | [app.ts:519](../apps/api/src/app.ts#L519) |
| POST | `/api/auth/register` | [app.ts:541](../apps/api/src/app.ts#L541) |
| POST | `/api/auth/verification/resend` | [app.ts:561](../apps/api/src/app.ts#L561) |
| POST | `/api/auth/verify-phone` | [app.ts:578](../apps/api/src/app.ts#L578) |
| POST | `/api/auth/login` | [app.ts:600](../apps/api/src/app.ts#L600) |
| POST | `/api/auth/recovery/start` | [app.ts:619](../apps/api/src/app.ts#L619) |
| POST | `/api/auth/recovery/verify` | [app.ts:640](../apps/api/src/app.ts#L640) |
| POST | `/api/auth/recovery/complete` | [app.ts:660](../apps/api/src/app.ts#L660) |
| POST | `/api/auth/phone-change/start` | [app.ts:680](../apps/api/src/app.ts#L680) |
| POST | `/api/auth/phone-change/confirm` | [app.ts:709](../apps/api/src/app.ts#L709) |
| POST | `/api/auth/logout` | [app.ts:737](../apps/api/src/app.ts#L737) |
| POST | `/api/auth/sessions/revoke` | [app.ts:748](../apps/api/src/app.ts#L748) |
| GET | `/api/auth/sessions` | [app.ts:763](../apps/api/src/app.ts#L763) |
| DELETE | `/api/auth/sessions/:sessionId` | [app.ts:778](../apps/api/src/app.ts#L778) |
| GET | `/api/auth/me` | [app.ts:807](../apps/api/src/app.ts#L807) |
| POST | `/api/auth/email-change/start` | [app.ts:817](../apps/api/src/app.ts#L817) |
| POST | `/api/auth/email-change/confirm` | [app.ts:846](../apps/api/src/app.ts#L846) |
| PATCH | `/api/account/language-preferences` | [app.ts:874](../apps/api/src/app.ts#L874) |
| PATCH | `/api/account/profile/name` | [app.ts:885](../apps/api/src/app.ts#L885) |
| POST | `/api/account/data-export` | [app.ts:912](../apps/api/src/app.ts#L912) |
| GET | `/api/account/deletion` | [app.ts:944](../apps/api/src/app.ts#L944) |
| POST | `/api/account/deletion` | [app.ts:956](../apps/api/src/app.ts#L956) |
| GET | `/api/onboarding/status` | [app.ts:996](../apps/api/src/app.ts#L996) |
| POST | `/api/onboarding/accept` | [app.ts:1016](../apps/api/src/app.ts#L1016) |
| GET | `/api/admin/content/pages` | [app.ts:1039](../apps/api/src/app.ts#L1039) |
| GET | `/api/admin/content/pages/:key` | [app.ts:1047](../apps/api/src/app.ts#L1047) |
| GET | `/api/admin/content/pages/:key/preview` | [app.ts:1067](../apps/api/src/app.ts#L1067) |
| GET | `/api/admin/content/pages/:key/revisions` | [app.ts:1089](../apps/api/src/app.ts#L1089) |
| POST | `/api/admin/content/pages/:key/drafts` | [app.ts:1106](../apps/api/src/app.ts#L1106) |
| PUT | `/api/admin/content/pages/:key/draft` | [app.ts:1125](../apps/api/src/app.ts#L1125) |
| POST | `/api/admin/content/pages/:key/publish` | [app.ts:1155](../apps/api/src/app.ts#L1155) |
| POST | `/api/admin/content/pages/:key/revisions/:revisionNumber/rollback` | [app.ts:1182](../apps/api/src/app.ts#L1182) |
| GET | `/api/admin/content/editorial/:key` | [app.ts:1217](../apps/api/src/app.ts#L1217) |
| GET | `/api/admin/content/editorial/:key/preview` | [app.ts:1238](../apps/api/src/app.ts#L1238) |
| GET | `/api/admin/content/editorial/:key/revisions` | [app.ts:1261](../apps/api/src/app.ts#L1261) |
| POST | `/api/admin/content/editorial/:key/drafts` | [app.ts:1282](../apps/api/src/app.ts#L1282) |
| PUT | `/api/admin/content/editorial/:key/draft` | [app.ts:1306](../apps/api/src/app.ts#L1306) |
| POST | `/api/admin/content/editorial/:key/publish` | [app.ts:1338](../apps/api/src/app.ts#L1338) |
| POST | `/api/admin/content/editorial/:key/revisions/:revisionNumber/rollback` | [app.ts:1367](../apps/api/src/app.ts#L1367) |
| GET | `/api/usage` | [app.ts:1405](../apps/api/src/app.ts#L1405) |
| POST | `/api/credits/promo-redemptions` | [app.ts:1417](../apps/api/src/app.ts#L1417) |
| POST | `/api/admin/promo-codes` | [app.ts:1442](../apps/api/src/app.ts#L1442) |
| POST | `/api/admin/credit-grants` | [app.ts:1458](../apps/api/src/app.ts#L1458) |
| GET | `/api/admin/call-outcome-metrics` | [app.ts:1475](../apps/api/src/app.ts#L1475) |
| GET | `/api/admin/operations/overview` | [app.ts:1483](../apps/api/src/app.ts#L1483) |
| GET | `/api/admin/system` | [app.ts:1502](../apps/api/src/app.ts#L1502) |
| GET | `/api/admin/system/outbound-calls` | [app.ts:1510](../apps/api/src/app.ts#L1510) |
| PUT | `/api/admin/system/outbound-calls` | [app.ts:1520](../apps/api/src/app.ts#L1520) |
| POST | `/api/admin/system/jobs/:jobId/retry` | [app.ts:1545](../apps/api/src/app.ts#L1545) |
| GET | `/api/admin/calls` | [app.ts:1579](../apps/api/src/app.ts#L1579) |
| GET | `/api/admin/calls/:id` | [app.ts:1631](../apps/api/src/app.ts#L1631) |
| GET | `/api/admin/calls/:id/cost` | [app.ts:1649](../apps/api/src/app.ts#L1649) |
| GET | `/api/admin/call-preparations/:id` | [app.ts:1667](../apps/api/src/app.ts#L1667) |
| POST | `/api/admin/calls/:id/sensitive-access` | [app.ts:1687](../apps/api/src/app.ts#L1687) |
| GET | `/api/admin/users` | [app.ts:1715](../apps/api/src/app.ts#L1715) |
| GET | `/api/admin/users/:userId/credits` | [app.ts:1768](../apps/api/src/app.ts#L1768) |
| PUT | `/api/admin/users/:userId/status` | [app.ts:1797](../apps/api/src/app.ts#L1797) |
| POST | `/api/admin/users/:userId/sessions/revoke` | [app.ts:1825](../apps/api/src/app.ts#L1825) |
| POST | `/api/admin/users/:userId/account-deletion/:requestId/retry` | [app.ts:1851](../apps/api/src/app.ts#L1851) |
| POST | `/api/admin/recipient-suppressions` | [app.ts:1880](../apps/api/src/app.ts#L1880) |
| POST | `/api/admin/recipient-suppressions/lift` | [app.ts:1896](../apps/api/src/app.ts#L1896) |
| GET | `/health/live` | [app.ts:1913](../apps/api/src/app.ts#L1913) |
| GET | `/health/ready` | [app.ts:1919](../apps/api/src/app.ts#L1919) |
| GET | `/api/call-briefs` | [app.ts:1939](../apps/api/src/app.ts#L1939) |
| GET | `/api/recipient-suggestions` | [app.ts:1969](../apps/api/src/app.ts#L1969) |
| GET | `/api/language-capabilities` | [app.ts:1995](../apps/api/src/app.ts#L1995) |
| GET | `/api/call-briefs/:id/language-context` | [app.ts:2003](../apps/api/src/app.ts#L2003) |
| PATCH | `/api/call-briefs/:id/content-language` | [app.ts:2008](../apps/api/src/app.ts#L2008) |
| GET | `/api/call-briefs/:id/text-artifacts` | [app.ts:2022](../apps/api/src/app.ts#L2022) |
| GET | `/api/call-briefs/:id/text-artifacts/:artifactId` | [app.ts:2027](../apps/api/src/app.ts#L2027) |
| POST | `/api/call-briefs/:id/plan-review` | [app.ts:2034](../apps/api/src/app.ts#L2034) |
| POST | `/api/call-briefs/:id/final-transcript/translations` | [app.ts:2048](../apps/api/src/app.ts#L2048) |
| POST | `/api/call-briefs/:id/summaries` | [app.ts:2048](../apps/api/src/app.ts#L2048) |
| POST | `/api/call-briefs/:id/text-artifacts/:artifactId/retry` | [app.ts:2062](../apps/api/src/app.ts#L2062) |
| POST | `/api/call-preparations` | [app.ts:2074](../apps/api/src/app.ts#L2074) |
| GET | `/api/call-preparations/:id` | [app.ts:2141](../apps/api/src/app.ts#L2141) |
| GET | `/api/call-briefs/:id` | [app.ts:2159](../apps/api/src/app.ts#L2159) |
| GET | `/api/call-briefs/:id/outcome` | [app.ts:2172](../apps/api/src/app.ts#L2172) |
| PUT | `/api/call-briefs/:id/feedback` | [app.ts:2189](../apps/api/src/app.ts#L2189) |
| PUT | `/api/call-briefs/:id` | [app.ts:2218](../apps/api/src/app.ts#L2218) |
| GET | `/api/call-briefs/:id/recording` | [app.ts:2296](../apps/api/src/app.ts#L2296) |
| DELETE | `/api/call-briefs/:id/recording` | [app.ts:2326](../apps/api/src/app.ts#L2326) |
| POST | `/api/call-briefs/:id/data-deletion` | [app.ts:2342](../apps/api/src/app.ts#L2342) |
| POST | `/api/call-briefs/:id/final-transcript/retry` | [app.ts:2389](../apps/api/src/app.ts#L2389) |
| POST | `/api/call-briefs/:id/approve` | [app.ts:2414](../apps/api/src/app.ts#L2414) |
| POST | `/api/call-briefs/:id/approve-and-start` | [app.ts:2434](../apps/api/src/app.ts#L2434) |
| POST | `/api/call-briefs/:id/start` | [app.ts:2465](../apps/api/src/app.ts#L2465) |
| POST | `/api/call-briefs/:id/stop` | [app.ts:2488](../apps/api/src/app.ts#L2488) |
| POST | `/api/call-briefs/:id/approvals/:approvalId` | [app.ts:2504](../apps/api/src/app.ts#L2504) |
| GET | `/api/call-briefs/:id/events` | [app.ts:2529](../apps/api/src/app.ts#L2529) |
| POST | `/webhooks/twilio/voice` | [app.ts:2786](../apps/api/src/app.ts#L2786) |
| GET | `/webhooks/twilio/media` | [app.ts:2855](../apps/api/src/app.ts#L2855) |
| POST | `/webhooks/twilio/status` | [app.ts:2870](../apps/api/src/app.ts#L2870) |
| POST | `/webhooks/twilio/recording` | [app.ts:2939](../apps/api/src/app.ts#L2939) |
