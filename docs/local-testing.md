# Local testing on `feat/gpt-live-pilot`

Updated 2026-09-25. Start from the existing local `.env`; keep credentials and
temporary tunnel URLs out of Git. This procedure does not authorize a production
rollout. The implementation checkpoint is `457c9b2`; see the
[validation record](registration-and-call-improvements-2026-09-25.md).
The current manual acceptance session uses Live with startup fallback disabled;
the repository and production default remains Realtime.

Local startup checkpoint, 25 September: the existing application database was
migrated from 0080 through 0083 with historical checksums intact and no active calls.
API readiness and login/registration pages returned 200. The public tunnel returned
404 for private API paths and 403 for an unsigned Twilio status callback. Startup
logs confirmed the Live driver and enabled application hangup. This is infrastructure
readiness; the next user-driven call is still the manual acceptance step.

## Database and processes

1. Install the locked dependencies with Node.js 22.19+ and pnpm 10.12.4.
   For a new checkout, `corepack pnpm env:init` creates local keys without replacing
   an existing `.env`. Check the database host/name before running migrations.
2. Run `corepack pnpm db:up`, then `corepack pnpm db:migrate`. The current catalog
   ends at `0083_call_retry_sources.sql`. Preserve existing accounts and keys.
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
  again. An unchanged plan reuses compilation; edits can invoke the compiler.
  Repeat also appears after a completed connection without received consent, such
  as a possible voicemail answer. It excludes explicit refusal and consented calls.
  Verify mobile New call/History navigation and source-language objectives in lists.
- Save feedback, reload, then Edit and Cancel/Save. The saved view must be read-only.
- Place calls only to an agreed test recipient. Check consent, captions, interruption,
  farewell playback/hangup, final recording transcription and ledger completion.

For Live, finish active calls, stop the API, set `VOICE_RUNTIME_DRIVER=live` and
`VOICE_RUNTIME_LIVE_FALLBACK=false`, then restart with the same current tunnel URL.
Check the startup driver log. Live retains bounded Realtime consent/opening/farewell
speech, so both can appear in accounting. To return to the default, drain calls and
restart with `VOICE_RUNTIME_DRIVER=realtime`. A mid-call provider failure does not
silently replay actions through another runtime. Follow the
[isolated real-call smoke](gpt-live-pilot.md#local-real-call-smoke) for repeatable
prepare/start/verify assertions; a fallback is not a successful Live test.

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
