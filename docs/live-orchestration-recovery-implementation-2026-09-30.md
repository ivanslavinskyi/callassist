# Live orchestration recovery — 30 September 2026

Current follow-up: [v4 implementation and acceptance record](live-combined-stabilization-implementation-2026-09-30.md) implements the combined runtime/disclosure changes. Historical evidence below describes its original version; v4 handset acceptance remains pending.


Branch: `codex/live-unified-runtime`. Implements the four owner-approved changes in
[the complex appointment incident review](live-appointment-incident-review-2026-09-30.md).
The implementation emits `live-managed-v3`. This was a local candidate awaiting
handset acceptance at implementation time. The subsequent
[20:51 Zurich handset review](live-post-v3-call-review-2026-09-30.md) records failed
acceptance and the remaining work in the
[combined stabilization/disclosure plan](live-runtime-stabilization-and-disclosure-plan-2026-09-30.md).
No outbound test call or production deployment was made by the implementation task.

## Failure ownership

Backend responses, announced delegations and managed commands retain their input
epoch, answer/backend revisions and accepted-progress revision. An obsolete timeout
settles its own provider operation and schedules current work; it cannot initiate a
failure farewell for a newer conversation. Pending failure rechecks its owner before
speaking and is revoked by newer input or accepted progress. Late announced starts
keep their original ownership even after the start deadline expires. Old tool calls
and command rejections cannot act on a newer revision or blindly replay work.

Current failure remains bounded: 15 seconds for a missing backend start/command
acknowledgment, 30 seconds for a response, at most 8 seconds to yield for playback/input
before failure handling. Existing bounded task waits and closing deadlines remain.
Owned failure is diagnosed with its specific code in durable events. Provider ledger
completion and a call-level failure are separate facts.

The managed wire protocol has no client-supplied delegation identifier on
`response.create`. Scoped continuations use the known delegation; unscoped fresh
requests are matched only within the current ownership revision. This does not prove
causal association between concurrent native/application starts in the same revision.
It remains an observation for the next real call, rather than a claim that all provider
ordering ambiguity has been removed.

## Disclosure, noise and consent

Short energy bursts do not clear or replay mandatory disclosure. Sustained input
of at least 500 ms while mandatory audio is playing clears that generation and
requires a complete fresh mandatory segment after quiet. Cleared or old marks never
authorize recording. Acoustic energy alone does not discard the permission question;
recognized answer fragments govern that boundary. Semantic consent, actual complete
mandatory playback and recording startup remain separate gates.

There are at most three mandatory playback attempts and one independent 60-second
disclosure/consent deadline. Neither noise nor replay resets the overall deadline.
Pre-consent recipient speech remains unpersisted. The filter uses signal duration,
not language-specific words or scenario-specific conditions. Sustained background
noise can still look like an interruption; 500 ms is a conservative heuristic, not
semantic proof of speech or a guarantee of acoustic stability.

## One recoverable appointment action

The application still validates the exact authorized proposal and constructs the
spoken text. Live/backend receive the current application-owned action journal and
instructions to finish missing details first. The action keeps its immutable proposal,
identity, approval snapshot and optimistic version. The existing database states
`sending`, `uncertain`, `delivered`, `confirmed` remain; no migration is required.

Encrypted delivery evidence records `request` or `status_check`, attempt number and
`not_sent`, `unacknowledged` or `played`. Buffered speech waits through acoustic input
and is released only after quiet and complete text verification. A meaningful recipient
fragment invalidates the old buffer. An interruption after release conservatively
means possible delivery, even if a cleared mark later arrives.

- A canceled request with no audio forwarded may be requested once more, for the
  same exact proposal. There are at most two booking-request attempts.
- After possible delivery, or after the second never-transmitted request, recovery
  asks only whether the same exact arrangement is already booked. Canonical status
  questions in all seven call locales explicitly prohibit another booking.
- There are at most three total request/status-check attempts for one action. A
  different proposal, duplicate action or exhausted recovery is rejected.
- Legacy uncertain records without delivery evidence permit only a status check.
- Confirmation requires played request/status audio, the exact proposal and a later
  recipient answer evaluated by the backend. Refusal, ambiguity, availability and
  supplied personal details do not establish confirmation. `externallyVerified=false`
  is retained; no external calendar integration is implied.

Recovery is within the current admitted stream. A restarted/reconnected stream does
not restore an in-memory conversation automatically; the durable uniqueness fence
still prevents a second action for the same attempt. Changed arrangements after an
uncertain booking require clarification and cannot silently become a replacement
booking. These are deliberate bounds on external action, not service-specific rules.

## Result and diagnostics

Call snapshots expose the latest attempt's minimal action state, without personal
details. The result panel matches it to the displayed transcript attempt and shows
uncertainty independently of a generated spoken-outcome summary. A confirmed result
is explicitly a recipient confirmation, not external verification. All seven UI
locales are covered; earlier attempts cannot lend confirmation to a later result.

Durable `conversation.task` events add bounded cause, response identifier, release,
action and delivery state. Application logs include disclosure attempt and interrupted
playback generation. Historical v2 events remain readable. A canceled controlled
utterance marks native capture incomplete so recording ASR can recover what was actually
heard; a partial zone suffix is never evidence of a full delivered commitment.

## Verification and rollback

Before edits, affected files and runtime state were saved in
`.tools/live-incident-baseline-20260930/manifest.json` and
`before-restart-state.json`. This preserves the pre-incident-fix local code, including
the earlier brand/weekday changes. The previous loaded voice candidate is separately
preserved in `.tools/live-weekdays-candidate-20260930/manifest.json`.
The final source snapshot is `.tools/live-incident-candidate-20260930/manifest.json`.
These local private artifacts are intentionally excluded from Git. Do not reset the
whole branch to roll back: unrelated earlier edits must remain intact. Restore the
selected saved production sources, remove only files introduced by this change if
necessary, rerun types/tests, then restart the local API after the no-active-call check.
Journal metadata is optional and database state values are backward compatible.

Regression coverage includes short/sustained noise, replay/total deadline, obsolete
response and announced-start timeouts, a late stale tool, newer progress canceling
pending failure, old command errors, genuinely current failures, buffered quiet
release, untransmitted retry, possible-delivery status reconciliation, exact/refused/
changed confirmation, attempt bounds, encrypted PostgreSQL persistence/export,
historical event compatibility and attempt-bound UI results.

Validation logs are saved under `.tools/incident-*.log`:

- All 186 contracts tests and all 330 web tests passed.
- The voice/storage run passed 275 tests across 14 suites, including encrypted
  PostgreSQL action recovery and export. The final source regression run passed
  139 tests after the last ownership/diagnostic changes.
- API, contracts and web type checks and production builds passed. The web build
  used a separate `.next-incident-qa` directory; its generated type references were
  restored to the existing local dev directory afterward.
- The first full API run passed 1502 tests and failed four after the new test
  mistakenly closed a shared repository. The fixture cleanup was corrected and the
  affected voice/database suites passed. The final parallel API run passed 1501 of
  1507 tests; six failures were in the existing PostgreSQL text-artifact lease tests
  (`DURABLE_JOB_LEASE_LOST`/missing claimed job). An isolated repeat of all 11 tests
  in that suite passed without production changes. This is an unresolved parallel
  test-run instability; the full parallel run is not reported as green.
- `git diff --check` passed. No migration or execution approval hash was changed.

Local activation: API PID `24724`, restart at **19:09:06 CEST**, readiness at
**19:09:09 CEST** on 30 September. Preflight found zero active calls and the existing
90 migration records through 0089. Runtime is Live, fallback=false, agent hangup=true,
Shprohli and deterministic appointment weekdays. Local API liveness/readiness and
`http://localhost:3000/ru` returned 200. The existing public Twilio gateway returned
404 for the private health path and 403 for unsigned voice ingress. All 24 source
hashes matched the candidate manifest after restart. Authoritative local state is
`.tools/runtime/stabilization-state.json`. The next call must confirm its own v3
readiness event; no provider session or handset call was opened by these checks.

These checks use synthetic sockets/audio and isolated test databases. They do not
establish handset timing, actual pronunciation or provider behavior. The incident
recording was not independently listened to during implementation.

## Manual acceptance

Follow-up: the [separate assistance reason audit](live-assistance-reason-audit-2026-09-30.md)
found two reproducible, unfixed boundary failures in the reason-opening stage. Its
normal matrix passes, but a selected reason still needs interruption and transcript
admission repair before that part of handset acceptance can be called ready.

Use the existing appointment scenario, with ordinary short noise during disclosure,
then required name/spelling/additional facts and an interruption of the request.
Verify one full disclosure and consent, no repeat from short noise, no long unexplained
gap, correct weekday/date/time, one arrangement, truthful uncertainty or later exact
confirmation, and playback-confirmed hangup after reciprocal farewell. Preserve refusal
and corrections. Inspect `realtime.ready=live-managed-v3`, failure ownership, delivery
state, native capture and provider operations for that exact attempt before declaring
this candidate stable.
