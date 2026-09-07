# Runtime and API reference

Source: remediation working tree based on `96229ea`, reviewed 2026-09-07. Configuration values here describe
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

For web development, create `apps/web/.env.local` with only the three web settings
above if overriding localhost defaults. In production, use the public web hostname
for browser API access and proxy `/api/*` to Fastify. SSR can use a private API origin.
Keep the Twilio public ingress separate. Set up trusted proxy IP handling explicitly
before treating the direct-peer IP as the individual caller's address (R09).

## Provider and worker settings

| Variable | Repository default / requirement |
| --- | --- |
| `TELEPHONY_DRIVER` | `mock`; production requires `twilio` |
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
| `OPENAI_BRIEF_COMPILER_TIMEOUT_MS` | `90000` total compiler timeout |
| `OPENAI_BRIEF_COMPILER_REQUEST_TIMEOUT_MS` | `25000` per compiler request |
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
| `API_RATE_LIMIT_DATA_EXPORT_PER_DAY` | 2 |
| `API_RATE_LIMIT_CALL_DATA_DELETION_PER_DAY` | 5 |
| `API_RATE_LIMIT_ACCOUNT_DELETION_PER_DAY` | 3 |

Endpoint values are user budgets; IP budgets are five times larger. Auth, recovery,
phone/email change and public opt-out also have code-owned limits. See the
[rate policy](rate-limit-policy.md) and auth service for those controls.

## Operations-only configuration

| Variable/group | Meaning |
| --- | --- |
| `ADMIN_COST_PRICING_VERSION` | Required if any cost rate is configured; otherwise estimates are unavailable |
| `ADMIN_COST_TELEPHONY_USD_MICROS_PER_MINUTE` | Optional nonnegative integer connected-minute estimate |
| `ADMIN_COST_REALTIME_USD_MICROS_PER_MINUTE` | Optional nonnegative integer connected-minute estimate |
| `ADMIN_COST_TRANSCRIPTION_USD_MICROS_PER_MINUTE` | Optional nonnegative integer recorded-minute estimate |
| `DATA_ENCRYPTION_REENCRYPT_CONFIRM` | Must equal active key ID; rotation verifies all nine ciphertext families |
| `DATA_ENCRYPTION_REENCRYPT_BATCH_SIZE` | 1–500; default 100 |
| `RECOVERY_SOURCE_DATABASE_URL` | Overrides DATABASE_URL for the local recovery drill |
| `RECOVERY_POSTGRES_CONTAINER` | Explicit Docker PostgreSQL container, otherwise discovered through Compose |
| `CLOUDFLARED_PATH` | Tunnel executable override; helper otherwise uses the Windows installation or PATH and always targets port 4001 |
| `REAL_CALL_DRILL_MODE`, `REAL_CALL_DRILL_EMAIL`, `REAL_CALL_DRILL_PASSWORD`, `REAL_CALL_DRILL_TARGET`, `REAL_CALL_DRILL_IDEMPOTENCY_KEY`, `REAL_CALL_DRILL_CONFIRM`, `REAL_CALL_DRILL_API_URL` | Two-stage runner: prepare (default), then reviewed/authorized start; existing verified account only. See [drill procedure](real-provider-drills.md) |
| `REAL_CALL_DRILL_CALL_ID`, `REAL_CALL_DRILL_EXPECT` | Prepared call UUID for start/inspector; inspector `worker_backlog`/`settled` expectation |

One dollar is 1,000,000 micros. Cost figures are coarse operational estimates, not
provider invoices or per-request compiler/consent-session accounting.

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
and recompile are separate synchronous service operations.

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

<!-- route-inventory -->

## Registered routes

87 HTTP method/path registrations; the media GET upgrades to WebSocket.

| Method | Path | Source line |
| --- | --- | --- |
| GET | `/api/content/index` | [app.ts:412](../apps/api/src/app.ts#L412) |
| GET | `/api/content/faq` | [app.ts:418](../apps/api/src/app.ts#L418) |
| GET | `/api/content/landing` | [app.ts:435](../apps/api/src/app.ts#L435) |
| GET | `/api/content/navigation` | [app.ts:452](../apps/api/src/app.ts#L452) |
| GET | `/api/content/pages/:slug` | [app.ts:471](../apps/api/src/app.ts#L471) |
| POST | `/api/recipient-opt-out/verification` | [app.ts:491](../apps/api/src/app.ts#L491) |
| POST | `/api/recipient-opt-out/confirm` | [app.ts:512](../apps/api/src/app.ts#L512) |
| POST | `/api/auth/register` | [app.ts:534](../apps/api/src/app.ts#L534) |
| POST | `/api/auth/verification/resend` | [app.ts:554](../apps/api/src/app.ts#L554) |
| POST | `/api/auth/verify-phone` | [app.ts:571](../apps/api/src/app.ts#L571) |
| POST | `/api/auth/login` | [app.ts:593](../apps/api/src/app.ts#L593) |
| POST | `/api/auth/recovery/start` | [app.ts:612](../apps/api/src/app.ts#L612) |
| POST | `/api/auth/recovery/verify` | [app.ts:633](../apps/api/src/app.ts#L633) |
| POST | `/api/auth/recovery/complete` | [app.ts:653](../apps/api/src/app.ts#L653) |
| POST | `/api/auth/phone-change/start` | [app.ts:673](../apps/api/src/app.ts#L673) |
| POST | `/api/auth/phone-change/confirm` | [app.ts:702](../apps/api/src/app.ts#L702) |
| POST | `/api/auth/logout` | [app.ts:730](../apps/api/src/app.ts#L730) |
| POST | `/api/auth/sessions/revoke` | [app.ts:741](../apps/api/src/app.ts#L741) |
| GET | `/api/auth/sessions` | [app.ts:756](../apps/api/src/app.ts#L756) |
| DELETE | `/api/auth/sessions/:sessionId` | [app.ts:771](../apps/api/src/app.ts#L771) |
| GET | `/api/auth/me` | [app.ts:800](../apps/api/src/app.ts#L800) |
| POST | `/api/auth/email-change/start` | [app.ts:810](../apps/api/src/app.ts#L810) |
| POST | `/api/auth/email-change/confirm` | [app.ts:839](../apps/api/src/app.ts#L839) |
| PATCH | `/api/account/profile/name` | [app.ts:867](../apps/api/src/app.ts#L867) |
| POST | `/api/account/data-export` | [app.ts:894](../apps/api/src/app.ts#L894) |
| GET | `/api/account/deletion` | [app.ts:926](../apps/api/src/app.ts#L926) |
| POST | `/api/account/deletion` | [app.ts:938](../apps/api/src/app.ts#L938) |
| GET | `/api/onboarding/status` | [app.ts:978](../apps/api/src/app.ts#L978) |
| POST | `/api/onboarding/accept` | [app.ts:998](../apps/api/src/app.ts#L998) |
| GET | `/api/admin/content/pages` | [app.ts:1021](../apps/api/src/app.ts#L1021) |
| GET | `/api/admin/content/pages/:key` | [app.ts:1029](../apps/api/src/app.ts#L1029) |
| GET | `/api/admin/content/pages/:key/preview` | [app.ts:1049](../apps/api/src/app.ts#L1049) |
| GET | `/api/admin/content/pages/:key/revisions` | [app.ts:1071](../apps/api/src/app.ts#L1071) |
| POST | `/api/admin/content/pages/:key/drafts` | [app.ts:1088](../apps/api/src/app.ts#L1088) |
| PUT | `/api/admin/content/pages/:key/draft` | [app.ts:1107](../apps/api/src/app.ts#L1107) |
| POST | `/api/admin/content/pages/:key/publish` | [app.ts:1137](../apps/api/src/app.ts#L1137) |
| POST | `/api/admin/content/pages/:key/revisions/:revisionNumber/rollback` | [app.ts:1164](../apps/api/src/app.ts#L1164) |
| GET | `/api/admin/content/editorial/:key` | [app.ts:1199](../apps/api/src/app.ts#L1199) |
| GET | `/api/admin/content/editorial/:key/preview` | [app.ts:1220](../apps/api/src/app.ts#L1220) |
| GET | `/api/admin/content/editorial/:key/revisions` | [app.ts:1243](../apps/api/src/app.ts#L1243) |
| POST | `/api/admin/content/editorial/:key/drafts` | [app.ts:1264](../apps/api/src/app.ts#L1264) |
| PUT | `/api/admin/content/editorial/:key/draft` | [app.ts:1288](../apps/api/src/app.ts#L1288) |
| POST | `/api/admin/content/editorial/:key/publish` | [app.ts:1320](../apps/api/src/app.ts#L1320) |
| POST | `/api/admin/content/editorial/:key/revisions/:revisionNumber/rollback` | [app.ts:1349](../apps/api/src/app.ts#L1349) |
| GET | `/api/usage` | [app.ts:1387](../apps/api/src/app.ts#L1387) |
| POST | `/api/credits/promo-redemptions` | [app.ts:1399](../apps/api/src/app.ts#L1399) |
| POST | `/api/admin/promo-codes` | [app.ts:1424](../apps/api/src/app.ts#L1424) |
| POST | `/api/admin/credit-grants` | [app.ts:1440](../apps/api/src/app.ts#L1440) |
| GET | `/api/admin/call-outcome-metrics` | [app.ts:1457](../apps/api/src/app.ts#L1457) |
| GET | `/api/admin/operations/overview` | [app.ts:1465](../apps/api/src/app.ts#L1465) |
| GET | `/api/admin/system` | [app.ts:1484](../apps/api/src/app.ts#L1484) |
| PUT | `/api/admin/system/outbound-calls` | [app.ts:1492](../apps/api/src/app.ts#L1492) |
| POST | `/api/admin/system/jobs/:jobId/retry` | [app.ts:1517](../apps/api/src/app.ts#L1517) |
| GET | `/api/admin/calls` | [app.ts:1551](../apps/api/src/app.ts#L1551) |
| GET | `/api/admin/calls/:id` | [app.ts:1603](../apps/api/src/app.ts#L1603) |
| POST | `/api/admin/calls/:id/sensitive-access` | [app.ts:1621](../apps/api/src/app.ts#L1621) |
| GET | `/api/admin/users` | [app.ts:1649](../apps/api/src/app.ts#L1649) |
| GET | `/api/admin/users/:userId/credits` | [app.ts:1702](../apps/api/src/app.ts#L1702) |
| PUT | `/api/admin/users/:userId/status` | [app.ts:1731](../apps/api/src/app.ts#L1731) |
| POST | `/api/admin/users/:userId/sessions/revoke` | [app.ts:1759](../apps/api/src/app.ts#L1759) |
| POST | `/api/admin/users/:userId/account-deletion/:requestId/retry` | [app.ts:1785](../apps/api/src/app.ts#L1785) |
| POST | `/api/admin/recipient-suppressions` | [app.ts:1814](../apps/api/src/app.ts#L1814) |
| POST | `/api/admin/recipient-suppressions/lift` | [app.ts:1830](../apps/api/src/app.ts#L1830) |
| GET | `/health/live` | [app.ts:1847](../apps/api/src/app.ts#L1847) |
| GET | `/health/ready` | [app.ts:1853](../apps/api/src/app.ts#L1853) |
| GET | `/api/call-briefs` | [app.ts:1873](../apps/api/src/app.ts#L1873) |
| GET | `/api/recipient-suggestions` | [app.ts:1903](../apps/api/src/app.ts#L1903) |
| POST | `/api/call-preparations` | [app.ts:1929](../apps/api/src/app.ts#L1929) |
| GET | `/api/call-preparations/:id` | [app.ts:1988](../apps/api/src/app.ts#L1988) |
| GET | `/api/call-briefs/:id` | [app.ts:2006](../apps/api/src/app.ts#L2006) |
| GET | `/api/call-briefs/:id/outcome` | [app.ts:2019](../apps/api/src/app.ts#L2019) |
| PUT | `/api/call-briefs/:id/feedback` | [app.ts:2036](../apps/api/src/app.ts#L2036) |
| PUT | `/api/call-briefs/:id` | [app.ts:2065](../apps/api/src/app.ts#L2065) |
| GET | `/api/call-briefs/:id/recording` | [app.ts:2096](../apps/api/src/app.ts#L2096) |
| DELETE | `/api/call-briefs/:id/recording` | [app.ts:2126](../apps/api/src/app.ts#L2126) |
| POST | `/api/call-briefs/:id/data-deletion` | [app.ts:2142](../apps/api/src/app.ts#L2142) |
| POST | `/api/call-briefs/:id/final-transcript/retry` | [app.ts:2189](../apps/api/src/app.ts#L2189) |
| POST | `/api/call-briefs/:id/approve` | [app.ts:2214](../apps/api/src/app.ts#L2214) |
| POST | `/api/call-briefs/:id/approve-and-start` | [app.ts:2230](../apps/api/src/app.ts#L2230) |
| POST | `/api/call-briefs/:id/start` | [app.ts:2253](../apps/api/src/app.ts#L2253) |
| POST | `/api/call-briefs/:id/stop` | [app.ts:2276](../apps/api/src/app.ts#L2276) |
| POST | `/api/call-briefs/:id/approvals/:approvalId` | [app.ts:2292](../apps/api/src/app.ts#L2292) |
| GET | `/api/call-briefs/:id/events` | [app.ts:2317](../apps/api/src/app.ts#L2317) |
| POST | `/webhooks/twilio/voice` | [app.ts:2578](../apps/api/src/app.ts#L2578) |
| GET | `/webhooks/twilio/media` | [app.ts:2633](../apps/api/src/app.ts#L2633) |
| POST | `/webhooks/twilio/status` | [app.ts:2648](../apps/api/src/app.ts#L2648) |
| POST | `/webhooks/twilio/recording` | [app.ts:2706](../apps/api/src/app.ts#L2706) |
