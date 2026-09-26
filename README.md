# SHPROHLI

SHPROHLI helps people make everyday phone calls when speaking or the local language
is a barrier. Users prepare a plan, review and approve it, follow a live transcript,
and receive a recording-based final transcript with optional translation and an
evidence-linked summary.

**Current branch, 2026-09-25:** `feat/gpt-live-pilot` includes the parallel
GPT-Live runtime and registration/call-flow improvements. Source migrations run
through **0083**. Local checks on implementation commit `457c9b2` passed:
**1,591 tests / 191 files** (API 1,182; web 281; contracts 128), full lint,
typecheck, production build and the seven-locale browser smoke.

Realtime remains the production default. Both Realtime and Live passed a short
recipient-authorized Twilio smoke in an isolated local database; this is separate
from broader conversational acceptance. Full onboarding and required email remain
the default registration policy. A superadmin can enable registration-time legal
agreement and optional email deferral independently in Admin > System.

**Owner acceptance, merge and production deployment are pending.** Public-release
operational and provider gates remain open in the [roadmap](docs/mvp-plan.md).
See the [Live pilot](docs/gpt-live-pilot.md),
[registration/call implementation and checks](docs/registration-and-call-improvements-2026-09-25.md),
[local testing runbook](docs/local-testing.md) and [documentation index](docs/README.md).
Earlier audits remain dated evidence, not proof of the current deployment.

The current branch also implements [AMD and voicemail beta](docs/amd-voicemail-beta.md):
silent answer detection before consent, one approved neutral message after a beep,
separate lifecycle results, repeat review and provider accounting. Its real-call
acceptance is still required before production rollout.

## Implemented product

- Authenticated DE/FR/IT/RM/EN/RU/UK customer application, account recovery, verified phone/email
  changes, session management, export, call deletion and queued account anonymization.
- Configurable full onboarding or registration-time Terms/AUP/Privacy agreement.
  After SMS, the email verification screen always appears; when enabled, users can
  explicitly defer it. Deferral persists for that address without marking it verified.
  Required-email policy blocks new call starts. Branded HTML/plain-text verification and
  security notices, explicit communication locales and shared SMS budgets. Account
  phone verification supports CH/UA; outbound calls and recipient opt-out remain CH.
- Durable, retry-safe creation, editing and clarification of call plans; multilingual compilation, moderation,
  deterministic policy checks, editing/recompilation, review and approve-and-call.
- Separate UI, call and task-content languages; account preferences, captured language
  resolution and exact original/translated plan approval receipts. All facts in the
  approved plan may be used as needed. Appointment actions require a separate,
  explicit permission in that plan. Booking or confirming one appointment/personal
  meeting is implemented with approved date/time windows and a server permission
  check. Recipient confirmation establishes the result; there is no calendar integration,
  rescheduling, cancellation or permission to accept new financial terms.
- Swiss-number outbound calls via Twilio, with selectable Realtime or native Live
  conversation and Responses delegation. Both preserve PCMU/G.711 and application-owned
  consent, authorization, appointment confirmation and playback-aware call control.
- Six server-owned assistant profiles. Assistance reason defaults to `none`;
  `speech_impairment` and `language_barrier` add an optional controlled disclosure.
- Spoken consent, one clarification, then keypad fallback. Before consent, recipient
  audio can reach a separate OpenAI session **only to recognize the consent answer**;
  it is not recorded by the application or forwarded to the main conversation.
- Dual-channel recording after consent and confirmed recording startup. Final
  transcription normally splits the recording into channel-labelled utterances;
  mono/unsupported audio falls back to a whole-recording plain-text transcript.
- Repeat definitively unanswered calls into a new draft with the saved compilation,
  fresh review/approval and current admission checks; unchanged plans incur no new
  compiler request. History/recent calls show a truncated source-language objective.
  Settled calls ending without received consent also support repeat; explicit refusal
  and consented conversations do not.
- Visible New call/History navigation on mobile; saved feedback is read-only until Edit.
- Live SSE transcript, recording playback proxy, clipboard/PDF export, feedback,
  retention choices of 0/7/30 days and manual recording deletion.
- Playback-aware agent hangup behind `REALTIME_AGENT_HANGUP_ENABLED`; interrupted
  farewells are explicitly resolved before answering, waiting or ending again.
  Live transcript following survives streaming/reconnect and pauses for manual reading.
- Immutable original transcript revisions, optional translations and summaries with
  compact findings and source links, resumable bounded jobs, clipboard copy and
  branded PDF export of the displayed transcript. Enabled
  generation directions are configured independently from interface languages;
  zero-day audio deletion happens after the final transcript and does not erase text.
- Three signup credits, transactional reserve/charge/refund, quotas, recipient
  suppression, SMS-verified opt-out after proven outbound contact and an audited
  outbound-call kill switch. Staff can apply suppression without call history.
- Primarily English `/admin` (registration policy controls support all seven locales) for content, SEO, users, calls, credits, safety and system
  operations; sensitive call reads require superadmin and an audited reason.
- Versioned public pages in seven UI locales, Landing/FAQ/Navigation collections, drafts, previews,
  publication/history/rollback and Terms/AUP re-acceptance.
- Unified provider expense explorer with Cost / Usage / Requests, billing snapshots
  and explicit gaps; durable, localized superadmin email reports.
- Homepage OG image templates/uploads, versioned publishing and rollback in Admin SEO.
- Superadmin telemetry export in Admin Calls: background ZIP/JSONL, 36 retained data
  sources, bounded streaming, encrypted storage, 24-hour expiry and deletion revocation.

Public selectable call locales: `de-CH`, `fr-CH`, `it-CH`, `en-GB`. Russian (`ru-RU`) is available only to superadmins, as either the primary or fallback call language. The API checks the current role on preparation, recompilation, approval and start; historical calls and Russian text translations remain readable.
Historical `de-DE` and `en-US` remain supported by persisted contracts. Editable forms
normalize them to `de-CH` and `en-GB`, including fallback choices; saved snapshots stay
unchanged. Call-language labels are localized independently of UI language availability.
`de-CH` means Swiss Standard German. UI locale,
task content language and call language are independent; call-language labels follow
the interface locale.

New tasks use the detected input language for plan/result text, with a compact
correction before approval. The account preference is a fallback. Results use that
saved task language; transcript translation is on demand, with original/translation
views. The UI has no separate result-language menus. Text languages are currently
`en`, `de`, `fr`, `it`, `ru`, `uk`; UI dictionaries are DE/FR/IT/RM/EN/RU/UK. Enabling another UI
dictionary does not change call contracts or enable a text-provider direction.

## Architecture

```text
Next.js web -- HTTP/SSE --> Fastify main API -- PostgreSQL
                                  |                |
Twilio-only ingress (same process) |       durable work + invalidation
              |                   |                |
     Twilio Media Stream <--> voice runtime     standalone worker
              |                   |                |
       consented recording     OpenAI          compiler / ASR / text artifacts /
                                            retention / reconciliation
```

The voice factory selects `OpenAIRealtimeBridge` (default) or `OpenAILiveBridge`.
Live keeps bounded Realtime consent/opening/farewell speech and delegates its main
conversation to native Live/Responses; both providers appear in the cost ledger.

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
Open `/en`, `/de`, `/fr`, `/it`, `/rm`, `/ru` or `/uk`, register, and verify with `000000` in mock mode.
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
The API enqueues preparation and the worker compiles it. Separate worker loops handle
text artifacts, account deletion, superadmin notifications and telemetry exports.
If the worker is stopped, their asynchronous work remains queued. See the
[telemetry runbook](docs/admin-call-telemetry-export.md) for limits, heartbeat and cleanup.

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

The migration catalog now extends through `0083_call_retry_sources.sql`.
Public opt-out requires a separate `TWILIO_OPT_OUT_VERIFY_SERVICE_SID` and a stable
`RECIPIENT_CONTACT_HASH_KEY` shared by API/workers. Follow the
[opt-out deployment and backfill procedure](docs/recipient-opt-out.md) and
[deployment preflight](docs/deployment-preflight.md); pushing code does not configure them.
Latest implementation checks and their limits are recorded in the
[25 September acceptance record](docs/registration-and-call-improvements-2026-09-25.md).
The source catalog and automated checks do not establish the migration or acceptance
state of a deployment database. Never repair checksum mismatches by rewriting applied
migrations; use a fresh disposable test database for isolated test runs.

## Real providers and deployment

The optional [GPT-Live pilot](docs/gpt-live-pilot.md) adds native Live/Responses
alongside Realtime, with local real-call smoke instructions. Realtime remains the default.

The defaults are mock telephony, verification, email and compilation. A real call
requires Twilio Voice/Verify, OpenAI credentials, a CH destination and a publicly
reachable signed webhook/Media Stream listener. `pnpm tunnel:twilio` exposes only
the development Twilio gateway at `127.0.0.1:4001`; Quick Tunnel is development-only.
Model IDs and voice settings are listed in [runtime reference](docs/runtime-reference.md).

Use the signed-in UI for supervised calls: it captures exact review evidence before
starting. For repeatable Realtime/Live acceptance, `drill:voice-runtime` provides
prepare/start/verify stages with the current review receipt, explicit authorization
and an isolated test database. Follow the [Live smoke procedure](docs/gpt-live-pilot.md#local-real-call-smoke).
The older `drill:real-call` start stage still lacks review-policy-v2 evidence;
its limitation is documented in [real-provider drills](docs/real-provider-drills.md).
Default unit/integration tests use mock providers. Explicit opt-in verification
scripts such as `verify-general-call-results.ts --run-provider` make paid text-model
requests using fictional fixtures; they do not place telephone calls.

Production requires external workers, durable storage, managed secrets, TLS, a
same-host web/API cookie topology, restricted Twilio geographic permissions and
completed operational/privacy gates. Both API and worker require explicit
`BRIEF_COMPILER_DRIVER=openai` in production; missing or mock drivers fail startup.
Rotation and restore verification cover all twenty ciphertext columns. See the
[remediation evidence](docs/remediation-2026-09-07.md) and [recovery runbook](docs/database-recovery-and-secrets.md).

## Documentation

- [Documentation index](docs/README.md): current references and historical plans.
- [Architecture](docs/architecture.md): runtime, ownership, consent, data and limitations.
- [Runtime/API reference](docs/runtime-reference.md): configuration and implemented routes.
- [Roadmap](docs/mvp-plan.md): delivered capabilities, next work and release gates.
- [Project audit, 2026-09-07](docs/project-audit-2026-09-07.md): findings and verification.

Internal package names remain `callassist` / `@callassist/*`; the public brand is SHPROHLI.
