# Real-provider drills

Updated 2026-09-07: runner repaired for async preparation (R06). The non-billable
harness passes; a current recipient-authorized live call has not been executed.
The August and September provider evidence below is preserved from both histories;
it does not validate this newly merged artifact.

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
   authorization sentinel plus the revision/hash printed by preparation and reviewed
   in the UI. A changed plan is rejected; start posts the expected revision/hash.

```powershell
$env:REAL_CALL_DRILL_MODE='start'
$env:REAL_CALL_DRILL_CALL_ID='<prepared-application-call-uuid>'
$env:REAL_CALL_DRILL_REVISION='<reviewed-revision>'
$env:REAL_CALL_DRILL_SNAPSHOT_HASH='<reviewed-64-character-hash>'
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

### Authorized repeat — passed

The recipient later confirmed that the earlier call had simply been missed and
explicitly authorized one repeat. That repeat passed the strict `settled` inspection:

- voice consent was granted, recording and conversation started, first audio was
  observed, the conversation ended cleanly, and final transcription completed;
- call, recording, cost, transcription, and zero-day retention reconciliation all
  succeeded on their first durable attempt; the 69-second recording was deleted;
- Twilio reported 88 connected seconds, 120 billable seconds, and USD 0.360400 actual
  connectivity cost;
- the versioned OpenAI public-rate calculation was USD 0.115863: compilation USD
  0.011722, Realtime text USD 0.028168, Realtime audio USD 0.069696, Realtime input
  transcription USD 0.003684, and post-call transcription USD 0.002593;
- compiler usage was 1,577 input tokens (1,574 cached), 554 output tokens, 52 reasoning
  tokens, and 2,131 total tokens. Six Realtime responses retained 5,614 text input
  tokens (1,280 cached), 430 text output tokens, 180 audio input tokens, and 999 audio
  output tokens. Five Realtime transcription observations covered 13 seconds. Eight
  post-call utterance requests retained 4,831 total tokens, including 473 audio input
  tokens;
- one interrupted/non-completed Realtime response still retained its provider outcome
  and usage, and later responses completed the flow. Provider request/response keys
  remained deduplicated and the call attempt matched the exact approved snapshot.

The repeat also exposed an estimate-only accounting gap: the configured legacy
Realtime-per-minute fallback used recording duration and therefore omitted the
pre-consent interval. The fallback now uses the greater of recording duration and
the bounded `realtime.ready`-to-attempt-end interval. Raw provider session/token usage
remains the preferred source and is unchanged; this correction only makes the legacy
fallback conservative when actual token data is unavailable.
