# Local testing on `codex/live-unified-runtime`

Updated 2026-10-01. Start from the existing local `.env`; keep credentials and
temporary tunnel URLs out of Git. This procedure does not authorize production
rollout. The current local acceptance profile is Live with fallback disabled.
The repository default is unified Live with fallback=false; deployment state must be checked separately.

## Current checkpoint, 1 October

The [Live v6 correction](live-transcript-language-fix-2026-10-01.md)
supersedes the historical checkpoints below. Current local process IDs, URLs, source
manifest and verification timestamps are in `.tools/runtime/stabilization-state.json`.
Use migrations through 0092, Live with fallback=false, automatic hangup enabled and
the existing embedded worker. Check zero active calls and drain older summary jobs
before restarting. Do not infer readiness from an old PID or tunnel URL.

For the next call, create and approve a fresh appointment plan. On 1 October in Zurich,
"next two weeks except Fridays, 09:00–18:00" permits Saturday 3 October at 11:00.
After the recipient confirms, let the assistant deliver a brief factual recap and
farewell, then hang up automatically. Inspect the exact playback mark and `endedBy`,
and verify that result, copy and PDF show the same computed schedule check. Spoken
confirmation and application action confirmation remain separate. In separate calls,
test reciprocal goodbye, a material correction during closing and recipient-first
disconnect. Repeat acoustic acceptance for both voices; a synthetic test is not that
acceptance. No outgoing call is created by preparing this checkpoint.

## Historical checkpoint, 29 September

The API/embedded worker was restarted at 18:43 Europe/Zurich with Live,
fallback=false, and agent hangup enabled. Zero calls were active before restart;
liveness and database readiness passed. Migration 0089 is applied and the source
catalog check reports 89 contiguous migrations with 0089 latest.
The web dev server subsequently compiled the voice/brand display changes. Earlier
process checkpoints below are historical, not instructions to revert this state.

The [implementation report](live-progress-fix-2026-09-29.md) records automated tests
and real-API synthetic probes; no handset call was placed for that verification.
The later [stable checkpoint](live-stable-checkpoint-2026-09-29.md) records the successful
18:50 CEST real handset call and supersedes the open handset-acceptance note for this runtime.
For the next local acceptance:

1. Create/review a plan: only male/female voice choices should appear. Confirmation
   and call details must display the selected voice, without a persona name.
2. Interrupt the disclosure once: queued playback must clear and the complete cached
   disclosure must replay after you stop. Give consent only after the uninterrupted
   playback mark; a pre-mark answer must not silently unlock recording. Also test a
   correction to refusal and ensure no recording starts.
3. Answer the task, then wait: the application should process an answer even if Live
   does not delegate it. Verify accepted end_call, completed farewell playback and
   automatic hangup. Correct the answer during farewell in a separate call and check
   that the conversation resumes instead of disconnecting.
4. Check SHPROHLI as the assistant label in live/saved/translated transcripts,
   copied text and PDF, including an older call. Recipient names and actual utterance
   text must remain unchanged. Internal legacy profile IDs are retained for compatibility.

The runtime repair needs no new migration, classifier, language-specific answer list
or configuration flag. Manual acoustic quality and handset acceptance remain open.

Automated branch verification: 1,899 tests / 211 files passed across the initial run
and targeted rerun; workspace lint/types passed. The old shared `*_test` database has
a historical migration 0065 checksum mismatch. Use a fresh disposable test database
for those integration suites; do not replace checksums or point tests at the call
database. The isolated rerun passed all 47 affected tests. `corepack pnpm -r test`,
`corepack pnpm -r typecheck` and `corepack pnpm -r lint` run package scripts directly
if Turbo cannot locate the pnpm binary on Windows.

New native Live approvals now use [background AMD](async-amd-live-2026-09-28.md).
Restart API/gateway/worker with this revision and create a new approval for manual
testing. Recording starts on consent without waiting for AMD. Current v3 treats
`unknown` as inconclusive and continues the disclosure/consent flow; it does not grant
consent. Previously approved calls retain their saved v1/v2 behavior, so reapprove or
repeat the plan before testing this correction.

The form offers two voices: male (`cedar`) and female (`marin`). New approvals
freeze the voice ID; existing approvals resolve it from their saved gender.
For each voice, manually check disclosure, the first sentence after consent and
ordinary dialogue. Admin call details now show requested/confirmed voice and session
ID. See [voice continuity implementation](live-voice-continuity-2026-09-28.md).
The owner reported continuity working after the fix. A subsequent common prompt
change requests calmer, slightly slower speech, brief sentence pauses and clear
names/dates/numbers; it still needs listening acceptance for both voices.
After a pace-only change, restart the API and start a subsequent session; existing
approvals can be used and no extra migration is needed. This differs from opting
an old synchronous AMD approval into background detection, which needs new approval.

The [28 September real-call review](live-call-review-2026-09-28.md) confirms one
local Twilio information call with initial voice consent, recording after consent,
natural closing and playback-confirmed hangup. It does not replace the remaining
manual acceptance matrix in [the runtime guide](live-unified-runtime.md).

## Live simplification checkpoint, 28 September

The local API was restarted at **17:56 CEST (Europe/Zurich)** after checking that
there were no active calls. Both API/gateway ports (4000/4001) belong to the new
process; `/health/live` and `/health/ready` returned 200, including database readiness.
The profile remains Live, fallback=false, `gpt-live-1`, delegation=`gpt-6-luna`,
agent hangup enabled and embedded worker, using the existing tunnel. No migration
was needed for that checkpoint; it then had 87 ledger entries through 0086.
The later native-transcript checkpoint below supersedes this process/schema state.
See the [implementation and verification report](live-simplification-implementation-2026-09-28.md).

Create a new plan, or edit and review an existing one, to test compiler version 6
and the new settings. Ordinary users receive neutral tone and formal address;
only superadmin can override them. Result handling and separate delivery controls
are removed; results remain stored in the application. Historical approvals keep
their saved content. On repeat, changed legacy settings or delivery instructions
can require recompilation and fresh review; the original approval is preserved.

For manual testing, start with Russian and German: a simple answer, multiple
required questions, refusal/unavailability, thanks during goodbye and a correction
during goodbye. Check that Live introduces the purpose naturally, asks readiness
only when needed, allows acknowledgments such as “записал” and makes no unsupported
promise to forward information or perform another action. Verify that a correction
resumes the conversation and that farewell playback finishes before hangup.
The full scenario matrix is in the [implementation plan](live-simplification-implementation-plan-2026-09-28.md).
This restart did not place a telephone call; previous real-call evidence predates
these changes and does not establish their handset acceptance.

## Native transcript checkpoint, 28 September

Migrations 0087/0088 and the new CMS publications are applied locally. New healthy
unified Live calls save native text as the canonical result; incomplete capture
uses recording ASR. Verify that the conversation, summary, task-language translation
and PDF share the same revision. Do not expect historical calls to switch source.
The explicitly reviewed September 28 call was repaired separately with its old
revision retained. Last verified restart: **21:11 CEST**, API/embedded worker PID 5016,
ports 4000/4001; liveness and database readiness passed. The local ledger had 89
entries through 0088, including the historical tombstone. This is a dated checkpoint,
not a live process-status assertion; no outgoing call was made during implementation.
See [implementation and verification](live-transcript-implementation-2026-09-28.md).

## Database and processes

The 26 September AMD implementation requires fresh real-call acceptance. Follow
[AMD/voicemail acceptance](amd-voicemail-beta.md) for the human, silent voicemail,
neutral-message, unknown, fax and no-answer verifier profiles. The September 25
calls predate AMD. Keep Live fallback disabled during this acceptance session.

1. Install the locked dependencies with Node.js 22.19+ and pnpm 10.12.4.
   For a new checkout, `corepack pnpm env:init` creates local keys without replacing
   an existing `.env`. Check the database host/name before running migrations.
2. Run `corepack pnpm db:up`, then `corepack pnpm db:migrate`. The current catalog
   ends at `0092_application_playback_transcript.sql`. Preserve existing accounts and keys.
   Automated integration tests require a separate disposable `*_test` database;
   never point `TEST_DATABASE_URL` at the application database.
3. For real calls, configure `TELEPHONY_DRIVER=twilio`, `BRIEF_COMPILER_DRIVER=openai`,
   OpenAI/Twilio credentials and `STORAGE_DRIVER=postgres`. Account SMS/email use
   their own `VERIFICATION_DRIVER`/`EMAIL_DRIVER` settings. Mock verification codes
   apply only when their respective driver is `mock`.
4. Start `corepack pnpm tunnel:twilio` and wait for its HTTPS `trycloudflare.com`
   address. Set `PUBLIC_BASE_URL` to that exact origin in the **API process** before
   starting it. A process override avoids leaving an expired URL in `.env`.
5. In that terminal, launch `corepack pnpm --filter @callassist/api dev`. Use
   `DURABLE_WORKER_MODE=embedded` for local preparation, ASR, summaries and maintenance.
   With `external`, also start `corepack pnpm --filter @callassist/api worker` with
   the same database, keyring, compiler and artifact configuration.
6. In another terminal, run `corepack pnpm --filter @callassist/web dev`.
   Open [the Russian UI](http://localhost:3000/ru) or another enabled locale.

Example API process overrides in PowerShell, after obtaining the tunnel address:

```powershell
$env:PUBLIC_BASE_URL = 'https://<current-tunnel>.trycloudflare.com'
$env:API_HOST = '127.0.0.1'
$env:TWILIO_WEBHOOK_HOST = '127.0.0.1'
$env:DURABLE_WORKER_MODE = 'embedded'
$env:VOICE_RUNTIME_DRIVER = 'live'
$env:VOICE_RUNTIME_LIVE_FALLBACK = 'false'
$env:TWILIO_ASYNC_AMD = 'true'
$env:OPENAI_LIVE_MODEL = 'gpt-live-1'
$env:OPENAI_LIVE_DELEGATION_MODEL = 'gpt-6-luna'
$env:REALTIME_AGENT_HANGUP_ENABLED = 'true'
corepack pnpm --filter @callassist/api dev
```

Keep the web/API origins consistent: normally browser web `http://localhost:3000`,
`NEXT_PUBLIC_API_URL=http://localhost:4000`. Do not alternate `localhost` and
`127.0.0.1` in the browser during a session. Binding the API to loopback does not
change the browser origin. Main API is port 4000; Twilio gateway is port 4001.

## Readiness and manual acceptance

- `GET http://localhost:4000/health/ready` must return 200. Load registration/login
  and check the current public registration options. On the tunnel, `/api/auth/me`
  must return 404; an unsigned POST to `/webhooks/twilio/status` must be rejected.
  A 404 at the tunnel root is expected: it is not the website URL.
- Sign in with an existing local account. In Admin > System, choose full onboarding
  or agreement at registration and required or deferrable email independently.
  Defaults remain full/required. Test a new registration after enabling the desired
  policy. SMS must lead to the email screen; Later is available only in deferrable mode.
  Deferral does not verify the address. Verify the three document links and all seven
  UI locales: DE/FR/IT/RM/EN/RU/UK.
- Check CH/UA account phone formats with the selected country. UI locale does not
  choose the phone country. Outbound destinations remain CH-only. Real SMS/email and
  call preparation use paid providers when enabled in the local environment.
- For a definitively unanswered call, use Repeat, inspect the saved plan and approve
  again. A plan unchanged by current defaults reuses compilation; edits or migrated
  legacy settings can invoke the compiler and require fresh review.
  Repeat also appears after a completed connection without received consent, such
  as a possible voicemail answer. It excludes explicit refusal and consented calls.
  Verify mobile New call/History navigation and source-language objectives in lists.
- Save feedback, reload, then Edit and Cancel/Save. The saved view must be read-only.
- Place calls only to an agreed test recipient. Check consent, captions, interruption,
  farewell playback/hangup, saved transcript source and ledger completion.
- For each voice, listen to the disclaimer, the first sentence after consent, the
  task and closing. Check that speech is unhurried but natural, sentence pauses are
  brief and names/dates/numbers are clear. Confirm the same requested/confirmed voice
  and session ID in admin diagnostics. Record listening feedback separately from
  configuration checks: an unchanged voice ID does not establish acoustic stability.

For Live, finish active calls, stop the API, set `VOICE_RUNTIME_DRIVER=live` and
`VOICE_RUNTIME_LIVE_FALLBACK=false`, then restart with the same current tunnel URL.
Check the startup driver log. Unified Live keeps one native listening session; the existing renderer owns mandatory
disclosure, protected requests and the v5 finite recap/farewell. No Realtime sockets or standalone consent
classifier should appear. Verify `Live delegated consent decision` with initial
`affirmative`, `consent.granted` with `method=voice`, then `recording.started`.
Recipient consent wording is deliberately unavailable in stored transcripts; do not
mistake the later readiness answer for the original recording consent.

For closing, check accepted `end_call`, `conversation.hangup` requested and
playback_complete, then `conversation.ended=agent_hangup`. The saved conversation
transcript should show `live_composed` when confirmed application speech supplements complete native capture, or `live_native` without application speech, with the outcome
and farewell. Incomplete capture uses `recording_asr`. Speech should not recite internal plan
prohibitions. Check natural short permission, refusal, ambiguity, a correction,
spoken yes after clarification, DTMF recovery and interruption during goodbye.
Use the [runtime guide](live-unified-runtime.md) for synthetic provider probes and
the [original smoke procedure](gpt-live-pilot.md#local-real-call-smoke) for the older
drill workflow; a fallback is not a successful unified Live test.

## Shutdown and diagnosis

Stop the API/web and tunnel processes when testing is finished. Do not terminate
an active call just to change configuration. Each new Quick Tunnel can have a new
URL; restart the API with it before placing another call. A running tunnel alone
does not update URLs held by an already running API.

If readiness fails, inspect API and PostgreSQL logs locally without sharing secrets
or conversation content. Check migration checksums, matching database/keyring,
worker mode and port ownership. Do not change a historical checksum to force startup.
Use the [deployment preflight](deployment-preflight.md) for code downgrade constraints;
switching the runtime driver alone does not require a schema rollback.
