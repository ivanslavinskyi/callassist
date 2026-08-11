# Consent-Based Recording and Post-Call Transcription Plan

## Objective

Keep the existing Realtime conversation and draft transcript, while adding a consent-gated audio recording that produces a higher-quality post-call transcript. The recording is the temporary source of truth; the post-call transcript remains AI-generated until the operator verifies it.

## Product behaviour

### Before consent

1. Twilio connects the bidirectional media stream with call recording disabled.
2. The selected OpenAI voice introduces the assistant, explains the server-controlled assistance reason (`speech_impairment` or `language_barrier`) in the call language, and states the recording purpose and retention period.
3. Recipient audio is discarded and is not sent to OpenAI.
4. Pressing `1` is the only consent signal accepted by the application.
5. No response or any other key ends the call without recording.

### After consent

1. Persist the consent event and its timestamp.
2. Ask Twilio to start a dual-channel recording of the active call.
3. Wait for Twilio to confirm that recording has started.
4. Only then permit recipient audio to reach the Realtime model and start the call objective.
5. If recording cannot start, explain the technical failure and end the call. Do not silently continue under a disclosure that is no longer true.

### After the call

1. Twilio sends a signed recording-status webhook.
2. A completed callback creates or resumes an idempotent transcription job.
3. The backend downloads the original dual-channel Twilio media without exposing Twilio credentials or media URLs to the browser. It falls back to mono only for an older recording that has no dual representation.
4. A bundled FFmpeg process separates the two physical call legs, detects speaker turns from silence boundaries, adds short padding, normalises each isolated clip, and immediately removes all temporary files after processing.
5. Each isolated turn is sent to OpenAI file transcription with the call locale, objective, participant names, recipient name, background context, and a bounded list of literal keywords.
6. The backend maps the two physical channels to `assistant` and `recipient` by matching their post-call text against the independently stored live role references. Live wording is not copied into the final transcript.
7. The improved speaker-labelled turns and their recording-relative timestamps are encrypted and stored separately from Realtime transcript segments.
8. The UI displays `Live transcript` as a realtime draft and `Final transcript` as the recording-based AI-generated record.
9. Audio remains available for verification until its retention deadline, then is deleted from Twilio.

## State machine

```text
none
  -> starting          DTMF 1 persisted; Twilio start request in progress
  -> recording         Twilio accepted the live-call recording request
  -> processing        call ended; Twilio is preparing media
  -> available         recording callback completed; media can be fetched
  -> deleted           retention expired or operator deleted it

starting|recording|processing -> failed

final transcript:
none -> processing -> completed
                   -> failed -> processing (retry)
completed -> processing (explicit regeneration while audio is retained)
```

The main conversation gate opens only on the `recording` transition.

## Data model

### Call brief

- `audio_retention_days`: `0`, `7`, or `30`; default `7`.
- `0` means delete immediately after a successful post-call transcript.

### Call recording

- internal recording ID;
- call brief and call attempt references;
- Twilio Call SID and Recording SID;
- status, channel count, duration, start/completion timestamps;
- deletion deadline, deletion timestamp, and non-sensitive failure code.

The application never stores Twilio credentials or an authenticated recording URL in PostgreSQL.

### Final transcript

- recording reference;
- status and model ID;
- flattened transcript text for compatibility;
- encrypted speaker-labelled turns with recording-relative start/end timestamps;
- processing timestamps and non-sensitive failure code.

Realtime transcript segments remain unchanged and are never overwritten by the post-call result.

## API and event changes

- Add a signed Twilio recording-status webhook on the isolated webhook listener.
- Add recording and final-transcript state to `CallSnapshot`.
- Add SSE events for recording and final-transcript updates.
- Add an application API endpoint that proxies authenticated audio playback.
- Add an application API endpoint for immediate recording deletion.
- Allow an operator to regenerate a completed transcript while the retained audio is still available.

The Twilio-only tunnel must not expose the application API or audio playback endpoint.

## Transcription context

Build a bounded prompt from:

- call locale and optional fallback locale;
- assistant, represented person, and recipient names;
- exact call objective;
- a length-limited background context;
- approved facts.

Build literal keywords from names, recipient/organisation, and short approved facts. Keywords are hints only and must be evaluated for hallucinated insertions.

## Retention and access

- Default audio retention: 7 days after the post-call transcript completes.
- Optional retention: immediate deletion or 30 days.
- Run expiry cleanup after startup, after transcription, and on a periodic timer.
- Audio playback is proxied by the main API. Production deployment requires authenticated operator access before audio can be exposed outside a trusted environment.
- Transcript and audit retention are separate product policies and are not implicitly deleted with audio.

## Failure and recovery rules

- Recording start failure: keep recipient audio blocked, announce failure, end call.
- Duplicate Twilio callbacks: upsert by internal recording ID and Twilio Recording SID.
- API restart during transcription: reset the interrupted job and retry from the completed Twilio recording.
- OpenAI or download failure: keep the recording, show `failed`, and allow a later retry.
- Recording deletion failure: retain the deletion deadline and retry during the next cleanup pass.
- Media larger than the OpenAI upload limit: fail with an explicit size error; future work may add bounded audio chunking.

## Verification

- Unit-test that no recording request occurs before DTMF consent.
- Unit-test that recipient audio stays blocked while recording is starting.
- Unit-test successful and failed recording starts.
- Verify Twilio recording request uses `dual` channels and `both` tracks.
- Verify recording webhooks reject invalid signatures and are idempotent.
- Verify transcription context excludes secrets and includes expected names/languages.
- Verify the downloaded file retains both Twilio channels and falls back safely for mono-only recordings.
- Verify voice-activity segmentation preserves short replies and merges natural within-turn pauses.
- Verify physical channels are mapped to roles without using live captions as final wording.
- Verify completed, failed, deleted, and restart-recovery states in memory and PostgreSQL.
- Verify the UI distinguishes draft and post-call transcripts and exposes audio only while available.
- Run lint, typecheck, all tests, production build, migrations, and local HTTP health checks.

## Deferred quality work

- A/B evaluation of `gpt-transcribe` and `gpt-4o-transcribe` on representative Swiss telephone audio.
- Migration of live captions from `gpt-realtime-whisper` to the current recommended live transcription model after a separate latency/accuracy evaluation.
- Click-to-seek transcript/audio alignment and waveform highlighting.
- A measured voice-activity threshold and segmentation benchmark on longer calls, background noise, voicemail, and overlapping Swiss German speech.
- Operator corrections with immutable transcript revisions and a `Verified transcript` state.
- Authenticated production deployment and encrypted customer-controlled object storage.
