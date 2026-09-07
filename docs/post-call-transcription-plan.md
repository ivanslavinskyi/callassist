# Consent-Based Recording and Post-Call Transcription Plan

Status: implemented decision, reviewed 2026-09-07 against `96229ea`.
Current release evidence and outstanding quality work are in the
[audit](project-audit-2026-09-07.md) and [roadmap](mvp-plan.md).

## Objective

Keep the Realtime conversation and fast live draft while producing a more reliable
post-call transcript from consent-gated audio. The temporary recording is the source
of truth. The final transcript remains AI-generated until an operator checks it.

## Product behaviour

### Before consent

1. Twilio connects the bidirectional Media Stream with call recording disabled.
2. The main OpenAI audio session speaks the short AI identity, represented-person
   and recording/transcription question in the selected voice. The current prompt
   does not state the retention period or optional assistance reason.
3. After the prompt playback mark, recipient audio can reach a separate text-output
   OpenAI session solely to recognize consent. Automatic responses are disabled there;
   the application stores neither pre-consent audio nor the raw recognized phrase.
4. A deterministic classifier matches complete affirmative phrases, rejects
   unrecognized qualifications/quotes/questions and gives recognized negatives precedence.
   Unclear speech/timeouts allow one clarification, then keypad fallback.
   Key `1` is accepted only in that fallback stage.
5. Refusal or exhaustion of the flow ends the call without recording or forwarding
   recipient media into the main conversation. Provider processing of the consent
   answer is still pre-consent processing; public notice alignment is roadmap R07.

### After consent

1. Persist the consent event and timestamp.
2. Ask Twilio to start a dual-channel recording of the active call.
3. Wait for Twilio to confirm that recording has started.
4. Deliver the optional assistance disclosure and mandatory opening; wait for its
   playback mark before permitting recipient audio into the main Realtime session.
   The opening asks whether it is convenient to continue before the objective.
5. If recording cannot start, explain the failure and end the call.

### After the call

1. Twilio sends a signed recording-status webhook.
2. A completed callback creates or resumes an idempotent transcription job.
3. The backend downloads the complete consented recording using server-side
   credentials; no authenticated media URL is exposed to the browser.
4. Supported stereo WAV is split into channel-labelled speech utterances, normally
   transcribed with `gpt-4o-transcribe`. Mono/unsupported media uses one full-file
   `gpt-transcribe` fallback with bounded compiled context and language guidance.
5. The encrypted recording-derived text is stored separately from the live draft.
6. The UI labels the two outputs clearly and retains audio for verification until
   the configured deletion deadline.

## State machine

```text
recording:
none -> starting -> recording -> processing -> available -> deleted
          |            |             |
          +------------+-------------+-> failed

final transcript:
none -> processing -> completed
                   -> failed -> processing (retry)
completed -> processing (explicit regeneration while audio is retained)
```

The conversation input gate opens only after recording startup and completion of
the mandatory opening playback. The diagram describes recording/transcript states,
not the separate consent orchestration stages.

## Data and access

- Audio retention is immediate, 7 days (default), or 30 days.
- The deletion deadline is calculated when final transcription completes successfully;
  regeneration updates it. Failed transcription can retain audio for retry, so the
  selected value is not a hard deadline measured from call start.
- Recording metadata contains provider IDs, channel count, duration, lifecycle
  timestamps, deletion deadline, and non-sensitive failure codes.
- The application never stores Twilio credentials or an authenticated recording URL.
- The final transcript stores model ID, encrypted text, status, processing timestamps,
  and a non-sensitive failure code.
- Realtime transcript segments are never overwritten by the post-call result.
- Browser audio playback is proxied by the main API with an implemented authenticated
  owner check. Recording URLs and credentials stay server-side.
- Live transcript rows are plaintext in PostgreSQL; final text/segments are encrypted.
  Access controls and deployment storage encryption are separate boundaries.

## Stable transcription decision

The default is channel-aware utterance transcription. See
`channel-aware-final-transcription-plan.md` for the failure analysis and acceptance
criteria.

```text
dual-channel recording -> local WAV parser and speech detection
                       -> channel 1: recipient utterances
                       -> channel 2: assistant utterances
                       -> gpt-4o-transcribe -> chronological structured transcript

mono/unsupported recording -> gpt-transcribe -> canonical plain text fallback
```

Each utterance request contains:

- the selected BCP 47 call locale and explicitly allowed fallback locale;
- the conventional writing system for those languages;
- assistant, represented-person, recipient, and organisation names;
- a bounded compiled objective, background context, and literal approved terms;
- strict instructions not to translate, infer, complete, or reconstruct unclear speech;
- the nearest preceding assistant utterance as context for short recipient replies.

Roles come only from the physical recording channel. Realtime events never provide
final wording or role metadata. Speech regions are normalized, padded, and uploaded
with concurrency four, processing assistant utterances before recipient utterances.
If channel extraction is unavailable, the application
publishes canonical full-recording text without roles.

### Why this path was selected

Historical experiments recorded during implementation compared the candidate paths
(not re-run as part of the 2026-09-07 audit):

- full-call diarization retained roles and timestamps but rendered several German
  recipient utterances as Cyrillic phonetics, including with `language=de`;
- full-call `gpt-transcribe` preserved wording but did not expose trustworthy roles;
- aligning that wording to the Realtime draft split `Ja, gern` across roles and
  produced `unknown` for a question/answer pair and `Gleichfalls`;
- channel-aware `gpt-4o-transcribe` correctly returned those short replies with
  deterministic roles on the same retained recording.

Only detected speech plus bounded padding is uploaded. On the 78-second validation
call, ten detected utterances contained approximately 50 seconds of padded audio.
This increases request count but keeps uploaded duration bounded and removes speaker
guessing. Retained audio remains the verification source for critical details.

## Failure and recovery

- Recording start failure keeps recipient media blocked and ends the call.
- Duplicate callbacks are handled idempotently.
- An API restart leaves queued/running transcription work durable; an expired lease is
  reclaimed and a stale worker is fenced from publishing its result.
- Download or model failure keeps the recording, uses bounded automatic retry, and
  exposes owner retry plus a reasoned superadmin dead-letter recovery action.
- Empty model output fails rather than publishing an invented transcript.
- Recordings larger than the current upload limit fail with `AUDIO_TOO_LARGE`; bounded
  overlapping-window transcription is deferred until real call duration requires it.
- Recording deletion failures retain the deadline and retry as durable retention work.

## Verification

- Prove that recording and forwarding to the main conversation do not begin before
  voice or fallback keypad consent is confirmed.
- Verify signed, idempotent Twilio recording callbacks and dual-channel capture.
- Verify deterministic channel roles and bounded-concurrency utterance requests.
- Verify that live draft wording and roles cannot enter the final transcript and that
  joining structured segments reproduces the stored recording-derived text.
- Verify prompts contain bounded compiled context and no secrets or raw untrusted text.
- Test empty, malformed, failed, oversized, retry, and restart-recovery paths.
- Test structured and plain-text UI, clipboard, and PDF output.
- Run lint, typecheck, unit/integration tests, build, migrations, and health checks.

## Deferred quality work

- Build a manually checked corpus covering Swiss Standard German, Swiss German,
  non-native accents, all supported languages, code-switching, names, dates, numbers,
  telephone noise, interruptions, and very short answers.
- Measure Realtime understanding, live-draft accuracy, and post-call accuracy separately.
- Add bounded overlapping chunks only for recordings above the upload limit.
- Re-evaluate diarization only when corpus results show that it does not reduce wording
  accuracy; do not restore speaker attribution based on a single successful call.
- Add click-to-seek verification and immutable operator-corrected transcript revisions.
- Decide whether provider-held audio satisfies the reviewed deployment policy or
  requires encrypted customer-controlled storage; the latter is not implemented.

## OpenAI references

- [Speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text)
- [GPT-4o Transcribe Diarize](https://developers.openai.com/api/docs/models/gpt-4o-transcribe-diarize)
