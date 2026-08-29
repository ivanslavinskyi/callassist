# Outbound voice consent implementation plan

## Goal

Replace mandatory DTMF consent with a short voice-first consent flow while
keeping recording, transcript, and main Realtime conversation fail-closed until
explicit consent has been durably recorded.

## Privacy boundary

- Create Twilio calls with `record: false`.
- Route pre-consent recipient media only to a short-lived Realtime
  transcription session configured for PCMU and the call locale.
- Never append pre-consent media to the main Realtime conversation.
- Never store pre-consent audio or the raw recognized phrase.
- Add only a deterministic system transcript segment after consent is granted.
- Start the normal conversation only after provider recording startup succeeds.

## Implementation stages

1. Add `none` to `ASSISTANCE_REASON_IDS`, make it the input and UI default, and
   return an empty assistance disclosure for that value. Preserve existing
   encrypted historical values.
2. Replace the initial Twilio copy with a short localized AI identity plus
   recording/transcription question. Split clarification, DTMF fallback,
   negative goodbye, and recording-failure copy into explicit fields.
3. Add a small locale-aware `consent-classifier.ts` that returns only
   `affirmative`, `negative`, or `unclear`, with negative matches taking
   precedence and ambiguous text failing closed.
4. Add an isolated consent transcription socket/session. It receives Twilio
   media only while listening for consent and is closed and dereferenced after
   a decision or terminal timeout.
5. Extract bounded consent orchestration from `OpenAIRealtimeBridge`: initial
   voice attempt, one clarification, DTMF fallback, then termination. A clear
   negative terminates immediately.
6. Pass consent evidence into `startRecordingAfterConsent`/`beginRecording` so
   durable telemetry records voice or DTMF method and locale atomically with
   recording creation. Keep legacy `dtmf_1` telemetry readable.
7. After recording starts, add a deterministic consent transcript segment and
   deliver optional assistance disclosure immediately before the compiled
   opening without duplicating the represented person's name.
8. Update form and live-call UI copy for the neutral default and the warning
   shown when a sensitive assistance reason will be disclosed.

## Verification gate

- Contract tests for `none`, defaults, empty disclosure, and legacy reasons.
- Copy tests for every supported locale and forbidden consent-prompt content.
- Classifier tests for affirmative, negative, negation precedence, and unclear
  phrases in every supported language.
- Bridge tests for voice consent, negative consent, clarification, DTMF
  fallback, pre-consent media isolation, and recording-start failure.
- Repository tests for durable consent method/locale evidence and legacy event
  compatibility.
- UI tests for the default selector and disclosure warning.
- Full `test`, `typecheck`, `lint`, and `build` suites before merge.

No merge to `main` is performed without a green verification gate and explicit
approval.
