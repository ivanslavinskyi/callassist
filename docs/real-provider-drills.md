# Real-provider drills

These drills exercise the local PostgreSQL application against real Twilio Voice
and OpenAI services. They are manual release evidence, not part of CI. Never run
them without the recipient's explicit approval, and never commit the target phone
number, provider identifiers, credentials, recordings, or transcript text.

## Safe invocation

Start the API with `DURABLE_WORKER_MODE=external`, a temporary HTTPS tunnel pointed
only at the Twilio ingress listener, and the dedicated worker in a separate terminal.
The runner requires an explicit authorization sentinel and creates a fresh local test
account. The target and verification code are process environment values only:

```powershell
$env:REAL_CALL_DRILL_CONFIRM='CALL_AUTHORIZED'
$env:REAL_CALL_DRILL_TARGET='+41...'
$env:REAL_CALL_DRILL_VERIFICATION_CODE='...'
corepack pnpm --filter @callassist/api drill:real-call
```

For a worker-outage drill, stop the worker before starting the call. After the call
reaches a terminal status, use the PII-safe inspector with the returned application
call UUID:

```powershell
$env:REAL_CALL_DRILL_CALL_ID='<application-call-uuid>'
$env:REAL_CALL_DRILL_EXPECT='worker_backlog'
corepack pnpm --filter @callassist/api drill:real-call:inspect

corepack pnpm --filter @callassist/api worker

$env:REAL_CALL_DRILL_EXPECT='settled'
corepack pnpm --filter @callassist/api drill:real-call:inspect
```

`worker_backlog` proves the connected call is charged while reconciliation and
post-call work remain durably queued with zero attempts. `settled` proves a restarted
worker drains those jobs, creates and completes retention work, and deletes the
zero-day recording. Both checks fail closed if the call, credit ledger, job state, or
recording lifecycle differs from the expected state.

## Evidence — 2026-08-22

Two authorized calls were run against real Twilio Voice and OpenAI services without
retaining recipient or provider identifiers in this document:

- Baseline split-runtime call: connected and completed; one reservation and one
  connection-backed charge were recorded; four durable jobs succeeded on their first
  attempt; the 52-second zero-day recording was deleted.
- Worker-outage call: completed while the worker was stopped. The 59-second recording
  remained available and the call reconciliation, recording reconciliation, and
  transcription jobs remained queued with zero attempts. On worker restart, all three
  succeeded on their first attempt, retention was created and succeeded, and the
  recording was deleted. Credit settlement did not change during recovery.
- A real `initiated` progress callback exposed an integration mismatch: Twilio allows
  `initiated` in webhook `CallStatus`, although it is not a REST Call resource status.
  The callback model is now separate from the resource model, maps `initiated` to
  domain `dialing`, and is covered by a signed-webhook regression test. A repeat call
  accepted every progress callback.
- One OpenAI compiler request failed before brief creation during preparation. The API
  returned `BRIEF_COMPILER_UNAVAILABLE`; no provider call was created and the retry
  succeeded. This confirms the pre-provider boundary fails closed.

The drill proves recovery of a real queued workload across worker absence and a real
provider callback compatibility failure. It does not claim external exactly-once
execution: provider operations remain retryable and repository lease fencing protects
application state.

## Evidence — 2026-09-05

An authorized local deployment rehearsal was run against PostgreSQL 17, real Twilio
Voice, and OpenAI. No recipient number, provider identifier, credential, recording,
or transcript text is retained here.

- Migrations 0050 through 0057 applied to an isolated restored clone and then to the
  local source database. A second migration pass was a no-op. The post-migration
  recovery drill verified 57 canonical migrations, 58 public tables, 14 critical
  tables, and seven encrypted samples. Generated clone/dump resources were removed.
- The migration-created backlog of 25 Twilio call-cost reconciliation jobs succeeded.
  Two unrelated overdue recording-retention jobs were temporarily moved out of the
  rehearsal window and restored to their original `delete_after` schedule after the
  worker stopped; the rehearsal did not delete those recordings.
- The first runner invocation failed before preparation because it still used the
  removed synchronous create route. The second produced a compiled review but failed
  closed before telephony because it omitted the immutable revision/hash approval.
  Its billable compiler usage remained in the preparation-scoped provider ledger.
  The runner now uses asynchronous preparation and approves the exact returned
  compilation revision and snapshot hash.
- The corrected call connected and reached provider/application `completed`. The
  attempt was bound to the approved 64-character snapshot hash. Twilio reported 28
  connected seconds, 60 billable seconds, and USD 0.180200 actual connectivity cost.
  The call-cost reconciliation jobs each succeeded once, and no duplicate provider
  request or response IDs were found.
- OpenAI raw usage was retained separately: compilation used 1,577 input tokens
  (1,574 cached), 657 output tokens, 127 reasoning tokens, and 2,234 total tokens.
  Consent prompt/clarification used 231 text input, 148 text output, and 322 audio
  output tokens; consent transcription reported one second. The versioned public-rate
  calculation was USD 0.039150 total (compiler USD 0.013782, Realtime text USD
  0.004476, Realtime audio USD 0.020608, transcription USD 0.000284).
- This is **failed release evidence**, not a successful end-to-end task execution.
  Consent transcription classified the first response as unclear, issued a
  clarification, and the media stream ended before consent was granted. Telemetry
  recorded `consent.failed` with `stream_ended_before_consent`; no task opening,
  recording, or post-call transcription ran. The strict `settled` assertion therefore
  failed as intended.
- Configured per-minute fallback rates were absent, so the fallback estimate remained
  explicitly unavailable. Token-based OpenAI cost remained `partial` because the
  telephony usage bucket is not list-price calculated, while Twilio actual connectivity
  cost was separately provider-reported.

Before treating this release gate as passed, reproduce the Russian consent flow with
the recipient instructed to answer the recording question explicitly (or press the
documented DTMF fallback), capture whether clarification audio completes, and obtain a
trace containing `consent.granted`, `conversation.started`, recording/post-call jobs,
and a passing strict `settled` inspection. A repeat call requires fresh recipient
authorization; the drill must never redial automatically.
