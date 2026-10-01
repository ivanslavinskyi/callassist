# Consent and call completion: 29 September 2026

Follow-up to [the two real-call failures](live-two-calls-review-2026-09-29.md).
The fixes apply to the common Live lifecycle, without language-specific answer lists
or a new classification service.

## Changes

- Enable the existing consent backend when disclosure starts. Keep overlapping
  recipient timing evidence even when transcript events arrive out of order or the
  assistant continues speaking. A decision received early waits for the matching
  verified playback mark; a subsequent correction invalidates it. Recording starts
  only after that gate, without requiring the recipient to repeat consent.
- Cap acoustic extensions of the consent wait at 20 seconds after playback. Repeated
  noise can no longer postpone clarification indefinitely.
- Use the existing 600 ms turn settlement to request a managed backend decision when
  native delegation has not processed the answer. Reuse the same backend and tool
  gates. Pending native responses/continuations suppress duplicate work; each answer
  and configuration revision gets at most one application request. Acoustic activity
  alone is not another answer. Completed stale/rejected consent work can yield to a
  fresh delegation after the corrected answer settles.
- Keep an accepted end_call valid when late assistant speech contaminates its
  farewell. Use the existing bounded, playback-confirmed short farewell recovery.
  Actual recipient interruption still cancels closure. Previously an assistant
  question could return the call to conversation and leave it waiting indefinitely.
- Retain the earlier single retry for a missing/unverified disclosure, and explicit
  failure telemetry. No retries of appointment commitments or unconfirmed playback.

## Verification

`node node_modules/vitest/vitest.mjs run src/voice src/beta/beta-spend-accounting.test.ts`
from `apps/api`: **211 tests passed**. API `tsc --noEmit` passed. After extending the
native-delegation regression to cover acoustic noise, all 88 unified-call tests passed.
Coverage includes overlapping consent, reverse transcript delivery, corrected consent,
recording admission, absent/announced native delegation, bounded noise waiting, closing
recovery, actual recipient interruption, and appointment authorization/confirmation.

Branch verification before publication: **1,899 tests across 211 files passed across
the initial run and targeted database rerun** (contracts 143, web 321, API 1,435).
The initial API run passed 1,388 tests but six suites could not start because the old
shared test database's migration 0065 checksum did not match the source catalog.
All 47 affected tests then passed against a fresh isolated test database, which was
removed after the run. No applied checksum or application database was changed.
Recursive workspace typechecking and lint passed. On this Windows environment Turbo
could not locate the pnpm binary; the same package scripts ran via `corepack pnpm -r`.

Paid synthetic audio probes used the real Live and managed Responses APIs with an
in-memory call service and simulated Twilio playback marks. No telephone calls were
placed. Local evidence files are ignored diagnostic artifacts:

| Probe | Evidence | Result |
| --- | --- | --- |
| Russian consent during disclosure | `.tools/progress-fix-overlap-ru.log` | Recording and verified hangup; 44.6 s total |
| English task with native task delegation suppressed | `.tools/progress-fix-en-no-native.log` | Application requested the decision; verified hangup; 42.1 s |
| Injected incorrect first utterance | `.tools/progress-fix-bad-first.log` | Full disclosure retry, recording, verified hangup; 45.2 s |
| English overlapping consent plus suppressed native task delegation, final code | `.tools/progress-final-en-overlap.log` | Recording, application decision, verified hangup; 39.7 s; 6.7 s from closing authorization |
| German overlapping consent, final code | `.tools/progress-final-de-overlap.log` | Recording, native decision, verified hangup; 48.0 s; 9.9 s from closing authorization |

The German probe also requested suppression of native task delegation, but the model
still delegated natively. It verifies overlap and completion, not the missing-native
recovery. The English probe's application-request log verifies that recovery.

An earlier combined English probe (`.tools/progress-fix-en-overlap.log`) timed out
after an accepted end_call was revoked by late assistant speech. That failure caused
the closing fix above; its regression explicitly requires farewell playback before
hangup. It is not counted as a successful probe.

These checks establish the repaired application transitions, not a real-phone success
rate or perfect model wording. Synthetic output still sometimes contains extra
acknowledgments or repeated introductions. Streaming verification is not a filter
that can prevent every unwanted word from reaching the recipient.

## Local application

The follow-up UI fix removes legacy persona names from plan confirmation and call
details in favor of the selected voice. A shared SHPROHLI display label is used in
live, saved and translated transcripts, clipboard exports and PDF metadata/speakers.
Existing stored profile IDs, recipient names and actual transcript text are preserved.
The form field is labelled Voice. Web TypeScript and 27 relevant tests passed; the
running local dev server compiled the change without restarting the API.

Applied to the local API at **10:53:42 Europe/Zurich**, 29 September 2026,
PID 24988. The pre-restart database check found zero active calls. Both ports 4000
and 4001 belong to the new process; liveness is `alive`, readiness and database are
`ready`. Runtime remains Live with legacy fallback disabled. No migrations or
production deployment were performed. A new handset acceptance call remains to be
performed; the synthetic probes above do not substitute for it.
