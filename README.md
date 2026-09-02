# SHPROHLI

SHPROHLI is a privacy-conscious AI voice assistant for controlled outbound phone calls. A user prepares a structured call brief, chooses the call language and a preset assistant profile, monitors a live transcript, and retains control over sensitive disclosures.

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
- Makes initial brief preparation retry-safe with a browser-stable UUID and a
  PostgreSQL uniqueness boundary, so a lost response cannot create duplicate briefs.
- Requires DTMF consent before recipient audio is sent to the model or recorded.
- Starts a dual-channel Twilio recording only after consent is confirmed.
- Streams a fast draft transcript to the web console over a heartbeat-backed SSE
  connection whose subscription follows the response lifecycle through proxies.
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

Deployment probes must use the main API's separate non-cacheable health contracts:
`GET /health/live` is process-only and `GET /health/ready` checks PostgreSQL. The
Twilio-only listener deliberately exposes neither route. Operational thresholds,
PII-safe logging rules, ownership requirements, and response procedures are defined
in [the operations readiness runbook](docs/operations-readiness.md).

Both HTTP listeners enforce bounded request bodies and request/connection timeouts.
API responses carry a restrictive browser security-header policy; the web application
adds a Next.js-compatible CSP and the same anti-framing, MIME-sniffing, referrer and
permissions boundaries. HSTS is emitted only by production/HTTPS configurations.
Unsafe browser requests with a foreign `Origin` are rejected before route dispatch,
while `SameSite=Lax` session cookies provide the primary CSRF boundary. Production
sessions use a `Secure`, `HttpOnly`, high-priority `__Host-` cookie.

`pnpm env:init` creates `.env` with independent encryption, promo-code HMAC,
rate-limit HMAC, and email-verification HMAC keys and never overwrites an existing file. Existing local development
environments may temporarily derive rate-limit HMACs from `DATA_ENCRYPTION_KEY`;
production requires an explicit independent `RATE_LIMIT_HASH_KEY`. Existing promo
deployments may temporarily fall back to `DATA_ENCRYPTION_KEY`, but should set and
rotate a separate `PROMO_CODE_HASH_KEY` before issuing codes.

PostgreSQL deployments write private JSON as authenticated `v2` envelopes containing
an authenticated key ID. `DATA_ENCRYPTION_ACTIVE_KEY_ID` names the write key,
`DATA_ENCRYPTION_PREVIOUS_KEYS` supplies decrypt-only keys during a controlled
rotation, and `DATA_ENCRYPTION_LEGACY_V1_KEY_ID` maps unversioned-key `v1` rows to the
correct retained key. Production configuration requires an explicit active ID and
rejects duplicate IDs or reused key material. See the
[recovery and secret-operations runbook](docs/database-recovery-and-secrets.md) before
changing any data-encryption setting.

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
phone verification/resend, login, verified-phone password recovery, authenticated
verified-phone change, verified login-email change, logout, and
current-session lookup. Registration requires separate first and last names and a
Twilio Verify SMS confirmation. Recovery uses a generic non-enumerating start, a
durable eight-attempt OTP challenge, and a 15-minute single-use grant whose digest is
stored; completion changes the scrypt password and revokes every session atomically.
Phone change requires the current password and a session-bound 10-minute OTP challenge
for the unique replacement number; completion keeps only the initiating session and
invalidates unused recovery capabilities created for the old phone.
Local development uses `VERIFICATION_DRIVER=mock` and `MOCK_VERIFICATION_CODE=000000`;
never use the mock driver in a public environment.

Email change requires the current password and a session-bound 10-minute code sent to
the proposed unique address. The old address remains the login identity until that code
is verified; completion keeps the initiating session, revokes the others, invalidates
unused recovery capabilities, and sends a notice to the old address. Local development
uses `EMAIL_DRIVER=mock`. Production fails closed unless `EMAIL_DRIVER=resend`,
`RESEND_API_KEY`, `EMAIL_FROM`, and an independent base64 32-byte
`EMAIL_VERIFICATION_HASH_KEY` are configured.

The web app exposes the corresponding localized flows at `/en/register`, `/en/verify`,
`/en/login`, `/en/recover` and their `/de` equivalents. Recovery capabilities stay
in page memory rather than URLs or browser storage. Browser API requests include credentials so
the opaque HttpOnly session cookie is used without exposing its token to JavaScript.
The localized `/app` tree is guarded through a server-side current-session lookup.
The separate English-only `/admin` tree performs the same server-side session and
onboarding checks, allows content editors only into content/SEO routes, and reserves
operational routes for `admin` and `superadmin`. `INTERNAL_API_URL` configures the private API origin used by
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
`GET /api/admin/users/:userId/credits`; the console is available at `/admin/users`.
Search responses expose verification state,
but not phone numbers, password hashes, or session credentials. Ordinary admins see
only `user` accounts, while superadmins may inspect staff roles. Broader user-detail
data remains roadmap work. The selected-user panel consolidates reasoned
suspend/unsuspend, force-logout, and manual credit-grant actions. Destructive actions
require confirmation, and credit grants are available only for active, phone-verified
targets within the acting administrator's permission scope.

Operational administrators can inspect the privacy-minimized call read model at
`/admin/calls`. The list supports deterministic pagination
and status, outcome, consent, failure-stage, language, and date filters; its detail
Inspector reconstructs the sanitized durable timeline and outcome provenance. The
default API omits recipient identity, phone number, brief/transcript text, and private
feedback comments. Loading that sensitive content is a separate superadmin-only POST
with a mandatory reason, and every read creates immutable PostgreSQL access evidence.

The operational overview is available at `/admin`, with
24-hour, 7-day, and 30-day creation cohorts, explicit rate denominators, semantic
outcomes, recorded-duration and first-audio aggregates, reliability counters, and
optional versioned cost estimates. `/admin/system` reports
the API/database request path, configured provider modes, bounded workload, recent
durable warnings/errors, PII-free hourly Twilio webhook delivery counts and
last-accepted age, the transcription/retention/provider-reconciliation job backlog,
recent retry and dead-letter state, and the global outbound-call control. Dead-letter
retries are superadmin-only, require a reason, and retain immutable evidence. Webhook
age and provider entries are operational signals only and explicitly do not claim an
upstream health probe.
The same view evaluates versioned snapshot alerts for external-worker availability,
dead-letter/backlogged work, overdue retention, callback processing failures, and
recent technical errors. They are local policy results, not proof of notification;
production routing and named on-call ownership remain release work.
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
The same localized account UI can update the account name and replace the login email
or verified mobile after password and email/SMS step-up without exposing a challenge in
a URL or browser storage.
It also lists up to 50 active sessions using bounded browser/platform categories rather
than raw User-Agent values. Users can revoke one owner-scoped session, end the current
browser session, or revoke all sessions; revoking the current/all sessions clears the
cookie. Selective and all-session security actions append immutable, privacy-minimized
audit evidence. The same page can request `POST /api/account/data-export` and download
a versioned, no-store JSON attachment containing the authenticated user's profile,
bounded session summaries, complete ledger and legal acceptances, plus owned call,
consent, transcript, outcome, and feedback data. The server removes authentication
secrets, raw client details, provider identifiers, and foreign staff IDs; generation
is rate-limited and records only immutable export ID/count/size/time evidence, never
the document itself. This self-service file supports data access but is not a substitute
for the separately required Swiss privacy/legal review and formal request workflow.

Authenticated users can redeem a code at `/en/redeem` or `/de/redeem` through
`POST /api/credits/promo-redemptions`. Active administrators can create bounded
promo campaigns and issue reasoned grants at `/admin/credits` through
`POST /api/admin/promo-codes` and
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

Expensive authenticated endpoints have a separate fixed-window rate limit by keyed
HMAC digests of user ID and IP. PostgreSQL deployments share those buckets atomically
across API instances; memory mode is for single-process development. The shared IP budget is five times the user
budget. Defaults are 15 brief preparations/hour, 10 start requests/15 minutes,
10 promo redemption attempts/hour, 30 recording downloads/hour, 5 transcription
retries/day, and 2 account-data exports/day. A rejected request
returns `429 RATE_LIMITED` with `Retry-After`; the limits are configured through the
`API_RATE_LIMIT_*` variables. Invalid payloads and unauthorized resources are rejected
before consuming these expensive-operation budgets. Store outages fail closed with
`503 RATE_LIMIT_UNAVAILABLE` before the expensive side effect. Privacy-safe aggregate
status is visible in Admin System; the complete policy and rotation boundary are in
[`docs/rate-limit-policy.md`](docs/rate-limit-policy.md).

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
and checks are rate-limited by hashed phone and IP; no SHPROHLI account is required.
The resulting immutable safety event records the recipient-request source without a
staff actor. Active `admin` and `superadmin` accounts can process staff requests or
reviewed complaints and audited lifts at `/admin/safety`.
The API routes are `POST /api/admin/recipient-suppressions` and
`POST /api/admin/recipient-suppressions/lift`; both require an explicit reason and an
allowed browser origin. A lift should be used only after identity and renewed consent
have been verified.

Keep the tunnel running, apply migrations, and restart the API. Cloudflare Quick Tunnel URLs change between sessions, so update `PUBLIC_BASE_URL` whenever a new tunnel is created. Quick Tunnel is for development only and has no uptime guarantee.

## Quality checks

```powershell
pnpm db:migrate:check
pnpm db:recovery:drill
pnpm security:audit
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The migration check requires contiguous, canonical filenames and non-empty SQL.
Applied migrations retain a SHA-256 checksum; changing or removing an already
recorded migration causes migration startup to fail before new SQL runs. Existing
databases bootstrap checksums once, after which drift is rejected. The security audit
blocks high and critical production-dependency advisories; lower-severity findings still require
review rather than being described as absent.

The sole `0013_final_transcript_quality.sql` tombstone recognizes a migration applied
by the pre-identity local MVP. It is never executed for a fresh database; every other
applied migration must still exist in the canonical catalog.

The repository CI workflow performs a frozen install, validates and applies the
migrations twice against PostgreSQL, runs lint/typecheck/all tests, proves resumable
data re-encryption against the populated integration database, executes a disposable
backup/restore proof, audits production dependencies, and builds production artifacts.
GitHub branch protection must still make that workflow required before merge.

The recovery drill accepts only a local application database, restores a temporary
custom-format dump into a guarded disposable database, verifies migration checksums,
table inventory/row counts and available encrypted samples, emits PII-free JSON
evidence, then removes the restore database and dump. Production policy, provisional RPO/RTO and the secret
rotation constraints are documented in
[the recovery and secret-operations runbook](docs/database-recovery-and-secrets.md).

The PostgreSQL integration test uses `TEST_DATABASE_URL`, which `pnpm env:init` configures for the local Docker database.

## Roadmap

- Complete the accepted operator-console
  [UI/UX stabilization milestone](docs/ui-ux-stabilization-plan.md), including its
  internationalization foundation, before adding new product screens.
- Continue hardening reviewed, versioned multilingual call plans and their
  deterministic server-side policy boundary.
- Evaluate semantic preservation, call success, latency, live/final transcription,
  Swiss German, multilingual input, and adversarial prompts.
- Add complaint intake/ownership, mass-account correlation, infrastructure abuse
  thresholds, and alert routing before accepting unrestricted public data. Shared
  cross-instance application limits are complete.
- Continue from the completed durable transcription/retention, Twilio status
  reconciliation, webhook-delivery visibility, split worker runtime, real-provider
  crash drills, cross-process live state, and worker heartbeat visibility with
  production upstream probes, monitor/pager routing, protected log storage, and named
  incident ownership. Local liveness/readiness, PII-safe logger boundaries, versioned
  snapshot alerts, and role-based runbooks are complete.
- Continue from the completed application-security/CI foundation with a hosted CI
  run, required branch protection, production managed-backup/restore evidence,
  managed-secret deployment and an exercised production key rotation, infrastructure
  limits, and an independent focused review. Versioned dual-read/new-write encryption,
  resumable re-encryption, the local recovery drill, and the operations contract exist.
- Add production deployment, alerting, compliance,
  and staged invite-only/public beta release gates.

See the [public MVP roadmap](docs/mvp-plan.md) for the implementation sequence,
product principles, and launch gates.
