# Real-provider drills

Updated 2026-09-07: runner repaired for async preparation (R06). The non-billable
harness passes; a current recipient-authorized live call has not been executed.
The August evidence below is historical and does not close current acceptance.

These drills use real Twilio Voice/OpenAI when configured. Use only an approved CH
destination and an existing controlled, verified account. The runner never registers
an account, sends a verification SMS, or automatically accepts Terms/AUP. Keep account
credentials, recipient/provider identifiers, audio and transcripts out of committed evidence.

## Prepare, review, then start

1. Start the API, external worker and scoped Twilio ingress tunnel. The worker must
   be available for preparation. Keep application/auth routes private.
2. Sign in through the web UI and accept current Terms/AUP. Supply the existing
   account credentials through protected process env: REAL_CALL_DRILL_EMAIL and
   REAL_CALL_DRILL_PASSWORD. Supply REAL_CALL_DRILL_TARGET with the approved CH number.
3. Run the default prepare stage. An optional UUID REAL_CALL_DRILL_IDEMPOTENCY_KEY
   makes enqueue retries refer to the same input. The runner prints that key, uses
   POST /api/call-preparations (202), polls for up to five minutes and fetches the
   resulting call. Failure/cancellation/timeout cannot proceed to dialling.

```powershell
$env:REAL_CALL_DRILL_MODE='prepare'
corepack pnpm --filter @callassist/api drill:real-call
```

4. The command exits with the application call UUID and does not dial. Open that
   call in the UI and review its exact recipient, opening and facts. For a worker
   outage drill, stop the worker now, after preparation has succeeded.
5. Obtain recipient approval for this reviewed call. Supply its UUID and the explicit
   authorization sentinel; the start stage uses the existing call without compilation.

```powershell
$env:REAL_CALL_DRILL_MODE='start'
$env:REAL_CALL_DRILL_CALL_ID='<prepared-application-call-uuid>'
$env:REAL_CALL_DRILL_CONFIRM='CALL_AUTHORIZED'
corepack pnpm --filter @callassist/api drill:real-call
```

The API URL defaults to loopback port 4000; REAL_CALL_DRILL_API_URL can set an HTTPS
origin or loopback HTTP origin. Redirects are refused. Each request has a 30-second
timeout. Start polls for a terminal state for up to ten minutes. A polling/network
error does not prove the provider call stopped: inspect the existing call before any
retry. The API rejects starting an already active/terminal call; the runner does not
create a replacement call automatically. Each invocation revokes its login session
on normal or exceptional completion when the API remains reachable.

6. Verify spoken consent/refusal, recording and opening boundaries, and terminal
   provider status. Run the read-only inspector with the application call UUID:

```powershell
$env:REAL_CALL_DRILL_EXPECT='worker_backlog'
corepack pnpm --filter @callassist/api drill:real-call:inspect
corepack pnpm --filter @callassist/api worker
# In another terminal after worker recovery:
$env:REAL_CALL_DRILL_EXPECT='settled'
corepack pnpm --filter @callassist/api drill:real-call:inspect
```

worker_backlog checks the connected-call charge and queued post-call work. settled
checks recovery, retention and zero-day recording deletion. For audio-grounded ASR
review use an explicitly retained-audio scenario; this runner requests zero days.
Record only minimized outcomes, application version and configuration references.

## Non-billable verification

run-real-call-drill.test.mjs verifies schema-valid enqueue, stable UUID header,
queued/processing/success polling, the prepare-before-start boundary, resume without
compilation, failed/cancelled/absent-worker behavior, existing-account-only identity,
policy acceptance and explicit dial authorization. These are harness results, not
provider or recipient approval. Current live acceptance remains open in R06.

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

The historical drill proved recovery of a real queued workload across worker absence and a real
provider callback compatibility failure. It does not claim external exactly-once
execution: provider operations remain retryable and repository lease fencing protects
application state.

These August results predate asynchronous preparation and voice-consent changes.
They do not establish that the current runner or current provider configuration works.
