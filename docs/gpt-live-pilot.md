# GPT-Live pilot

`VOICE_RUNTIME_DRIVER=realtime` remains the default. `live` selects native
`gpt-live-1` with Responses delegation to `gpt-6-luna` and
`parallel_tool_calls=false`. Invalid drivers fail startup.

New calls now pass [synchronous AMD](amd-voicemail-beta.md) before this runtime.
The real-call results from 25 September below predate AMD and do not certify the
new detection/message branches. Retest both runtimes with the AMD smoke profiles.

## Protocol and safety boundary

The shared `VoiceRuntime` interface owns the authenticated Twilio Media Stream.
`OpenAIRealtimeBridge` retains the existing runtime. `OpenAILiveBridge` reuses its
consent, recording startup, mandatory opening and bounded farewell controller;
after the opening's Twilio playback mark, conversation audio goes exclusively to
the native Live connection. The Realtime connection remains available for the
controlled farewell. This pilot therefore bills both that bounded Realtime
speech and Live conversation/delegation. It is not a replacement of all Realtime
provider connections.

Both transports use raw PCMU/G.711 at 8 kHz. The application inspects input energy
to invalidate stale tool requests and clear queued playback on interruption; it
does not transcode or gate the audio stream. Live input and output continue
independently. Backend completion, transcript gaps and append acknowledgments
never stand in for audio completion. A farewell uses the existing generation
deadline and Twilio `mark` acknowledgment; a `clear` invalidates the old mark.

Live connects to `wss://api.openai.com/v1/live/sessions`, sends `session.start`,
and waits for `session.started`. It uses `session.input_audio.append`,
`session.output_audio.delta` and native transcript deltas. The backend collector
unwraps `response.event`, collects function items, waits for successful backend
completion, persists usage, validates current application state and returns
`response.item.create` results followed by a bare `response.create`.

The attempt-bound approved snapshot, stream token, consent and recording gates
remain mandatory. Appointment authorization allows one request, never declares
a booking completed. A later recipient confirmation is required before resolving
an appointment call. New speech invalidates stale tools. Interrupted closing
requires a fresh routing decision. Duplicate, concurrent, unauthorized and failed
tool calls cannot trigger execution. Live does not write external business state.

`VOICE_RUNTIME_LIVE_FALLBACK=true` allows startup failures to resume the already
prepared Realtime session without repeating consent. Once Live has started, a
provider failure closes the conversation; it never replays an action through a
second runtime. Set fallback to `false` for acceptance tests.

## Transcripts and accounting

Native fragments keep exact text, session/event IDs and timeline intervals.
Presentation groups nearby fragments by speaker without changing stored evidence.
Both speakers can have overlapping fragments; late arrivals retain their native
time. Captions remain provisional. The existing recording, post-call
`gpt-transcribe` / `gpt-4o-transcribe`, final transcript and retention pipeline
continues unchanged.

Live uses existing ledger operation types with stages `live_conversation` and
`live_delegation`. Final cumulative seconds are recorded once; backend token usage
is separate. Closing sends `session.close` and allows up to 15 seconds for final
usage. Lost transports preserve the latest observed duration with
`rawUsage.finalized=false` and an unsuccessful result, retaining uncertain budget
reserves. Missing usage is not zero cost. Provider messages and conversation text
are excluded from usage/error logs.

Pricing version `openai-public-2026-09-25` adds Live at $0.05/minute and GPT-6 Luna
at $0.10/$0.01/$0.125/$0.50 per million input/cached input/cache-write/output
tokens. Historical pricing versions remain unchanged. Admin realtime totals
include Live duration plus delegated text tokens and the original bounded speech;
subtotals are not added twice. These are list-price estimates, not invoices.

## Deployment and rollback

On 26 September the owner reported that local testing works and that Live improves
dialogue quality, and authorized merge/push to main and production rollout with
`VOICE_RUNTIME_DRIVER=live` and `VOICE_RUNTIME_LIVE_FALLBACK=false`.
This is owner acceptance, not an independently collected result for every carrier
scenario. The production cutover and post-deploy checks must still be recorded.
Repository defaults remain Realtime; the approved production environment overrides
them explicitly. Use [the deployment preflight](deployment-preflight.md).

1. Run the full repository test, lint, typecheck and build commands.
2. Apply the complete current catalog through `0084_answering_detection.sql` with the normal
   `pnpm db:migrate` process before starting the new code. Live migration
   `0081_native_live_transcript_timing.sql` adds a nullable JSON column that
   preserves fragment timing across reloads. Migration 0084 adds AMD event, job and
   provider-operation values. Drain calls and stop old writers before migration;
   strict old readers must not handle newly written v3 snapshots or AMD events.
3. For the owner-approved rollout set `VOICE_RUNTIME_DRIVER=live` and
   `VOICE_RUNTIME_LIVE_FALLBACK=false`. Existing defaults for recording,
   post-call transcription and `REALTIME_AGENT_HANGUP_ENABLED` are preserved.
4. Explicitly set
   `OPENAI_LIVE_MODEL=gpt-live-1`, `OPENAI_LIVE_DELEGATION_MODEL=gpt-6-luna`,
   `OPENAI_LIVE_MALE_VOICE=cedar`, `OPENAI_LIVE_FEMALE_VOICE=marin`.
   Enable `REALTIME_AGENT_HANGUP_ENABLED=true` when testing application hangup.
   Drain active calls before restarting the process.
5. Require successful real-call evidence before changing a production driver.
   Roll back by draining calls, setting `VOICE_RUNTIME_DRIVER=realtime` and
   restarting. Leave the additive column in place; switching the driver needs no
   data rollback. A downgrade to pre-AMD binaries is not a safe runtime rollback;
   follow the [compatibility procedure](deployment-preflight.md).

Allow outbound OpenAI WebSocket access and keep the existing signed Twilio
webhooks/media-stream routing. No new public endpoint or client-side API key is
introduced. Live sessions use `store:false`; application retention and access
controls still govern transcripts.

## Local real-call smoke

Use a separate local PostgreSQL database whose name ends in `_test`, a verified
test account with accepted current Terms/AUP and credits, and a consenting test
recipient. Never point this drill at production data. Use a language enabled for
the test account (the existing drill uses Russian, currently requiring a local
superadmin fixture). Do not send verification email/SMS just to provision fixtures.

Start the normal local API and embedded worker with `STORAGE_DRIVER=postgres`,
`TELEPHONY_DRIVER=twilio`, the dedicated `DATABASE_URL`, real provider credentials,
`REALTIME_AGENT_HANGUP_ENABLED=true`, and a short `CALL_MAX_DURATION_SECONDS`.
Expose only the Twilio webhook gateway using `pnpm tunnel:twilio`; set
`PUBLIC_BASE_URL` to that HTTPS tunnel. Keep the API loopback-only. Set the runtime
on the API process before each test, and disable Live startup fallback.

In the drill process supply these environment variables without committing them:

```dotenv
VOICE_SMOKE_DRIVER=realtime
VOICE_SMOKE_MODE=prepare
REAL_CALL_DRILL_API_URL=http://127.0.0.1:4000
REAL_CALL_DRILL_EMAIL=<local-test-account>
REAL_CALL_DRILL_PASSWORD=<local-secret>
REAL_CALL_DRILL_TARGET=<approved-CH-E.164>
DATABASE_URL=<dedicated-local-test-database>
```

Run `pnpm --filter @callassist/api drill:voice-runtime`. Preparation does not dial.
Review the generated brief through the local UI/API. Copy `callId`, `revision`,
and `snapshotHash` into `REAL_CALL_DRILL_CALL_ID`, `REAL_CALL_DRILL_REVISION`,
and `REAL_CALL_DRILL_SNAPSHOT_HASH`. Set `REAL_CALL_DRILL_CONFIRM=CALL_AUTHORIZED`
and `VOICE_SMOKE_MODE=start`, then run the same command. It uses the normal
authenticated original-plan review receipt and approval/start route.

After consent, answer the readiness and hearing questions. Let the application
finish its farewell and disconnect. After post-call processing settles, set
`VOICE_SMOKE_MODE=verify` and run the command again. It fails unless consent,
application hangup, completed recording transcription, retention deletion and
provider ledger completion exist. Live additionally requires native transcripts,
final Live seconds and Responses tokens; a fallback is not a Live pass.

Repeat with the API and drill set to `live`. For broader acceptance, test refusal,
keypad consent, interruption during farewell, a new question after goodbye,
waiting/hold, invalid and corrected appointment details, confirmation, provider
disconnect and startup fallback. Automated coverage exercises these state and
protocol boundaries without placing calls.

## Official references

Local acceptance on 2026-09-25 passed for both drivers on real Twilio calls in an
isolated PostgreSQL database. Both calls completed the consent/recording gate,
application farewell with `playback_complete`, post-call transcription and
recording deletion, with no unfinished provider operations. Live used native
input/output captions, 13 finalized voice seconds and two successful GPT-6 Luna
responses; startup fallback was disabled. Appointment and interrupted-closing
edge cases are covered by automated tests; this short real-call smoke does not
replace broader conversational acceptance for a production rollout.

Protocol and pricing checked on 2026-09-25:

- [Realtime to Live migration](https://developers.openai.com/api/docs/guides/live-migration)
- [Live WebSocket transport](https://developers.openai.com/api/docs/guides/voice-websockets)
- [Delegation and tools](https://developers.openai.com/api/docs/guides/live-delegation)
- [Prompting and delegation policy](https://developers.openai.com/api/docs/guides/live-prompting)
- [Session lifecycle and transcripts](https://developers.openai.com/api/docs/guides/live-conversations)
- [GPT-Live-1](https://developers.openai.com/api/docs/models/gpt-live-1)
- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
