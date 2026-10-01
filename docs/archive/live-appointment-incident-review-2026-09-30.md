# Appointment call orchestration incident on 30 September 2026

The latest handset call exposed application orchestration defects that the previous
information-call checkpoint did not exercise. The decisive defect is an obsolete
backend response's timeout invoking the global failure path after newer reasoning
has succeeded. A separate interrupted appointment request becomes permanently
unconfirmable while ordinary Live speech continues. Mandatory disclosure replay is
also triggered by acoustic energy alone. The current weekday/brand candidate remains
running; this review changes documentation and private diagnostic artifacts only.

## Scope and evidence

Branch: `codex/live-unified-runtime`. Attempt `137cc653-2741-4459-9e15-d1f48226abd9`,
brief `5c85ca6d-bf6c-4357-89d5-95be71142e88`. Connected from 17:49:33 to 17:52:07
Zurich on 30 September, approximately 154 seconds. The approved task was one massage
appointment during the next seven days, excluding Friday, between 09:00 and 18:00,
with the called recipient and no new financial terms.

Reviewed 44 attempt-scoped events, 22 provider operations, the immutable execution
snapshot, encrypted action journal, saved native transcript, final transcript,
assessment/summary, recording metadata, durable jobs and API PID 9372 logs. All
fourteen production-source hashes still match the activated weekday candidate.
Private extracts and reproducible diagnostics are:

- `.tools/weekdays-last-call-20260930.private.json`
- `.tools/review-weekdays-last-call-20260930.mts`
- `.tools/weekdays-incident-timeline.private.log`
- `.tools/weekdays-incident.test.ts`, generated from the current test harness and
  `.tools/weekdays-incident-cases.txt`
- `.tools/weekdays-incident-tests.log`

The two-channel post-consent recording is available for 129 seconds. It was not
independently listened to during this review. Native transcript timestamps describe
generated/recognized audio, not verified handset playback; interrupted controlled
output is deliberately withheld from persistence. Pre-consent recipient audio/text
was not retained. Therefore the exact sound behind each early interruption, and how
much of the interrupted booking request was actually heard, remain unproven.

## Timeline

All times below are Zurich on 30 September 2026; subtract two hours for UTC.

| Time | Evidence | Consequence |
| --- | --- | --- |
| 17:49:34.279 | First `disclosure.started` | Application queues the mandatory rendered disclosure. |
| 17:49:38.763 | Second `disclosure.started` | Another application playback generation, same Live session. |
| 17:49:41.333 | Third `disclosure.started` | Mandatory audio restarted again. |
| 17:49:52.796 / 54.604 | Persisted rendered disclosure / permission question | Their transcripts are published only after matching, uncleared playback marks. |
| 17:49:58.417 / 58.726 | Consent granted / recording started | Voice authorization precedes recording. |
| 17:50:35.613–39.413 | Recipient: Thursday at four in the afternoon | One permitted date matches: 1 October at 16:00. |
| 17:50:45.108 | Action journal `sending` | Validated exact request includes Thursday, full date, 16:00 and approved zone. |
| 17:50:55.565 / 55.584 | Action becomes `uncertain`; request tool rejected | No `delivered` or `confirmed` transition exists. |
| 17:50:59 onward | Recipient requests name, spelling and birth date | Conversation continues while the action remains uncertain. |
| 17:51:15.952 | Backend response starts | This response never supplies a terminal event to the application. |
| 17:51:21.359 | `invalid_request_error` for `response.create`, disposition `continued` | Error belongs to a command already moved to recent/acknowledged history. |
| 17:51:24.601–28.543 | Newer backend work succeeds | One accepted `report_task_state: continue` and its continuation. |
| approximately 17:51:45.952 | Old response reaches 30-second timeout | Ledger records `LIVE_BACKEND_TIMEOUT`; source invokes global failure handling without checking its input epoch. |
| 17:51:46.319 / 47.251 | Another accepted `continue` / successful continuation | Successful current work does not revoke the pending global failure. |
| 17:51:54.013–56.413 | Recipient: “Угу. Хорошо, есть, записала” | Recipient reports a booking; no application confirmation follows. |
| 17:51:57.613 onward | Application failure copy in saved native transcript | “Не могу надёжно продолжить…” replaces the intended final confirmation. |
| 17:52:06.770 / 07.522 | Farewell playback mark / Twilio completed | Application hangup works, but for `cannot_proceed`. |

The old timeout timestamp is derived from the recorded response start and the
30-second source timer; there is no separate timeout transition event. Its operation
result records the timeout code and exactly 30,000 ms. Later current `continue` tools
prove that this was not a uniformly dead backend.

## Confirmed defects

### Obsolete backend work can end a healthy current conversation

In `live-conversation.ts`, the response-start timer checks backend configuration
revision and special closing state, but does not check the run's input epoch or
whether newer work has superseded it. All task responses share the same backend
configuration revision. Consequently an abandoned response from an earlier recipient
turn invokes `backendFailed()` even after fresh turns and successful responses.

`UnifiedLiveCall.backendFailed()` then installs one global failure flag/deadline.
`report_task_state` success and newer recipient input do not clear or supersede it.
The failure waits briefly for acoustic/output quiet, then changes the phase to
`ending` and requests the application failure copy. This explains why the call can
sound productive immediately before its abrupt failure farewell.

The real call records one timed-out response among sixteen backend delegations;
fifteen succeeded. This is sufficient evidence of a provider-side missing terminal
event, but not of its underlying cause. The application defect is independently
proved: two synthetic tests reproduce both the obsolete timeout and the survival of
its pending failure after a newer accepted task decision. Increasing the timeout or
switching models does not repair this ownership error.

### Interrupted appointment delivery leaves an unrecoverable action

The exact proposal was valid: Thursday 1 October 2026, 16:00, Europe/Zurich. The
calendar label is correct and the permitted windows were respected. The request
became `uncertain` roughly ten seconds after journaling. The tool returned failure,
then ordinary Live conversation resumed. No second appointment action, no
`confirm_appointment` call and no successful `end_call` tool were recorded.

Both acoustic activity and any nonempty recipient transcript cancel a protected
request. The request's freshness closure also depends on every recipient fragment's
input epoch. Cancellation yields uncertainty even if the recipient is merely
supplying required booking details or a nonverbal sound. The controlled request's
discarded transcript and the persisted tail `(Europe/Zurich).` do not establish its
complete actual playback. The real cancellation's precise trigger is not separately
logged; it cannot be asserted to have been noise alone.

Once uncertain, the record blocks all further `request_appointment` calls and cannot
pass `confirm_appointment`, which requires `delivered`. The storage transition graph
also has no outgoing edge from `uncertain`. This safely prevents duplicate booking,
but provides no way to reconcile the same arrangement after interruption. A synthetic
test reproduces this dead end using only energy activity and no recognized words,
while showing that autonomous conversational audio still flows afterward.

The request was made as soon as availability was offered, before the recipient asked
for required personal details and before the explicit calendar clarification seen
later in the transcript. Those later questions are valid parts of completing one
appointment, not necessarily a correction or a request for a second appointment.
The application must represent that distinction without guessing success or
automatically repeating a commitment.

### Acoustic energy restarts the disclosure without semantic evidence

`PcmuActivity` is an RMS energy detector: 100 ms above its threshold starts activity;
600 ms quiet ends it. It does not distinguish speech, a cough, background sound or
another speaker. Before estimated mandatory playback end, activity sets
`disclosureInterrupted`, suspends consent and clears Twilio playback. The following
quiet boundary invokes a new `#disclosure()` generation. No recognized words are
required. The playback timeout is recreated per generation; there is no independent
bound on repeated disclosure generations.

Three actual starts are recorded. A synthetic test reproduces exactly three starts
in one Live session from two activity bursts without any recognized text, with only
the original two cached TTS renders. This supports the user's noise hypothesis as a
mechanism, while the lack of pre-consent acoustic evidence prevents identifying the
actual sounds. The late AMD `unknown` result admitted consent and is not a session
restart; source/tests preserve that disclosure on an inconclusive result.

## Additional findings and evidence limits

There was one native `gpt-live-1` session, voice `cedar`, fixed identity Shprohli and
`live-managed-v2`. There is no Realtime session in this attempt. The two Speech API
operations are the designed disclosure/question renderer, not another conversation
runtime. Brand and weekday changes are present; they did not select a forbidden
date. This call does not prove brand pronunciation because the persisted task opening
does not speak the brand.

The roughly thirteen-second interval between “Понял” and the saved zone suffix
overlaps the protected appointment request. The complete request is absent from the
saved transcript. It must not be labeled thirteen seconds of actual silence without
listening evidence. Other backend responses lasted about 0.7–3.6 seconds.

The command error lacks a retained provider message and cannot be diagnosed more
specifically than `invalid_request_error`. Source correlation can let an unscoped
pending application `response.create` be acknowledged by an unrelated native
response start. This deserves a causal-correlation check, but the call does not
prove that such misassociation produced its error or orphaned response. Per the
[official OpenAI delegation documentation](https://developers.openai.com/api/docs/guides/live-delegation),
Live speech and backend work are independent, and function results must be supplied
before requesting a continuation. An application timer or instruction append does
not cancel provider work. These protocol distinctions matter to the recovery design.

The final native transcript is marked `completed`, although the interrupted protected
request is omitted and only its zone tail is present. Current completeness checks
cover known clipped transport output and speech failures; cancellation of an
unacknowledged controlled utterance is not necessarily reported as incomplete.
Capture completion therefore must not be read as a complete account of heard audio.

The post-call assessment correctly says overall goal `partial`. Its summary says the
recipient reported booking and marks the explicit-confirmation criteria achieved,
while the action journal says `uncertain` and the app ended for `cannot_proceed`.
The spoken recipient report should remain visible, but the user should also see the
application's unresolved action state. Neither representation proves an external
calendar booking. The queued provider-cost reconciliation is unrelated to the voice
failure; the call itself completed and its credit was settled.

## Minimal universal stabilization proposal

The owner approved this plan and its implementation after reviewing this report.
The pre-implementation source baseline and active-runtime state are preserved in
`.tools/live-incident-baseline-20260930`. Implementation and activation evidence will
be recorded in a separate report; the incident evidence below remains historical.

1. **Give each decision and recovery an owner.** Track the actual response/delegation,
   input epoch, backend revision and task/action revision. A superseded timeout may
   settle its own ledger operation and schedule one current decision; it cannot end
   the whole call. A deferred failure must recheck its owner before speaking and be
   superseded by accepted newer progress. Apply the same rule to announced-run
   deadlines and command errors. Coalesce application recovery with native backend
   work and pending continuations; do not treat any response start as proof that an
   unrelated command succeeded. Retain finite bounds for genuinely current failure.
2. **Separate acoustic yielding from semantic task transitions.** Use activity to
   detect a possible interruption, not to declare a changed request or new consent
   cycle. Short noise should not clear mandatory audio or consume an attempt. A real
   interruption must still prevent using cleared marks and require complete disclosure
   before recording. Add an independent total disclosure/consent deadline and bounded
   replay; use existing ephemeral pre-consent interpretation without persisting
   recipient content. Preserve refusals and full corrected answers in every language.
3. **Reconcile one action instead of creating another.** Make draft, not-yet-released,
   partially released/unacknowledged, delivered-awaiting-details and confirmed states
   explicit enough to recover. Collect required details and resolve the exact date
   before the final commitment. A canceled buffer that never reached Twilio is
   different from an unacknowledged request that may have been heard. For uncertainty
   after possible delivery, ask about the status of the same exact arrangement and
   obtain a later exact recipient confirmation; never blindly replay or create a
   second booking. Supply the backend with current action/proposal state. Any new
   reconciliation transition must keep approved bounds, version checks, actual
   observed evidence and `externallyVerified=false`.
4. **Record the cause and reconcile the result display.** Log interruption origin,
   playback generation/released/acknowledged state, recovery owner and invalidation
   cause without storing pre-consent speech. Surface action uncertainty alongside
   the recipient's reported outcome, and qualify transcript completeness when a
   controlled utterance is discarded. This makes the next failed call diagnosable
   without guessing from a zone suffix or a generic farewell.

These changes concern ownership, playback and action lifecycle across all
policy-allowed tasks. They require no massage-specific branches, language word lists,
new voice runtime or relaxation of booking/consent authority. Appointment
reconciliation is the same principle applied to the application's one existing
external-action capability. A migration to client delegation is not justified by
this incident alone.

## Reproduction and next acceptance

Four diagnostic tests passed against the unchanged production code: three disclosure
starts from text-free activity; permanent uncertain-action dead end after buffered
cancellation; obsolete response timeout after newer success; and a pending timeout
farewell that survives newer accepted progress. These tests assert the current bugs,
not fixed behavior. They use mock sockets, synthetic audio, an in-memory repository
and fake time; they do not contact providers or make a call. The runner is:

```powershell
& 'C:\Program Files\nodejs\node.exe' apps/api/node_modules/vitest/vitest.mjs run --config .tools/weekdays-incident-vitest.config.mjs
```

After implementation, convert these into regression assertions for the corrected
behavior and add current-failure, out-of-order continuation, partial-delivery,
semantic correction, refusal and one-action reconciliation coverage. Handset
acceptance should repeat noise during disclosure, an appointment requiring name
spelling/additional facts, an interruption of the commitment, exact confirmation,
and a farewell acknowledgment. Keep one session, correct weekday/date/time and
bounded genuine failures observable. No implementation or runtime restart was
performed as part of this review.

The owner subsequently approved this plan. The follow-up
[v3 implementation and validation record](live-orchestration-recovery-implementation-2026-09-30.md)
records the changes, recovery bounds, rollback artifacts and pending handset acceptance.
The incident evidence and pre-fix diagnostic assertions above remain historical.
