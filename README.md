# SHPROHLI

SHPROHLI helps people make everyday phone calls when speaking or the local language
is a barrier. Users prepare a plan, review and approve it, follow a live transcript,
and receive a recording-based final transcript.

**Repository status, 2026-09-07:** implemented supervised MVP with substantial beta
infrastructure. Public-beta launch readiness has **not** been established. See the
[audit](docs/project-audit-2026-09-07.md) and [release roadmap](docs/mvp-plan.md).
The public product copy uses “public beta”; that wording is not deployment evidence.

## Implemented product

- Authenticated EN/DE customer application, account recovery, verified phone/email
  changes, session management, export, call deletion and queued account anonymization.
- Durable, retry-safe initial call preparation; multilingual compilation, moderation,
  deterministic policy checks, editing/recompilation, review and approve-and-call.
- Swiss-number outbound calls via Twilio and speech conversation via OpenAI Realtime.
- Six server-owned assistant profiles. Assistance reason defaults to `none`;
  `speech_impairment` and `language_barrier` add an optional controlled disclosure.
- Spoken consent, one clarification, then keypad fallback. Before consent, recipient
  audio can reach a separate OpenAI session **only to recognize the consent answer**;
  it is not recorded by the application or forwarded to the main conversation.
- Dual-channel recording after consent and confirmed recording startup. Final
  transcription normally splits the recording into channel-labelled utterances;
  mono/unsupported audio falls back to a whole-recording plain-text transcript.
- Live SSE transcript, recording playback proxy, clipboard/PDF export, feedback,
  retention choices of 0/7/30 days and manual recording deletion.
- Three signup credits, transactional reserve/charge/refund, quotas, recipient
  suppression, SMS-verified opt-out and an audited outbound-call kill switch.
- English-only `/admin` for content, SEO, users, calls, credits, safety and system
  operations; sensitive call reads require superadmin and an audited reason.
- Versioned EN/DE public pages, Landing/FAQ/Navigation collections, drafts, previews,
  publication/history/rollback and Terms/AUP re-acceptance.

Call locales: `de-CH`, `de-DE`, `fr-CH`, `it-CH`, `en-GB`, `en-US`, `ru-RU`.
`de-CH` means Swiss Standard German. UI locale and call language are independent.

## Architecture

```text
Next.js web -- HTTP/SSE --> Fastify main API -- PostgreSQL
                                  |                |
Twilio-only ingress (same process) |       durable work + invalidation
              |                   |                |
     Twilio Media Stream <--> Realtime bridge   standalone worker
              |                   |                |
       consented recording     OpenAI          compiler / ASR /
                                            retention / reconciliation
```

The Twilio listener is isolated from application routes but shares the API process.
The worker is a separate entry point; development can run it embedded. PostgreSQL
holds authoritative state, leases, audit and credits. Selected fields use AES-256-GCM;
names, numbers, runtime objectives and live transcript rows are **not all encrypted
at the application layer**. See [architecture and data boundaries](docs/architecture.md).

## Local development

Requirements: Node.js 22.19+, pnpm 10.12.4 through Corepack, Docker with PostgreSQL 17.

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm env:init
pnpm db:up
pnpm db:test:prepare
pnpm db:migrate
pnpm dev
```

`env:init` creates a root `.env` with independent local keys and never overwrites it.
The current example uses PostgreSQL port **56432**; Compose falls back to **55432**
when `POSTGRES_PORT` is absent. Existing `.env` files can therefore use a different
port. `DATABASE_URL`, `TEST_DATABASE_URL` and the published Compose port must agree.
Use a separate disposable test database: integration tests write and delete fixtures.

Web: [localhost:3000](http://localhost:3000); main API: port 4000.
Open `/en` or `/de`, register, and verify with `000000` in mock mode.
`STORAGE_DRIVER=memory` is available for disposable single-process development.
The API does not automatically restart on edits; restart manually between calls.

API/worker load the root `.env`. The Next.js configuration imports only
`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL` and `INTERNAL_API_URL` from that file.
Injected values and Next project-local env values take precedence. Other root secrets
are not imported into the web process. See [runtime configuration](docs/runtime-reference.md).

On PowerShell systems blocking `.ps1` shims, use `pnpm.cmd` or `corepack pnpm`;
Turbo still needs a pnpm executable on `PATH`.

For a split development runtime, set `DURABLE_WORKER_MODE=external`, restart the API,
and run:

```powershell
corepack pnpm --filter @callassist/api worker
```

Both processes must use the same database/keyring and compiler configuration.
The API enqueues initial preparation and the worker compiles it. If the worker is
stopped, a newly submitted preparation will remain queued.

## Quality checks

```powershell
pnpm copy:check
pnpm db:migrate:check
pnpm lint --force
pnpm typecheck --force
pnpm test
pnpm build --force
pnpm security:audit
pnpm db:recovery:drill
```

Set `TEST_DATABASE_URL` to a dedicated `*_test` database. Missing or unavailable
databases fail integration tests; test tasks are never cached. Turbo passes declared
test/build values in strict mode and hashes env files and web origins. Isolated
rotation/retention tests require a test database role with CREATEDB, as in CI.

After a route removal, rebuild Next.js to regenerate stale `.next/types` before
interpreting missing-route type errors as source failures.

Audit results: **503 tests passed** (325 API, 108 web, 70 contracts), lint/typecheck
and build passed; 49 migrations applied/replayed; backup/restore verified 51 tables.
The dependency gate **failed** with 8 high and 2 moderate findings. Targeted probes
also found consent false positives and transcript delivery after session revocation,
plus rotation, worker-configuration and deletion gaps. See the
[dated evidence and limitations](docs/project-audit-2026-09-07.md#verification).

## Real providers and deployment

The defaults are mock telephony, verification, email and compilation. A real call
requires Twilio Voice/Verify, OpenAI credentials, a CH destination and a publicly
reachable signed webhook/Media Stream listener. `pnpm tunnel:twilio` exposes only
the development Twilio gateway at `127.0.0.1:4001`; Quick Tunnel is development-only.
Model IDs and voice settings are listed in [runtime reference](docs/runtime-reference.md).

The legacy `drill:real-call` runner is currently incompatible with asynchronous
preparation. Do not treat it as a working launch check; use the manual supervised
procedure and limitations in [real-provider drills](docs/real-provider-drills.md).
No real calls, SMS or email are part of the automated audit suite.

Production requires external workers, durable storage, managed secrets, TLS, a
same-host web/API cookie topology, restricted Twilio geographic permissions and
completed operational/privacy gates. Both API and worker require explicit
`BRIEF_COMPILER_DRIVER=openai` in production; missing or mock drivers fail startup.
Rotation and restore verification cover all nine ciphertext families. See the
[remediation evidence](docs/remediation-2026-09-07.md) and [recovery runbook](docs/database-recovery-and-secrets.md).

## Documentation

- [Documentation index](docs/README.md): current references and historical plans.
- [Architecture](docs/architecture.md): runtime, ownership, consent, data and limitations.
- [Runtime/API reference](docs/runtime-reference.md): configuration and implemented routes.
- [Roadmap](docs/mvp-plan.md): delivered capabilities, next work and release gates.
- [Project audit, 2026-09-07](docs/project-audit-2026-09-07.md): findings and verification.

Internal package names remain `callassist` / `@callassist/*`; the public brand is SHPROHLI.
