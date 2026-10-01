# Live voice continuity and speaking pace — 28 September 2026

Implemented on `codex/live-unified-runtime` after the
[reported voice change immediately after consent](live-voice-review-2026-09-28.md).
The old call did not record the provider-confirmed voice, so its acoustic cause
has not been established.

The owner subsequently reported the voice fix working in a manual call. A later
request to slow the assistant down led to the pacing instruction described below.
Voice continuity has that user-reported acceptance; the new pace has not yet been
confirmed by listening. Neither report is a full two-voice/language acceptance matrix.

## Runtime and product behavior

- The plan form offers exactly two voices: male `cedar` (Sebastian) and female
  `marin` (Anna). Historical profile names remain readable; their saved gender
  determines the displayed choice and the fallback voice for old approvals.
- New approvals persist `runtime.liveVoice` in the immutable execution snapshot.
  A conflicting gender/voice pair is invalid. Old approvals are not rewritten.
  Optional legacy Live environment settings may only match the fixed catalog;
  conflicting overrides fail startup rather than silently changing a voice.
- One native Live session owns disclosure, consent, opening, dialogue and closing.
  Voice is selected once in `session.start`. Backend updates do not send audio or
  voice settings, and consent does not create another speech session.
- The initial instructions explicitly retain the same vocal identity, gender and
  accent across stages; controlled speech also asks to keep the existing voice.
- Both voices now use a calm pace slightly slower than ordinary conversation,
  brief natural sentence pauses and clear names, dates and numbers. This is a
  session-wide speaking instruction, reinforced for controlled speech, rather
  than a numeric playback-speed setting. There is no additional form choice or
  environment variable. Its acoustic effect needs manual listening.
- `session.started` must confirm the requested voice and a valid session ID before
  any playback. `session.updated` must retain both. Missing/contradictory confirmation
  clears playback and fails the session; it does not select another voice. Updates
  use the existing bounded command acknowledgment timeout.
- `realtime.voice` records requested voice, confirmed voice, session ID, model,
  phase and verification result, with no conversation content. Admin call details
  expose the latest confirmation; the event timeline retains earlier ones.
- Migration `0086_live_voice_telemetry.sql` adds the event to the database constraint.
  Apply it before restarting API/worker. This work does not alter AMD or recording
  admission: recording continues to depend on consent, independently of AMD.

## Verification and limits

Tests cover both voices through disclosure, consent, task and closing; one session
and an unchanged voice configuration; missing/wrong startup voice; an unexpected
voice or session change; immutable snapshot compatibility; and PostgreSQL telemetry
round trips. Contracts, web and API type checks also cover the new schema and UI.
At the voice-continuity checkpoint, full suites passed: API 1390 tests, contracts
137 tests, web 317 tests (1844 total). API build and public-copy checks passed.
After the subsequent pace-only prompt change, the existing unified-call, Live bridge
and preparation suites passed 97 tests across three files; API type checking and
whitespace checks passed. The full suites and build were not rerun for that prompt
change. Mock tests cannot verify how fast the generated speech sounds.

Two real OpenAI Live WebSocket probes confirmed `cedar` and `marin` in both
`session.started` and `session.updated` after a backend instruction update, with
the original session ID retained. Both sessions reported zero seconds of audio.
No telephone calls or user audio were sent by these probes.

These checks establish configuration continuity, not a perceptual guarantee about
generated audio. A provider could return the same voice ID while its sound drifts.
The owner confirmed the continuity fix after manual testing, without specifying
voice/language coverage. For broader acceptance, compare the disclaimer, the first
sentence immediately after consent and later dialogue for each voice. If the issue
repeats, correlate its timing with `realtime.voice` before attributing it to session
configuration or provider audio generation. The new pace needs its own listening
check, including names/dates/numbers, natural sentence pauses and uninterrupted closing.

## Local application and next checks

Migration 0086 was applied to the existing local application database on 28 September.
After the pacing change, the local API/gateway with embedded worker was restarted
using native Live, fallback disabled and the existing Twilio tunnel. Readiness
returned 200. No production deployment or assistant-initiated phone call was made.
These are dated checks, not a guarantee that those processes or the tunnel remain up.

Prompt changes take effect in subsequent Live sessions after API restart, including
sessions for existing approvals; changing pace needs neither a new approval nor an
additional migration. New approvals are still required to opt old synchronous AMD
plans into the new answering policy. Keep active calls clear before restarting.

Implementation sources:

- [Voice catalog and immutable runtime](../../packages/contracts/src/call-brief.ts)
- [Two-choice plan form](../../apps/web/components/create-call-form.tsx)
- [Live voice checks and common speaking instructions](../../apps/api/src/voice/live-conversation.ts)
- [Controlled speech and stage transitions](../../apps/api/src/voice/unified-live-call.ts)
- [Admin voice diagnostics](../../apps/web/components/admin-call-inspector.tsx)

OpenAI documents voice selection at session start and backend-only updates in the
[Live conversations guide](https://developers.openai.com/api/docs/guides/live-conversations).
The [Live prompting guide](https://developers.openai.com/api/docs/guides/live-prompting)
describes setting speaking pace through session instructions.
