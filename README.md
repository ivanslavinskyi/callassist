# SHPROHLI

SHPROHLI helps people make everyday phone calls when speaking or the local language
is a barrier. Users prepare a plan, review and approve it, follow a live transcript,
and receive a saved conversation transcript with optional translation and an
evidence-linked summary.

**Current work, 2026-09-29:** `codex/live-unified-runtime` replaces the hybrid Live
voice path with one Live session for consent, opening, conversation and closing.
It also adds execution-language auditing, clearer telemetry export access and
document scrolling for completed provisional transcripts. The migration catalog
extends through **0088** (native transcript provenance and published CMS copy).
Healthy native Live calls save their existing transcript as the result source;
recording transcription remains the fallback. See the
[implementation report](docs/live-transcript-implementation-2026-09-28.md).
The 28 September local checkpoint was **1880 tests / 211 files**, lint/types/build and
CMS/PDF checks. Production schema rollout and a new real-call acceptance check of
this follow-up remain open. The [documentation index](docs/README.md) links current
runtime, local testing and deployment procedures.
The form offers two voices, fixed across the call, with a calm speaking pace.
Call details show the selected voice; all transcript speaker labels and text/PDF
exports use SHPROHLI, including historical calls. Legacy profile IDs remain internal.
The [29 September follow-up](docs/live-progress-fix-2026-09-29.md) accepts consent
during disclosure, bounds noise-driven waiting and requests a managed backend
decision when native delegation misses an answer. Recipient interruption still
cancels closing; late assistant speech uses bounded farewell recovery.
Its branch verification passed 1,899 tests across 211 files after rerunning six suites
on a fresh test database, plus workspace lint and typechecking; see the report for
the historical test-database checksum issue and limits of synthetic call evidence.
See [implementation and acceptance](docs/live-unified-runtime.md).

The current implementation uses native Live **Responses delegation** with GPT-6 Luna
and `parallel_tool_calls=false`. Live handles ordinary conversation independently;
the application validates tool effects, consent, recording and playback at required
transitions. Settled answers not covered by native work receive one managed decision
request, without a separate task controller or ordinary-reply classifier.
Spoken appointment requests are journaled before protected playback and require later
contextual confirmation. Consent uses the restricted native `report_consent` tool
with `affirmative / negative / unclear`, without an application-assembled answer or
separate consent classifier. `end_call` takes a reason only; Live chooses a natural
closing, and the app verifies completion and playback before hanging up.
See the [current runtime](docs/live-unified-runtime.md) and
[28 September real-call review](docs/live-call-review-2026-09-28.md).
The [transcription recovery follow-up](docs/live-transcription-recovery-2026-09-27.md)
adds protected post-call budget capacity, automatic deferral on budget blocks,
correct text-only Live usage accounting. Ordinary speech now streams directly.

The previous follow-ups retain stable transcript cards, a played-disclosure/consent
timeline, preparation during ringing/AMD, native consent delegation, and
an automatic assessment grounded in persisted transcript facts. New native Live approvals
run AMD in the background so detection does not gate the disclaimer. The voice remains GPT-Live-1 throughout the human conversation;
silent reasoning and consent checks use GPT-6 Luna.

The owner reported production release `915a8f6` healthy with Live and fallback
disabled on 26 September; it still uses the original hybrid speech path. This
branch has not yet been deployed. Both Realtime and Live previously passed a short
recipient-authorized Twilio smoke in an isolated local database; this is separate
from broader conversational acceptance. Full onboarding and required email remain
the default registration policy. A superadmin can enable registration-time legal
agreement and optional email deferral independently in Admin > System.

**A local real Twilio information call passed on 28 September.** Voice consent was
accepted at the initial question, recording followed consent, and natural closing
completed after its playback mark. Broader acceptance and production deployment
remain pending; this single call is not a reliability rate. Public-release
operational and provider gates remain open in the [roadmap](docs/mvp-plan.md).
See the [Live pilot](docs/gpt-live-pilot.md),
[registration/call implementation and checks](docs/registration-and-call-improvements-2026-09-25.md),
[local testing runbook](docs/local-testing.md) and [documentation index](docs/README.md).
Earlier audits remain dated evidence, not proof of the current deployment.

The current branch also implements [AMD and voicemail beta](docs/amd-voicemail-beta.md):
background answer detection alongside the native Live disclosure, one approved neutral message after a beep,
separate lifecycle results, repeat review and provider accounting. Its real-call
acceptance must be repeated when changing the answering policy.
See [asynchronous AMD and manual checks](docs/async-amd-live-2026-09-28.md). Recording starts on consent independently of AMD.

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
- Two assistant voice choices: male Cedar and female Marin for native Live. New
  approvals freeze the voice ID; historical profile names remain readable. The same
  session retains voice identity from disclaimer to farewell and uses a calm,
  slightly slower speaking pace. See [voice behavior and verification](docs/live-voice-continuity-2026-09-28.md).
  Assistance reason defaults to `none`;
  `speech_impairment` and `language_barrier` add an optional controlled disclosure.
- Spoken consent, one clarification, then optional keypad fallback; voice remains
  available after clarification. Unified Live uses native managed consent delegation;
  Realtime/legacy hybrid uses its separate consent-recognition session. Neither
  path stores recipient audio or words before consent; only the legacy path
  isolates that audio from a separate main conversation socket.
- Dual-channel recording after consent and confirmed recording startup. Healthy
  native Live calls preserve the transcript produced during the conversation.
  Recording fallback splits supported audio into channel-labelled utterances;
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
views. The UI has no separate result-language menus. Text processing accepts recognized
language tags, including languages outside the quick presets `en`, `de`, `fr`, `it`, `ru`, `uk`;
UI dictionaries are DE/FR/IT/RM/EN/RU/UK. The original task can contain mixed-language
context. Compilation produces the execution plan in the selected call language and
automatically translates that plan back for review, including conditions, constraints
and follow-up questions. Approval binds both versions; the display translation never
enters the voice runtime or changes its call language or permissions.
Enable `plan_review:*:*,clarification_review:*:*` in `TEXT_ARTIFACT_DIRECTIONS` on API and
worker for automatic reviews in the input language. Preserve existing summary/transcript
directions. Enabling another UI dictionary alone does not enable a provider direction.

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
With fallback disabled, Live uses one native voice session for the human call,
including consent and closing, with native managed Responses delegation to GPT-6 Luna. Application
state, recording permission, tool authorization and Twilio playback remain outside
the model. Explicit fallback opt-in retains the old hybrid pilot for rollback testing.

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

The migration catalog now extends through `0088_conversation_transcript_copy.sql` (including native transcript provenance and the CMS publication upgrade).
Public opt-out requires a separate `TWILIO_OPT_OUT_VERIFY_SERVICE_SID` and a stable
`RECIPIENT_CONTACT_HASH_KEY` shared by API/workers. Follow the
[opt-out deployment and backfill procedure](docs/recipient-opt-out.md) and
[deployment preflight](docs/deployment-preflight.md); pushing code does not configure them.
Latest voice implementation checks, user-reported continuity acceptance and pending
pace listening checks are recorded in the [28 September voice follow-up](docs/live-voice-continuity-2026-09-28.md).
The [25 September acceptance record](docs/registration-and-call-improvements-2026-09-25.md) retains its earlier results.
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
