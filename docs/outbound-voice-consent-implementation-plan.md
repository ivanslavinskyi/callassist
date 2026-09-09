# Outbound voice consent implementation plan

Status: core implementation present, including the subsequent consent-audio fix;
updated 2026-09-09 for the product decision to restore the previous short spoken consent. Stages below are a delivery record, not the
next backlog. Current release follow-ups are R06/R07/R08/R14 in the [roadmap](mvp-plan.md).

**R18 implemented:** full-phrase affirmative matching replaces prefix acceptance.
Unrecognized qualifications, conditions, questions and quoted affirmative speech
route to clarification; recognized negatives retain precedence. EN/DE/RU bridge
regressions assert no recording, consent grant or conversation audio forwarding.

## Goal

Replace mandatory DTMF consent with a short voice-first consent flow while
keeping recording, transcript, and main Realtime conversation fail-closed until
explicit consent has been durably recorded.

## Privacy boundary

- Create Twilio calls with `record: false`.
- Route pre-consent recipient media only to a short-lived Realtime
  text-output session used for transcription, configured for PCMU and the call locale.
  The main audio session speaks the disclosure; the recognition session does not.
- Never append pre-consent media to the main Realtime conversation.
- Never store pre-consent audio or the raw recognized phrase.
- Add only a deterministic system transcript segment after consent is granted.
- Start the normal conversation only after provider recording startup succeeds.
- Also wait for the mandatory opening playback mark before forwarding recipient
  media to the main session. Assistance reason defaults to `none`; optional reason
  disclosure occurs after consent. Provider-side consent recognition already processes
  speech before consent; “no processing before consent” is not the implemented contract.
- By the user's decision on 2026-09-09, the spoken notice is restored verbatim to
  the previous text in every call locale: AI identity, the represented person and
  the request to record and automatically transcribe. The two added sentences about
  AI recognition of the reply and audio retention are removed from the spoken notice.
  Public privacy/FAQ/onboarding copy retains the description of actual AI processing
  and retention. Audio retention remains deletion after the final transcript, 7 days
  or 30 days; the first option involves temporary recording after consent.
- Approved facts may be used as needed during the ensuing information-gathering call.
  Additional live permission prompts are outside the supported product workflow;
  booking, payment and commitments remain prohibited actions.

## Implemented stages

1. Add `none` to `ASSISTANCE_REASON_IDS`, make it the input and UI default, and
   return an empty assistance disclosure for that value. Preserve existing
   encrypted historical values.
2. Replace the initial Twilio copy with a short localized AI identity plus
   recording/transcription question. Split clarification, DTMF fallback,
   negative goodbye, and recording-failure copy into explicit fields.
3. Add a small locale-aware `consent-classifier.ts` that returns only
   `affirmative`, `negative`, or `unclear`, with negative matches taking
   precedence. Only complete allow-listed affirmatives grant; extra conditions and
   quoted/questioned affirmations fail closed (R18 implemented).
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

The 2026-09-07 audit ran the automated contract/classifier/bridge/repository suite;
no real recipient call was placed. The 2026-09-09 copy/bridge checks must retain the
short spoken script without retention, persona, assistance reason or DTMF additions.
Consent recognition and recording/playback gates remain unchanged. Current live-provider,
multilingual quality and notice acceptance remain open. Historical branch/merge instructions are superseded
by the current release roadmap.
