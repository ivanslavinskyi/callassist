# Background AMD with native Live — 28 September 2026

New approvals now carry `twilio-async-live-inconclusive-v3`. With `VOICE_RUNTIME_DRIVER=live`,
`VOICE_RUNTIME_LIVE_FALLBACK=false` and `TWILIO_ASYNC_AMD=true` (default for native
Live), outbound calls request Async AMD and its signed, attempt-bound `/webhooks/twilio/amd`
callback. The voice webhook immediately returns the authenticated bidirectional stream.
Live starts the existing disclosure, including the represented person's name, without
waiting for AMD. The owner explicitly accepts this speech reaching voicemail.

Recording and task admission depend on verified disclosure playback and current consent,
**not on AMD classification**. The same Live session proceeds after consent. A late
human/machine/fax/unknown result is retained as provider evidence, but cannot interrupt
an accepted conversation, start voicemail playback or cause its recovery job to hang up.
No recording or transcript retention starts before consent. Automated greetings can
still be mistaken for consent; carrier and consent-classifier accuracy require real tests.

Before consent, `human` and the inconclusive `unknown` result leave Live and its consent
flow running. Only explicit machine/fax classifications clear queued speech and claim one
provider action durably. The approved `machine_end_beep` branch alone plays the fixed
neutral message through Twilio Say; other explicit machine/fax or invalid results end the
call. Silence-ending greetings do not authorize a message. An initial disclosure may
already have been heard or recorded in either policy.

`unknown` is not evidence of an automated answer. Twilio can return it after the initial
silence threshold while a person quietly listens to the disclosure. Treating it as a
terminal machine result caused a confirmed human call on 29 September to be cut off about
five seconds into the disclosure. The current policy therefore fails open only into the
privacy-gated consent stage: recording and task context remain unavailable until semantic
consent is accepted. The previous `twilio-async-live-beep-v2` remains readable and keeps
its historical terminal handling; reapprove or repeat a plan to obtain v3.

The callback only persists classification; its returned HTTP body does not control Twilio.
The admitted stream observes the result through service notifications and a one-second
database polling recovery path. This handles callbacks before/after stream start and
separate gateway processes. The socket remains open until Twilio replaces Connect/Stream;
closing it before the REST update would execute the trailing Hangup and lose the message.

Message/termination dispatch and recording consent serialize on the same call/attempt locks.
Whichever is accepted first excludes the other. Duplicate callbacks cannot dispatch a
second message. An uncertain REST update is never replayed; provider reconciliation ends
the attempt. Message completion still requires the signed completion callback and proves
playback traversal, not mailbox storage or listening. AMD usage is recorded on resolution;
TTS usage only on message dispatch. Normal Live usage includes pre-consent time.

Missing AMD has a 35-second deadline after stream admission while consent is pending.
The existing 80-second durable deadline covers missing streams and process failure.
After consent, these AMD deadlines cannot end the conversation. Existing consent, speech,
recording startup and maximum-call-duration limits remain in force.

No new SQL migration is required by this change; additive fields use existing event JSON.
Readers accept all policy versions. Previously approved v3 execution snapshots keep their
saved policy; `twilio-async-live-beep-v2` remains asynchronous but retains its historical
`unknown` decision. Earlier synchronous approvals remain synchronous;
v1/v2 approval refresh remains unchanged. Realtime and explicit Live legacy fallback stay
synchronous. All processes must use matching code/configuration before new attempts start.
Set `TWILIO_ASYNC_AMD=false` on the calling service to compare synchronous behavior with
the same Live runtime. Execution is recorded per attempt and is not changed in flight.

## Manual verification

Restart the local API/webhook process and worker with the current code and matching config.
Create and approve a **new** call (old immutable approvals retain synchronous behavior).
Admin call details should show `AMD execution: async` and the new policy version.

1. Human: short hello and long business greeting; measure pickup-to-first-disclosure audio.
   The disclosure should be able to precede the AMD result. Give natural spoken consent;
   recording must start without waiting for classification. Check one Live session and no
   repeated disclosure/opening. Confirm transcript, final assessment and credit settlement.
2. Refusal and unclear answer: no recording without consent; normal clarification/ending.
3. Voicemail, hang-up policy: initial disclosure is allowed; once detected before consent,
   speech stops, call ends, no fixed voicemail message or task execution, credit returned.
4. Voicemail, neutral-message policy: test actual carrier beep; one approved message after
   the beep, completion only with its callback, no conversational credit charged.
5. Inconclusive human: answer and silently listen through the disclosure until AMD returns
   `unknown`; the disclosure must continue, the UI must remain in consent, and a subsequent
   natural affirmative answer must start recording exactly once.
6. Long greeting, no beep, screening/IVR, silence/fax, recorded yes: check honest results,
   no unapproved task/recording, bounded call duration and no false successful message.
7. Stop during disclosure/message, disconnect, duplicate/late callback: no reopened call,
   repeated message or duplicate cost. Accepted conversations ignore late contradictory AMD.

Twilio documentation currently cautions about Async AMD sharing audio-fork limits with
Media Streams and recommends sequencing them. Simulated transport tests cannot establish
carrier compatibility for this simultaneous `<Connect><Stream>` configuration. The manual
call must verify both active Media Stream and async callback; until then this is implemented
for local acceptance, not a certified production rollout. No new paid call was made by the
implementation. Do not silently disable AMD if the carrier rejects the combination.

Sources: [Twilio AMD](https://www.twilio.com/docs/voice/answering-machine-detection),
[AMD FAQ and tuning](https://www.twilio.com/docs/voice/answering-machine-detection-faq-best-practices),
[Media Streams](https://www.twilio.com/docs/voice/media-streams).

## Automated verification

Later local feedback on 28 September: the owner reported AMD working before the
voice-continuity follow-up. This confirms the tested local scenario only; it does
not complete the carrier/voicemail matrix above. The later full-suite checkpoint
and subsequent prompt-only checks are recorded in the
[voice continuity and pace follow-up](live-voice-continuity-2026-09-28.md).

Initial async-AMD implementation checkpoint:

The API suite passed 1,331 tests; six integration suites (47 tests) initially could
not start because the existing shared test database had a checksum mismatch for
`0065_text_artifacts_and_jobs.sql`. All six then passed against a fresh isolated
test database, without modifying the existing database. Focused async-AMD tests
also pass, including PostgreSQL concurrency, callbacks, early consent, late AMD,
and durable timeout claims. Contracts: 136 tests passed. Web: 317 tests passed.
API/web type checks and the API build passed. Carrier behavior remains the manual
acceptance item above.
