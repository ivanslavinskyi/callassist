# Live playback and post-call transcription recovery

> Historical checkpoint, not the current runtime specification. As of 28 September,
> consent uses native `report_consent`, and `end_call` carries a reason without a
> scripted recap. See the [current runtime](live-unified-runtime.md) and
> [real-call review](live-call-review-2026-09-28.md). Results and pending items below
> describe the implementation at this report's date.


Follow-up on `codex/live-unified-runtime`, 2026-09-27. No new database migration.

## Recording processing and budget

`BETA_BUDGET_EXHAUSTED`, `BETA_BUDGET_UNCONFIGURED` and `BETA_SPENDING_PAUSED`
remain distinct from provider/transcription errors. A final transcription blocked
at admission stays in the durable queue and retries after five minutes. Deferral
does not consume a provider retry, change the generation or discard completed
chunk results. Actual failed provider attempts retain the existing retry limit.
The existing final-transcript storage status remains `failed` for compatibility;
the reason identifies a waiting state in all seven UI locales. No manual retry
button is presented for that waiting state. Admin shows the reason and scheduled
time on the queued job. Recording deletion and retention rules remain in force.

New Twilio calls atomically reserve both the call allowance and a separate
`postcall:<attemptId>` transcription pool. The pool equals four configured
`transcriptionRequestReserveMicros` allowances, matching the four upload workers.
If either allowance cannot fit, admission rolls back before starting a call.
Each request acquires the beta-control lock and checks the pool's known costs and
unfinished requests before using it. Unknown request costs retain one allowance.
Legacy calls, expired pools and overruns require ordinary per-request admission;
no pool bypasses a global spending pause. This is protected processing capacity,
not a guarantee against arbitrary provider cost overruns.

After processing completes, or a recording is failed/deleted/unneeded, unused
capacity is released by the accounting query. Known usage remains charged and
uncertain provider requests remain reserved. Separately admitted overruns are
excluded from the pool and call total to avoid counting them twice. Budget windows
continue to use the existing rolling 24-hour policy.

Live consent/speech/action classifiers are text-only Responses requests. They no
longer require audio-token fields to reconcile a completed call's allowance.
This corrects accounting from existing evidence without rewriting the ledger,
deleting reservations, or treating network failures as free requests.

## Spoken questions and closing

An ordinary backend `speak` decision now owns a controlled Live utterance through
the verified transcript and its matching Twilio playback mark. PCMU streams
immediately for ordinary questions; critical appointment speech retains its
pre-playback buffer. Recipient speech cancels playback, resolves the pending
application step and invalidates the old decision. A cleared/stale mark cannot
complete a later step or authorize hangup.

Unrequested Live output outside the controlled utterance is neither forwarded
to Twilio nor persisted as spoken evidence. This removes the competing autonomous
follow-up question before a controller-requested recap. The frontend prompt also
requests silence between application utterances. There are no phrase-specific
rules for particular answers, foods or languages.

`session.instructions.appended` confirms estimated context injection, not the
start or end of the corresponding audio. It is deliberately not used to cut the
audio stream: real provider testing showed that this can drop the start of valid
speech. Transcript/quiet checks and Twilio playback marks remain authoritative
for completing application steps.

All audio, consent, questions, recap and farewell still use one GPT-Live session.
Luna selects task decisions; it does not synthesize speech. Ordinary streaming
speech is checked as it arrives, so this is not a guarantee that every divergent
word can be suppressed before playback. Appointment actions retain the stronger
buffered gate. AMD pickup latency is unchanged.

The implementation uses official native Live instruction events and application
playback control, not Realtime `response.done` events. See
[OpenAI delegation documentation](https://developers.openai.com/api/docs/guides/live-delegation).

## Verification and rollout

Regression coverage includes pooled admission under concurrency, rollback on
insufficient funds, text-only usage, uncertain costs, deferred retries beyond the
normal attempt limit, PostgreSQL lease handling, localized waiting copy, PCMU,
unrequested output, interrupted questions, stale marks and closing.

Run the full tests, lint, typecheck and build. Then use `probe-live-client.mts`
for a paid synthetic OpenAI check and manually test a Twilio conversation before
deployment. Previously dead-lettered generic transcription errors are not
automatically assumed to be budget errors: inspect and explicitly retry the
affected recording through the existing owner/admin flow. Do not raise budgets
or clear uncertain reservations as a recovery shortcut.

Verified locally on 2026-09-27:

- Full suite: **1,829 tests / 205 files**, exit 0 (API 1,378 / 127;
  web 315 / 59; contracts 136 / 19). The final changed call-service/playback
  files also passed a separate 100-test run, exit 0.
- Full lint, typecheck and build: exit 0 each.
- Real OpenAI synthetic audio probe: 2 backend requests, 5 playback marks,
  question, concise recap, farewell and automatic hangup; exit 0. No human
  telephone call was placed by this probe.
- The reviewed recording was explicitly requeued locally. Final transcription
  completed on the first recovery attempt; summary and automatic assessment
  became ready. The owner's configured $50 budget was preserved.

Local API was restarted with Live and fallback disabled. Production is unchanged;
manual Twilio acceptance remains necessary before rollout.
