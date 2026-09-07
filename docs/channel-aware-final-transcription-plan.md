# Channel-aware final transcription

Status: implemented in the current runtime; reviewed 2026-09-07 against `96229ea`.
The problem and experiments below describe the earlier alignment implementation.
See [current transcription behavior](post-call-transcription-plan.md) and
[current release evidence](project-audit-2026-09-07.md).

## Problem

The retained Twilio recording is dual-channel, but the earlier final transcript
assigned roles by aligning one unstructured recording transcript with the Realtime
draft. Realtime recognition errors and missing short turns can consequently move
recording-derived words to the wrong role or publish an `unknown` speaker.

The call recorded on 2026-08-18 demonstrated both failures: `Ja, gern` was split
between the recipient and assistant, while one question/answer pair and
`Gleichfalls` could not be assigned.

## Decision

The recording channel is the only authority for speaker role:

- Twilio dual-channel WAV is downloaded without downmixing;
- channel activity is detected locally and converted to chronological utterances;
- each utterance is transcribed from recording audio with its known channel role;
- isolated utterances use `gpt-4o-transcribe`; `gpt-transcribe` remains the
  whole-recording fallback for mono or unsupported media;
- Realtime events are not used to assign final roles or supply final wording;
- adjacent utterances of the same role may be merged for display;
- a mono or unsupported recording falls back to canonical plain text without
  invented roles.

New channel-derived final segments do not use the `unknown` role; historical segments
and compatibility contracts can still contain it. Unintelligible audio on a
known channel remains attached to that channel and may be represented as an
explicit non-speech placeholder in a later operator-editing feature.

## Cost and latency controls

- Detect and upload speech regions rather than two complete channels containing
  silence.
- Merge short same-channel gaps and add only bounded speech padding.
- Transcribe utterances concurrently with a small fixed concurrency limit.
- Keep the existing full-recording path as a fallback, not an additional request.

The sum of uploaded speech duration should remain close to or below the duration
of the current full mixed recording. Request count rises, while billable audio and
post-call latency remain bounded.

## Acceptance criteria

1. A dual-channel fixture with alternating speakers produces deterministic
   `assistant` and `recipient` segments in chronological order.
2. Short replies are never assigned to the opposite role.
3. Structured output contains no `unknown` role.
4. Live transcript wording and roles cannot affect structured final output.
5. Mono, malformed, silent, and oversized inputs fail or fall back safely.
6. Model failures never publish a partial transcript as completed.
7. Unit tests, typecheck, lint, and build pass.
8. The retained latest-call recording can be regenerated and compared with audio
   before merge.

## Rollout

The implementation is already present on the audited source commit; no feature-branch
merge is pending. Channel extraction and transcriber tests pass in the dated audit.
The prior retained-call experiment is historical evidence. Current-commit live calls
and a representative multilingual/audio-quality corpus remain roadmap R06/R14.
