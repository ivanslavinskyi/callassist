# CallAssist

CallAssist is a privacy-conscious AI voice assistant for controlled outbound phone calls. A user prepares a structured call brief, chooses the language and voice, monitors a live transcript, and retains control over sensitive disclosures.

> **Project status:** working MVP for supervised testing. It is not yet intended for unattended or production-critical calling.

## What it does

- Places outbound PSTN calls through Twilio Programmable Voice.
- Runs a natural speech-to-speech conversation through OpenAI Realtime.
- Uses one selected voice for the disclosure, consent request, and conversation.
- Requires DTMF consent before recipient audio is sent to the model.
- Streams partial and final transcript segments to the web console over SSE.
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
```

The public Twilio surface is isolated on a dedicated listener. The main API, SSE endpoints, and decrypted application data are not exposed through the development tunnel.

## Security model

- Twilio call recording is disabled.
- Recipient audio is discarded until consent is confirmed by pressing `1`.
- Twilio HTTP and WebSocket requests are signature-validated.
- Every media stream carries an additional call-scoped HMAC token.
- Private fields are encrypted before PostgreSQL persistence.
- The model is instructed to use only the call objective and explicitly approved facts.
- Sensitive actions remain server-owned; a deterministic production policy gate is still on the roadmap.

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
OPENAI_API_KEY=sk-...
OPENAI_REALTIME_MODEL=gpt-realtime-2.1
OPENAI_TRANSCRIPTION_MODEL=gpt-realtime-whisper
OPENAI_TRANSCRIPTION_DELAY=high
OPENAI_REALTIME_MALE_VOICE=cedar
OPENAI_REALTIME_FEMALE_VOICE=marin
```

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

- Measure end-of-turn latency and transcription quality with representative PSTN audio and Swiss German speakers.
- Move all sensitive actions from prompt rules into a deterministic policy gate.
- Add production deployment, background scheduling/retries, and PWA hardening.

See the [MVP roadmap](docs/mvp-plan.md) for the implementation sequence.
