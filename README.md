# CallAssist

CallAssist is a privacy-conscious AI voice assistant for controlled outbound phone calls. A user prepares a structured call brief, chooses the call language and a preset assistant profile, monitors a live transcript, and retains control over sensitive disclosures.

> **Project status:** working MVP for supervised testing. It is not yet intended for unattended or production-critical calling.

## What it does

- Places outbound PSTN calls through Twilio Programmable Voice.
- Runs a natural speech-to-speech conversation through OpenAI Realtime.
- Uses one selected voice for the disclosure, consent request, and conversation.
- Offers six server-owned assistant profiles and derives the corresponding voice
  gender without accepting a free-form assistant identity.
- Supports two controlled assistance reasons—speech impairment and language
  barrier—with a localized server-generated disclosure.
- Moderates and compiles a brief written in any language into a strict,
  call-language structured plan.
- Applies documented defaults for routine conversation choices and limits
  clarification to fixed, material issue codes.
- Lets the operator review, edit, recompile, and approve-and-call the same versioned
  brief without re-entering its fields.
- Requires DTMF consent before recipient audio is sent to the model or recorded.
- Starts a dual-channel Twilio recording only after consent is confirmed.
- Streams a fast draft transcript to the web console over SSE.
- Creates a context-preserving post-call transcript from the complete consented
  recording with one `gpt-transcribe` request. A conservative local aligner can
  add approximate roles and timestamps from live event metadata without copying
  live wording; otherwise the UI falls back to canonical plain text.
- Supports immediate, 7-day, or 30-day audio retention and manual deletion.
- Keeps the agent within an explicit objective, context, and allow-list of facts.
- Lets the operator stop an active call and resolve disclosure requests.
- Persists briefs, attempts, transcripts, approvals, and audit events in PostgreSQL.
- Encrypts private context and approved facts with AES-256-GCM at rest.

Supported call locales: `de-CH`, `de-DE`, `fr-CH`, `it-CH`, `en-GB`, `en-US`, and `ru-RU`.

## Architecture

```text
Next.js console ── HTTP / SSE ──► Fastify API ──► PostgreSQL
                                      │
                                      ├── Twilio REST API
                                      │
Twilio PSTN call ◄── bidirectional Media Stream ──► Realtime bridge
                                                       │
                                                       └── OpenAI Realtime

Twilio recording ── authenticated download ──► one full-call transcription pass
                                                           │
                                                           └── encrypted final text
```

The public Twilio surface is isolated on a dedicated listener. The main API, SSE endpoints, and decrypted application data are not exposed through the development tunnel.

## Security model

- Twilio call recording is disabled when the call is created.
- Recipient audio is discarded until consent is confirmed by pressing `1`.
- After consent, the conversation starts only when Twilio confirms recording
  startup; otherwise the assistant announces the failure and ends the call.
- Recording URLs and Twilio credentials are never exposed to the browser.
- Provider audio is deleted on demand or at the configured retention deadline.
- Twilio HTTP and WebSocket requests are signature-validated.
- Every media stream carries an additional call-scoped HMAC token.
- Private fields are encrypted before PostgreSQL persistence.
- The model is instructed to use only the call objective and explicitly approved facts.
- Sensitive actions remain server-owned and a deterministic policy gate prevents the
  compiler from authorizing itself or inventing arbitrary blockers.
- Public-beta destinations must parse as valid Swiss numbers using maintained phone
  metadata. They are canonicalized to E.164 and checked at contract, call-start, and
  Twilio-adapter boundaries; foreign and short-service numbers fail before dialing.

See [Architecture](docs/architecture.md) for the detailed boundaries and data model.

Before any production Twilio traffic is enabled, restrict Voice Geographic
Permissions to Switzerland (and review the allowed number ranges) in the Twilio
Console. This external account setting is a release gate and must be captured in the
deployment evidence; application validation is not a substitute for it.

## Repository layout

```text
apps/web            Next.js operator console
apps/api            Fastify API, storage, Twilio gateway, Realtime bridge
packages/contracts  Shared Zod schemas and TypeScript contracts
docs                Architecture and MVP roadmap
```

## Local development

Requirements: Node.js 22.19+, Corepack/pnpm, and Docker.

```powershell
corepack enable
pnpm install
pnpm env:init
pnpm db:up
pnpm db:test:prepare
pnpm db:migrate
pnpm dev
```

The web app runs at `http://localhost:3000`; the API runs at `http://localhost:4000`. `/en` and `/de` are public landing pages; the authenticated console lives at `/en/app` and `/de/app`. PostgreSQL is exposed on `localhost:55432`. Set `STORAGE_DRIVER=memory` for a temporary run without PostgreSQL.

The API development process intentionally does not auto-restart when source
files change. Restart it manually between edits: an automatic restart during an
active PSTN call would terminate the Twilio Media Stream.

Durable jobs run inside the API by default for one-process local development.
To exercise the split topology, set `DURABLE_WORKER_MODE=external` and start the
dedicated runtime in a second terminal:

```powershell
corepack pnpm --filter @callassist/api worker
```

The API process then only enqueues work; it never performs startup recovery or
claims a durable lease. The worker owns recovery, seeding, polling, heartbeats,
and execution. Its `SIGINT`/`SIGTERM` shutdown stops new claims, completes the
active lease, and closes the database connection. Production builds expose the
same boundary through `start` and `start:worker`. PostgreSQL invalidation signals
make committed worker changes refresh an open API SSE stream without carrying call
content in the notification. `/admin/system` reports fresh/stale/offline external
worker heartbeats and active work; production alerting still requires deployment
monitoring and notification routing.

`pnpm env:init` creates `.env` with independent encryption and keyed promo-code
hash keys and never overwrites an existing file. Existing deployments may temporarily
fall back to `DATA_ENCRYPTION_KEY`, but should set and rotate a separate
`PROMO_CODE_HASH_KEY` before issuing codes.

## Test a real Twilio call

The default `TELEPHONY_DRIVER=mock` mode is safe for local UI development. For a real test call, start a temporary tunnel to the Twilio-only gateway:

```powershell
pnpm tunnel:twilio
```

Set the generated HTTPS URL and credentials in `.env`:

```dotenv
TELEPHONY_DRIVER=twilio
PUBLIC_BASE_URL=https://random-name.trycloudflare.com
TWILIO_WEBHOOK_PORT=4001
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+...
TWILIO_VERIFY_SERVICE_SID=VA...
VERIFICATION_DRIVER=twilio
OPENAI_API_KEY=sk-...
BRIEF_COMPILER_DRIVER=openai
OPENAI_BRIEF_COMPILER_MODEL=gpt-5.6
OPENAI_BRIEF_COMPILER_TIMEOUT_MS=90000
OPENAI_BRIEF_COMPILER_REQUEST_TIMEOUT_MS=25000
OPENAI_REALTIME_MODEL=gpt-realtime-2.1
OPENAI_TRANSCRIPTION_MODEL=gpt-realtime-whisper
OPENAI_TRANSCRIPTION_DELAY=high
OPENAI_POST_CALL_TRANSCRIPTION_MODEL=gpt-transcribe
OPENAI_REALTIME_MALE_VOICE=cedar
OPENAI_REALTIME_FEMALE_VOICE=marin
```

Repeatable baseline and external-worker outage drills are available through
`drill:real-call` and the PII-safe `drill:real-call:inspect` assertions. They require
explicit recipient authorization and never print the target number or generated test
credentials. Follow [the real-provider drill procedure](docs/real-provider-drills.md);
do not run it against an unapproved recipient or expose the mock verification driver
through a public application endpoint.

The API includes the identity foundation endpoints under `/api/auth`: registration,
phone verification/resend, login, logout, and current-session lookup. Registration
requires separate first and last names and a Twilio Verify SMS confirmation. Local
development uses `VERIFICATION_DRIVER=mock` and `MOCK_VERIFICATION_CODE=000000`;
never use the mock driver in a public environment.

The web app exposes the corresponding localized flows at `/en/register`, `/en/verify`,
`/en/login` and their `/de` equivalents. Browser API requests include credentials so
the opaque HttpOnly session cookie is used without exposing its token to JavaScript.
The localized `/app` tree is guarded through a server-side current-session lookup,
and every existing `/admin` page additionally requires an `admin` or `superadmin`
role before rendering. `INTERNAL_API_URL` configures the private API origin used by
those server checks. The old localized Dashboard/call-detail routes were deliberately
removed without compatibility redirects while the product remains local pre-beta.
New briefs are assigned to that authenticated user, list queries are
owner-scoped, and foreign IDs receive the same `CALL_NOT_FOUND` response across normal
reads, mutations, SSE, recordings, approvals, and transcript retry. Signed provider
webhooks remain independent of browser sessions. Pre-authentication database rows stay
hidden until their archive/backfill policy is defined.

The backend exposes narrowly scoped account controls at
`PUT /api/admin/users/:userId/status` and
`POST /api/admin/users/:userId/sessions/revoke`. Only active `admin` or
`superadmin` accounts may use them; ordinary admins can act only on `user`
accounts, self-actions are rejected, browser origins are checked, and every action
requires a short reason. Suspension and session revocation are atomic in PostgreSQL.
Suspension immediately revokes every session, while unsuspension never restores old
tokens. Administrators can search the accounts visible to their role at
`GET /api/admin/users` and load a selected append-only ledger at
`GET /api/admin/users/:userId/credits`; the localized console is available at
`/en/admin/users` and `/de/admin/users`. Search responses expose verification state,
but not phone numbers, password hashes, or session credentials. Ordinary admins see
only `user` accounts, while superadmins may inspect staff roles. Broader user-detail
data remains roadmap work. The selected-user panel consolidates reasoned
suspend/unsuspend, force-logout, and manual credit-grant actions. Destructive actions
require confirmation, and credit grants are available only for active, phone-verified
targets within the acting administrator's permission scope.

Operational administrators can inspect the privacy-minimized call read model at
`/en/admin/calls` or `/de/admin/calls`. The list supports deterministic pagination
and status, outcome, consent, failure-stage, language, and date filters; its detail
Inspector reconstructs the sanitized durable timeline and outcome provenance. The
default API omits recipient identity, phone number, brief/transcript text, and private
feedback comments. Loading that sensitive content is a separate superadmin-only POST
with a mandatory reason, and every read creates immutable PostgreSQL access evidence.

The localized operational overview is available at `/en/admin` and `/de/admin`, with
24-hour, 7-day, and 30-day creation cohorts, explicit rate denominators, semantic
outcomes, recorded-duration and first-audio aggregates, reliability counters, and
optional versioned cost estimates. `/en/admin/system` and `/de/admin/system` report
the API/database request path, configured provider modes, bounded workload, recent
durable warnings/errors, PII-free hourly Twilio webhook delivery counts and
last-accepted age, the transcription/retention/provider-reconciliation job backlog,
recent retry and dead-letter state, and the global outbound-call control. Dead-letter
retries are superadmin-only, require a reason, and retain immutable evidence. Webhook
age and provider entries are operational signals only and explicitly do not claim an
upstream health probe.
Admins may stop new calls; only superadmins may resume them. Both operations require
a reason and retain immutable safety evidence.

Cost estimates are disabled by default. Set `ADMIN_COST_PRICING_VERSION` together
with any reviewed `ADMIN_COST_*_USD_MICROS_PER_MINUTE` rates to enable partial or
complete estimates. One USD equals 1,000,000 micro-dollars. The result uses completed
bounded usage and is not a provider invoice.

Phone verification grants exactly three signup credits through the append-only
credit ledger. `GET /api/usage` returns the authenticated user's reconciled balance,
active call, and ledger history. Starting a call reserves one credit atomically and
enforces one active outbound call per user. A credit is charged only after the
provider confirms a successful connection (`in-progress` or `completed`). Busy,
unanswered, canceled, and technical failures refund the reservation once.

The localized account page at `/en/app/account` or `/de/app/account` shows the
required first and last name, verified contact data, current usage, and ledger history.
Users can end the current browser session or revoke all of their own sessions through
`POST /api/auth/sessions/revoke`; both actions clear the current session cookie.

Authenticated users can redeem a code at `/en/redeem` or `/de/redeem` through
`POST /api/credits/promo-redemptions`. Active administrators can create bounded
promo campaigns and issue reasoned grants at `/en/admin/credits` or
`/de/admin/credits` through `POST /api/admin/promo-codes` and
`POST /api/admin/credit-grants`. Promo plaintext is never persisted: the server
stores an HMAC-SHA-256 digest, locks the campaign while applying global/per-user
limits, and writes the redemption and ledger grant in one transaction. Manual grants
store the acting administrator and reason. All three mutations require a caller-owned
UUID idempotency key, so safe retries cannot duplicate credit.

Immediately before reservation, the API also checks the durable global outbound-call
control, the normalized recipient suppression list, and per-user admission limits.
Public-beta defaults allow 3 starts per rolling hour, 10 per UTC day, 2 starts to the
same recipient per UTC day, and a maximum duration of 900 seconds. All starts count
toward abuse quotas even when their credit is refunded; quota accounting and credit
charging are deliberately separate. Override these values with the `CALL_MAX_*`
variables in `.env`.

Expensive authenticated endpoints have a separate process-local fixed-window rate
limit by hashed user ID and hashed IP. The shared IP budget is five times the user
budget. Defaults are 15 brief preparations/hour, 10 start requests/15 minutes,
10 promo redemption attempts/hour, 30 recording downloads/hour, and 5 transcription retries/day. A rejected request
returns `429 RATE_LIMITED` with `Retry-After`; the limits are configured through the
`API_RATE_LIMIT_*` variables. Invalid payloads and unauthorized resources are rejected
before consuming these expensive-operation budgets. Move this state to a shared
durable store before operating more than one API instance.

Operators can pause or resume all new PostgreSQL-backed outbound calls without ending
an active call. A non-empty reason is mandatory and each change is appended to the
safety audit log:

```powershell
corepack pnpm --filter @callassist/api calls:disable -- "Incident reference and reason"
corepack pnpm --filter @callassist/api calls:enable -- "Incident resolved"
```

Recipients can block future calls to their Swiss number at `/en/opt-out` or
`/de/opt-out`. The public API sends an SMS through the configured verification
provider and creates the global suppression only after the code is approved. Sends
and checks are rate-limited by hashed phone and IP; no CallAssist account is required.
The resulting immutable safety event records the recipient-request source without a
staff actor. Active `admin` and `superadmin` accounts can process staff requests or
reviewed complaints and audited lifts at `/en/admin/safety` or `/de/admin/safety`.
The API routes are `POST /api/admin/recipient-suppressions` and
`POST /api/admin/recipient-suppressions/lift`; both require an explicit reason and an
allowed browser origin. A lift should be used only after identity and renewed consent
have been verified.

Keep the tunnel running, apply migrations, and restart the API. Cloudflare Quick Tunnel URLs change between sessions, so update `PUBLIC_BASE_URL` whenever a new tunnel is created. Quick Tunnel is for development only and has no uptime guarantee.

## Quality checks

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The PostgreSQL integration test uses `TEST_DATABASE_URL`, which `pnpm env:init` configures for the local Docker database.

## Roadmap

- Complete the accepted operator-console
  [UI/UX stabilization milestone](docs/ui-ux-stabilization-plan.md), including its
  internationalization foundation, before adding new product screens.
- Continue hardening reviewed, versioned multilingual call plans and their
  deterministic server-side policy boundary.
- Evaluate semantic preservation, call success, latency, live/final transcription,
  Swiss German, multilingual input, and adversarial prompts.
- Add complaint intake/ownership, remaining abuse thresholds, and distributed
  endpoint rate limits before accepting public data at multiple API instances.
- Continue from the completed durable transcription/retention, Twilio status
  reconciliation, webhook-delivery visibility, split worker runtime, real-provider
  crash drills, cross-process live state, and worker heartbeat visibility with
  production probes, alerts, and incident ownership.
- Add production deployment, alerting, compliance,
  and staged invite-only/public beta release gates.

See the [public MVP roadmap](docs/mvp-plan.md) for the implementation sequence,
product principles, and launch gates.
