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
