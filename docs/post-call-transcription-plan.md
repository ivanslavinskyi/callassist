# Consent-Based Recording and Post-Call Transcription Plan

## Objective

Keep the Realtime conversation and fast live draft while producing a more reliable
post-call transcript from consent-gated audio. The temporary recording is the source
of truth. The final transcript remains AI-generated until an operator checks it.

## Product behaviour

### Before consent

1. Twilio connects the bidirectional Media Stream with call recording disabled.
2. The selected OpenAI voice introduces the assistant, explains the controlled
   assistance reason, and states the recording purpose and retention period.
3. Recipient audio is discarded and is not sent to OpenAI.
4. Pressing `1` is the only consent signal accepted by the application.
5. No response or any other key ends the call without recording.

### After consent

1. Persist the consent event and timestamp.
2. Ask Twilio to start a dual-channel recording of the active call.
3. Wait for Twilio to confirm that recording has started.
4. Only then permit recipient audio to reach Realtime and start the objective.
5. If recording cannot start, explain the failure and end the call.

### After the call

1. Twilio sends a signed recording-status webhook.
2. A completed callback creates or resumes an idempotent transcription job.
3. The backend downloads the complete consented recording using server-side
   credentials; no authenticated media URL is exposed to the browser.
4. The recording is sent once to `gpt-transcribe` with bounded compiled context,
   literal names, selected languages, and the expected writing system.
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

The conversation gate opens only after the `recording` transition.

## Data and access

- Audio retention is immediate, 7 days (default), or 30 days.
- Recording metadata contains provider IDs, channel count, duration, lifecycle
  timestamps, deletion deadline, and non-sensitive failure codes.
- The application never stores Twilio credentials or an authenticated recording URL.
- The final transcript stores model ID, encrypted text, status, processing timestamps,
  and a non-sensitive failure code.
- Realtime transcript segments are never overwritten by the post-call result.
- Browser audio playback is proxied by the main API. Public deployment requires an
  authenticated owner check before any recording or transcript can be returned.

## Stable MVP transcription decision

The default is deliberately one complete-recording transcription request.

```text
consented recording -> gpt-transcribe -> final plain text
live Realtime events -----------------> separate draft only
```

The final request contains:

- the selected BCP 47 call locale and explicitly allowed fallback locale;
- the conventional writing system for those languages;
- assistant, represented-person, recipient, and organisation names;
- a bounded compiled objective, background context, and literal approved terms;
- strict instructions not to translate, infer, complete, or reconstruct unclear speech.

The result intentionally has no automatic speaker labels or timestamps in this MVP.
The application does not segment the audio, align text to live turns, replace final
words with live candidates, or run per-turn retries.

### Why this path was selected

An experiment on the same retained German call compared the candidate paths:

- full-call diarization retained roles and timestamps but rendered several German
  recipient utterances as Cyrillic phonetics, including with `language=de`;
- full-call `gpt-transcribe` preserved the conversation context and correctly returned
  short phrases such as `Wie bitte?`, `Was? Bitte noch einmal.`, and `Land?`;
- the previous segmentation and ordinal reconciliation could drop short turns and
  then attach later live text to the wrong audio interval.

One request is also cheaper and operationally simpler than one full-call request plus
many segment requests. Removing reconciliation eliminates a class of silent text and
speaker-corruption failures.

The trade-off is explicit: the final MVP optimises for faithful wording, not automatic
structure. The live view remains useful for observation, and retained audio remains
the verification source for critical details.

## Failure and recovery

- Recording start failure keeps recipient media blocked and ends the call.
- Duplicate callbacks are handled idempotently.
- An API restart resets interrupted transcription work and retries from the recording.
- Download or model failure keeps the recording and exposes a safe retry action.
- Empty model output fails rather than publishing an invented transcript.
- Recordings larger than the current upload limit fail with `AUDIO_TOO_LARGE`; bounded
  overlapping-window transcription is deferred until real call duration requires it.
- Recording deletion failures retain the deadline and retry during cleanup.

## Verification

- Prove that recording and recipient forwarding do not begin before DTMF consent.
- Verify signed, idempotent Twilio recording callbacks and dual-channel capture.
- Verify exactly one model request for a normal recording.
- Verify that live draft wording cannot enter the final transcript.
- Verify prompts contain bounded compiled context and no secrets or raw untrusted text.
- Test empty, malformed, failed, oversized, retry, and restart-recovery paths.
- Test UI, clipboard, and PDF output without invented speakers or timestamps.
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
- Move temporary audio to encrypted customer-controlled storage for production.

## OpenAI references

- [Speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text)
- [GPT-4o Transcribe Diarize](https://developers.openai.com/api/docs/models/gpt-4o-transcribe-diarize)
