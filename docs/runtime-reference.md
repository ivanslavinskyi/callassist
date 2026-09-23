# Runtime and API reference

Updated 2026-09-23 for expenses, notifications, Analytics, OG images and telemetry
exports; the route inventory below was regenerated from the current source. Configuration values here describe
the repository defaults, not provider availability, supported pricing or a deployed
environment. Exact locked package versions are in [pnpm-lock.yaml](../pnpm-lock.yaml).

## Call lifecycle and history

Migrations 0073/0074 add stop events and final assessments. List/snapshot/Inspector responses share the `lifecycle` projection, including `assessment_pending` and `assessment_unavailable`. Operations exposes independent `lifecycle.goals` and `userGoalFeedback` counts. Those two migrations introduce no production environment variable; migration 0075 and opt-out require the additional settings below. Apply migrations before restarting all API/worker processes; do not leave an old worker using immediate refunds. History lives at `/[locale]/app/history`. [Final assessment semantics and verification](post-call-assessment-diagnosis-2026-09-15.md).

`summary-v3` combines the final summary and canonical assessment. Normal short calls use one request; transient failures allow one automatic retry per generation. The five-minute reservation deadline starts when termination is first processed and survives restarts. Worker maintenance releases expired reservations independently of slow model/transcription work. Actual model availability and diarization still affect assessment quality. Optional billable smoke evaluation: `ALLOW_BILLABLE_EVAL=true pnpm --filter @callassist/api eval:call-assessment` (eight synthetic examples; `ASSESSMENT_EVAL_CASE` limits the run to one named case).

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
parity. See [deployment preflight and the chosen first-release target](deployment-preflight.md).

## Provider and worker settings

| Variable | Repository default / requirement |
| --- | --- |
| `TELEPHONY_DRIVER` | `mock`; production requires `twilio` |
| `REALTIME_AGENT_HANGUP_ENABLED` | `false` by default; apply migration 0062 first. Exact `true` enables ordinary-call `end_call` after opening playback. Read at API startup; restart required. Does not affect consent/error hangup. |
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
usage evidence. Earlier [latency measurements](plan-preparation-quality-2026-09-15.md)
were taken at a 5,000-token ceiling and are not a benchmark of the new ceiling.

## Recent configuration and workers

Apply the complete source catalog through **0080** before starting the new API and
worker. Source catalog availability is not deployment evidence; verify the target's
applied checksums. See [delivery and rollout](delivery-2026-09-22.md).

| Setting / subsystem | Current behavior |
| --- | --- |
| `OPENAI_ADMIN_API_KEY`, `OPENAI_PROJECT_ID` | Optional server-only, project-scoped Costs API sync; missing credentials produce not-configured status rather than zero costs |
| Twilio billing | Uses existing account SID/auth token; account-level daily context is separate from call charges |
| Billing worker | PostgreSQL-only; runs on worker startup and hourly under advisory locking; manual API command `billing:sync` / `billing:sync:prod` |
| Superadmin notifications | PostgreSQL queue/settings, disabled by default; API and worker need EMAIL_DRIVER/RESEND_API_KEY/EMAIL_FROM/public site origin; recipients/categories are configured in Admin System |
| `ADMIN_TELEMETRY_EXPORT_ENABLED` | Enabled with PostgreSQL unless exactly `false`; use the same setting on API and worker; memory reports unavailable |
| Export worker | Embedded API or external worker according to DURABLE_WORKER_MODE; independent 2-second queue poll, one global builder, Calls panel heartbeat; PostgreSQL 17 |
| Export storage | Same database/keyring; encrypted parts ≤1 MiB, ready TTL 24 hours, source-deletion/access-change revocation; cleanup requires running consumer |
| Analytics | Revisioned beta settings exposed via protected Admin System API; public read returns tracker settings; consent/acknowledgement policy is separate |
| Homepage OG | No external image service; migration 0078, bundled logo/font and seven fallback PNGs; API build copies assets |

Details: [notifications](superadmin-notifications.md), [export contract and limits](admin-call-telemetry-export.md),
[Analytics/locales](localization-and-analytics.md), [OG publication](home-og-images.md).

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
pending reserves and remaining budget. See [current accounting and local calibration](budget-accounting-2026-09-15.md)
and [admission/operator procedure](beta-controls-2026-09-14.md). Local revision 3
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
[rate policy](rate-limit-policy.md) and auth service for those controls.

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
[eligibility, backfill and operations](recipient-opt-out.md).

## Selectable call languages

`GET /api/language-capabilities` advertises current call choices `de-CH`, `fr-CH`,
`it-CH`, `en-GB`, plus `ru-RU` only for a superadmin. Historical `de-DE`/`en-US`
remain in persisted schemas but are not selectable capabilities.

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
| `DATA_ENCRYPTION_REENCRYPT_CONFIRM` | Must equal active key ID; rotation verifies all twenty ciphertext columns |
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

125 explicit HTTP method/path registrations in the 2026-09-22 source, including
expanded text-artifact, OG and export loops. Framework-generated HEAD/OPTIONS are
not counted. The media GET upgrades to WebSocket. Lines identify registrations;
authorization remains in handlers. Extracted from the TypeScript syntax tree.

| Method | Path | Registration |
| --- | --- | --- |
| GET | `/api/analytics` | [app.ts:242](../apps/api/src/app.ts#L242) |
| GET | `/api/content/index` | [app.ts:488](../apps/api/src/app.ts#L488) |
| GET | `/api/content/faq` | [app.ts:494](../apps/api/src/app.ts#L494) |
| GET | `/api/content/landing` | [app.ts:511](../apps/api/src/app.ts#L511) |
| GET | `/api/content/navigation` | [app.ts:528](../apps/api/src/app.ts#L528) |
| GET | `/api/content/pages/:slug` | [app.ts:547](../apps/api/src/app.ts#L547) |
| POST | `/api/recipient-opt-out/verification` | [app.ts:567](../apps/api/src/app.ts#L567) |
| POST | `/api/recipient-opt-out/confirm` | [app.ts:588](../apps/api/src/app.ts#L588) |
| POST | `/api/auth/register` | [app.ts:610](../apps/api/src/app.ts#L610) |
| POST | `/api/auth/verification/resend` | [app.ts:630](../apps/api/src/app.ts#L630) |
| POST | `/api/auth/verification/phone` | [app.ts:647](../apps/api/src/app.ts#L647) |
| POST | `/api/auth/verify-phone` | [app.ts:657](../apps/api/src/app.ts#L657) |
| POST | `/api/auth/login` | [app.ts:679](../apps/api/src/app.ts#L679) |
| POST | `/api/auth/recovery/start` | [app.ts:698](../apps/api/src/app.ts#L698) |
| POST | `/api/auth/recovery/verify` | [app.ts:719](../apps/api/src/app.ts#L719) |
| POST | `/api/auth/recovery/complete` | [app.ts:739](../apps/api/src/app.ts#L739) |
| POST | `/api/auth/phone-change/start` | [app.ts:759](../apps/api/src/app.ts#L759) |
| POST | `/api/auth/phone-change/confirm` | [app.ts:788](../apps/api/src/app.ts#L788) |
| POST | `/api/auth/logout` | [app.ts:816](../apps/api/src/app.ts#L816) |
| POST | `/api/auth/sessions/revoke` | [app.ts:827](../apps/api/src/app.ts#L827) |
| GET | `/api/auth/sessions` | [app.ts:842](../apps/api/src/app.ts#L842) |
| DELETE | `/api/auth/sessions/:sessionId` | [app.ts:857](../apps/api/src/app.ts#L857) |
| GET | `/api/auth/me` | [app.ts:886](../apps/api/src/app.ts#L886) |
| POST | `/api/auth/email-verification/start` | [app.ts:896](../apps/api/src/app.ts#L896) |
| POST | `/api/auth/email-verification/confirm` | [app.ts:909](../apps/api/src/app.ts#L909) |
| POST | `/api/auth/email-change/start` | [app.ts:922](../apps/api/src/app.ts#L922) |
| POST | `/api/auth/email-change/confirm` | [app.ts:951](../apps/api/src/app.ts#L951) |
| PATCH | `/api/account/language-preferences` | [app.ts:979](../apps/api/src/app.ts#L979) |
| PATCH | `/api/account/profile/name` | [app.ts:990](../apps/api/src/app.ts#L990) |
| POST | `/api/account/data-export` | [app.ts:1017](../apps/api/src/app.ts#L1017) |
| GET | `/api/account/deletion` | [app.ts:1049](../apps/api/src/app.ts#L1049) |
| POST | `/api/account/deletion` | [app.ts:1061](../apps/api/src/app.ts#L1061) |
| GET | `/api/onboarding/status` | [app.ts:1101](../apps/api/src/app.ts#L1101) |
| POST | `/api/onboarding/accept` | [app.ts:1121](../apps/api/src/app.ts#L1121) |
| GET | `/api/admin/content/pages` | [app.ts:1144](../apps/api/src/app.ts#L1144) |
| GET | `/api/admin/content/pages/:key` | [app.ts:1152](../apps/api/src/app.ts#L1152) |
| GET | `/api/admin/content/pages/:key/preview` | [app.ts:1172](../apps/api/src/app.ts#L1172) |
| GET | `/api/admin/content/pages/:key/revisions` | [app.ts:1194](../apps/api/src/app.ts#L1194) |
| POST | `/api/admin/content/pages/:key/drafts` | [app.ts:1211](../apps/api/src/app.ts#L1211) |
| PUT | `/api/admin/content/pages/:key/draft` | [app.ts:1230](../apps/api/src/app.ts#L1230) |
| POST | `/api/admin/content/pages/:key/publish` | [app.ts:1260](../apps/api/src/app.ts#L1260) |
| POST | `/api/admin/content/pages/:key/revisions/:revisionNumber/rollback` | [app.ts:1287](../apps/api/src/app.ts#L1287) |
| GET | `/api/admin/content/editorial/:key` | [app.ts:1322](../apps/api/src/app.ts#L1322) |
| GET | `/api/admin/content/editorial/:key/preview` | [app.ts:1343](../apps/api/src/app.ts#L1343) |
| GET | `/api/admin/content/editorial/:key/revisions` | [app.ts:1366](../apps/api/src/app.ts#L1366) |
| POST | `/api/admin/content/editorial/:key/drafts` | [app.ts:1387](../apps/api/src/app.ts#L1387) |
| PUT | `/api/admin/content/editorial/:key/draft` | [app.ts:1411](../apps/api/src/app.ts#L1411) |
| POST | `/api/admin/content/editorial/:key/publish` | [app.ts:1443](../apps/api/src/app.ts#L1443) |
| POST | `/api/admin/content/editorial/:key/revisions/:revisionNumber/rollback` | [app.ts:1472](../apps/api/src/app.ts#L1472) |
| GET | `/api/usage` | [app.ts:1510](../apps/api/src/app.ts#L1510) |
| POST | `/api/credits/promo-redemptions` | [app.ts:1522](../apps/api/src/app.ts#L1522) |
| POST | `/api/admin/promo-codes` | [app.ts:1547](../apps/api/src/app.ts#L1547) |
| POST | `/api/admin/credit-grants` | [app.ts:1563](../apps/api/src/app.ts#L1563) |
| GET | `/api/admin/call-outcome-metrics` | [app.ts:1580](../apps/api/src/app.ts#L1580) |
| GET | `/api/admin/operations/overview` | [app.ts:1588](../apps/api/src/app.ts#L1588) |
| GET | `/api/admin/system` | [app.ts:1607](../apps/api/src/app.ts#L1607) |
| GET | `/api/admin/system/outbound-calls` | [app.ts:1615](../apps/api/src/app.ts#L1615) |
| GET | `/api/admin/system/analytics` | [app.ts:1625](../apps/api/src/app.ts#L1625) |
| PUT | `/api/admin/system/analytics` | [app.ts:1631](../apps/api/src/app.ts#L1631) |
| GET | `/api/admin/system/beta` | [app.ts:1643](../apps/api/src/app.ts#L1643) |
| GET | `/api/admin/system/notifications` | [app.ts:1649](../apps/api/src/app.ts#L1649) |
| PUT | `/api/admin/system/notifications` | [app.ts:1657](../apps/api/src/app.ts#L1657) |
| PUT | `/api/admin/system/beta` | [app.ts:1673](../apps/api/src/app.ts#L1673) |
| POST | `/api/admin/system/beta/invitations` | [app.ts:1685](../apps/api/src/app.ts#L1685) |
| POST | `/api/admin/system/beta/invitations/:id/revoke` | [app.ts:1695](../apps/api/src/app.ts#L1695) |
| PUT | `/api/admin/system/outbound-calls` | [app.ts:1708](../apps/api/src/app.ts#L1708) |
| POST | `/api/admin/system/jobs/:jobId/retry` | [app.ts:1733](../apps/api/src/app.ts#L1733) |
| GET | `/api/admin/calls` | [app.ts:1767](../apps/api/src/app.ts#L1767) |
| GET | `/api/admin/calls/:id` | [app.ts:1819](../apps/api/src/app.ts#L1819) |
| GET | `/api/admin/calls/:id/cost` | [app.ts:1837](../apps/api/src/app.ts#L1837) |
| GET | `/api/admin/call-preparations/:id` | [app.ts:1855](../apps/api/src/app.ts#L1855) |
| POST | `/api/admin/calls/:id/sensitive-access` | [app.ts:1875](../apps/api/src/app.ts#L1875) |
| GET | `/api/admin/users` | [app.ts:1903](../apps/api/src/app.ts#L1903) |
| GET | `/api/admin/users/:userId/credits` | [app.ts:1956](../apps/api/src/app.ts#L1956) |
| PUT | `/api/admin/users/:userId/status` | [app.ts:1985](../apps/api/src/app.ts#L1985) |
| POST | `/api/admin/users/:userId/sessions/revoke` | [app.ts:2013](../apps/api/src/app.ts#L2013) |
| POST | `/api/admin/users/:userId/account-deletion/:requestId/retry` | [app.ts:2039](../apps/api/src/app.ts#L2039) |
| POST | `/api/admin/recipient-suppressions` | [app.ts:2068](../apps/api/src/app.ts#L2068) |
| POST | `/api/admin/recipient-suppressions/lift` | [app.ts:2084](../apps/api/src/app.ts#L2084) |
| GET | `/health/live` | [app.ts:2101](../apps/api/src/app.ts#L2101) |
| GET | `/health/ready` | [app.ts:2107](../apps/api/src/app.ts#L2107) |
| GET | `/api/call-briefs` | [app.ts:2127](../apps/api/src/app.ts#L2127) |
| GET | `/api/recipient-suggestions` | [app.ts:2160](../apps/api/src/app.ts#L2160) |
| GET | `/api/language-capabilities` | [app.ts:2186](../apps/api/src/app.ts#L2186) |
| GET | `/api/call-briefs/:id/language-context` | [app.ts:2197](../apps/api/src/app.ts#L2197) |
| PATCH | `/api/call-briefs/:id/content-language` | [app.ts:2202](../apps/api/src/app.ts#L2202) |
| GET | `/api/call-briefs/:id/text-artifacts` | [app.ts:2216](../apps/api/src/app.ts#L2216) |
| GET | `/api/call-briefs/:id/text-artifacts/:artifactId` | [app.ts:2221](../apps/api/src/app.ts#L2221) |
| POST | `/api/call-briefs/:id/plan-review` | [app.ts:2228](../apps/api/src/app.ts#L2228) |
| POST | `/api/call-briefs/:id/final-transcript/translations` | [app.ts:2242](../apps/api/src/app.ts#L2242) |
| POST | `/api/call-briefs/:id/summaries` | [app.ts:2242](../apps/api/src/app.ts#L2242) |
| POST | `/api/call-briefs/:id/text-artifacts/:artifactId/retry` | [app.ts:2256](../apps/api/src/app.ts#L2256) |
| POST | `/api/call-preparations` | [app.ts:2268](../apps/api/src/app.ts#L2268) |
| GET | `/api/call-preparations/:id` | [app.ts:2336](../apps/api/src/app.ts#L2336) |
| GET | `/api/call-briefs/:id` | [app.ts:2354](../apps/api/src/app.ts#L2354) |
| GET | `/api/call-briefs/:id/outcome` | [app.ts:2367](../apps/api/src/app.ts#L2367) |
| PUT | `/api/call-briefs/:id/feedback` | [app.ts:2384](../apps/api/src/app.ts#L2384) |
| PUT | `/api/call-briefs/:id` | [app.ts:2413](../apps/api/src/app.ts#L2413) |
| GET | `/api/call-briefs/:id/recording` | [app.ts:2492](../apps/api/src/app.ts#L2492) |
| DELETE | `/api/call-briefs/:id/recording` | [app.ts:2522](../apps/api/src/app.ts#L2522) |
| POST | `/api/call-briefs/:id/data-deletion` | [app.ts:2538](../apps/api/src/app.ts#L2538) |
| POST | `/api/call-briefs/:id/final-transcript/retry` | [app.ts:2585](../apps/api/src/app.ts#L2585) |
| POST | `/api/call-briefs/:id/approve` | [app.ts:2610](../apps/api/src/app.ts#L2610) |
| POST | `/api/call-briefs/:id/approve-and-start` | [app.ts:2631](../apps/api/src/app.ts#L2631) |
| POST | `/api/call-briefs/:id/start` | [app.ts:2664](../apps/api/src/app.ts#L2664) |
| POST | `/api/call-briefs/:id/stop` | [app.ts:2689](../apps/api/src/app.ts#L2689) |
| POST | `/api/call-briefs/:id/approvals/:approvalId` | [app.ts:2705](../apps/api/src/app.ts#L2705) |
| GET | `/api/call-briefs/:id/events` | [app.ts:2730](../apps/api/src/app.ts#L2730) |
| POST | `/webhooks/twilio/voice` | [app.ts:2990](../apps/api/src/app.ts#L2990) |
| GET | `/webhooks/twilio/media` | [app.ts:3059](../apps/api/src/app.ts#L3059) |
| POST | `/webhooks/twilio/status` | [app.ts:3074](../apps/api/src/app.ts#L3074) |
| POST | `/webhooks/twilio/recording` | [app.ts:3143](../apps/api/src/app.ts#L3143) |
| GET | `/api/content/og` | [og-routes.ts:8](../apps/api/src/og/og-routes.ts#L8) |
| GET | `/api/admin/content/og` | [og-routes.ts:9](../apps/api/src/og/og-routes.ts#L9) |
| GET | `/api/admin/content/og/:locale/images/:hash.png` | [og-routes.ts:13](../apps/api/src/og/og-routes.ts#L13) |
| GET | `/api/content/og/:locale/images/:hash.png` | [og-routes.ts:13](../apps/api/src/og/og-routes.ts#L13) |
| POST | `/api/admin/content/og/:locale/generate` | [og-routes.ts:30](../apps/api/src/og/og-routes.ts#L30) |
| POST | `/api/admin/content/og/:locale/upload` | [og-routes.ts:30](../apps/api/src/og/og-routes.ts#L30) |
| POST | `/api/admin/content/og/:locale/publish` | [og-routes.ts:30](../apps/api/src/og/og-routes.ts#L30) |
| GET | `/api/admin/telemetry-exports` | [routes.ts:22](../apps/api/src/telemetry-export/routes.ts#L22) |
| POST | `/api/admin/telemetry-exports` | [routes.ts:30](../apps/api/src/telemetry-export/routes.ts#L30) |
| GET | `/api/admin/telemetry-exports/:id` | [routes.ts:36](../apps/api/src/telemetry-export/routes.ts#L36) |
| POST | `/api/admin/telemetry-exports/:id/cancel` | [routes.ts:41](../apps/api/src/telemetry-export/routes.ts#L41) |
| POST | `/api/admin/telemetry-exports/:id/retry` | [routes.ts:41](../apps/api/src/telemetry-export/routes.ts#L41) |
| GET | `/api/admin/telemetry-exports/:id/download` | [routes.ts:47](../apps/api/src/telemetry-export/routes.ts#L47) |
