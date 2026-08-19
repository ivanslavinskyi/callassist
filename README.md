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

See [Architecture](docs/architecture.md) for the detailed boundaries and data model.

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

The console runs at `http://localhost:3000`; the API runs at `http://localhost:4000`. PostgreSQL is exposed on `localhost:55432`. Set `STORAGE_DRIVER=memory` for a temporary run without PostgreSQL.

The API development process intentionally does not auto-restart when source
files change. Restart it manually between edits: an automatic restart during an
active PSTN call would terminate the Twilio Media Stream.

`pnpm env:init` creates `.env` with a unique encryption key and never overwrites an existing file.

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

The API includes the identity foundation endpoints under `/api/auth`: registration,
phone verification/resend, login, logout, and current-session lookup. Registration
requires separate first and last names and a Twilio Verify SMS confirmation. Local
development uses `VERIFICATION_DRIVER=mock` and `MOCK_VERIFICATION_CODE=000000`;
never use the mock driver in a public environment.

The web app exposes the corresponding localized flows at `/en/register`, `/en/verify`,
`/en/login` and their `/de` equivalents. Browser API requests include credentials so
the opaque HttpOnly session cookie is used without exposing its token to JavaScript.
All browser call routes now require the session when the production auth service is
configured. New briefs are assigned to that authenticated user, list queries are
owner-scoped, and foreign IDs receive the same `CALL_NOT_FOUND` response across normal
reads, mutations, SSE, recordings, approvals, and transcript retry. Signed provider
webhooks remain independent of browser sessions. Pre-authentication database rows stay
hidden until their archive/backfill policy is defined.

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
- Add authenticated users, strict data ownership, quotas, recipient opt-out, and
  abuse controls before accepting public data.
- Add interface internationalization, an accessible onboarding flow, and a public
  landing page.
- Add durable background jobs, production deployment, observability, compliance,
  and staged invite-only/public beta release gates.

See the [public MVP roadmap](docs/mvp-plan.md) for the implementation sequence,
product principles, and launch gates.
