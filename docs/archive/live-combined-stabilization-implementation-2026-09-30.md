# Combined Live stabilization and inline disclosure — 30 September 2026

Branch: `codex/live-unified-runtime`. Implements the owner-approved
[combined plan](live-runtime-stabilization-and-disclosure-plan-2026-09-30.md) and
[disclosure specification](live-inline-assistance-disclosure-plan-2026-09-30.md).
Runtime revision: `live-managed-v4`; new approved disclosure: `assistance-inline-v1`.
Handset acceptance remains pending. No production deployment or automatic call.

## Runtime changes and evidence boundaries

Ordinary Live conversation and factual backend replies need no task-state tool.
Application task recovery waits five seconds for missing native progress and still
uses the independent 45-second waiting bound. Acoustic noise and provisional text
fragments do not restart that waiting clock; a settled answer or meaningful tool
step can. Terminal decisions and authorization checks remain application-owned.

The backend lease spans the physical session, including obsolete responses,
announced work, pending commands, function effects and queued continuations.
Recipient revisions revoke old effects without pretending provider work stopped.
All function results are returned before one continuation can acquire the lease.
An unscoped backend start is logged as an ambiguous association, not a causal ACK.
Its observed terminal event reconciles that lease without claiming command ACK.
Explicit provider rejection permits one retry; ambiguous ACK expiry does not
duplicate running work. Existing bounded stale response deadlines remain.

The full initial disclosure, appointment request/status question and application
failure/farewell fallback use rendered Speech API PCM converted locally to PCMU.
They no longer depend on an exact-text Live directive or speech equivalence check.
The render deadline covers response headers and the response body. Appointment
render/playback has a 30-second bound; closing fallback respects the smaller
remaining closing budget. The ordinary authorized farewell remains native Live.

Protected output ownership persists while rendering, playing and canceling.
Only the current, released Twilio mark confirms playback. Old/cleared marks do
not advance a journal or close the call. Short noise alone does not cancel a
protected appointment unit; substantive transcript or sustained input does.
Cancellation records `not_sent` versus `unacknowledged` from actual release.

**Protocol limitation:** Live WebSocket audio deltas contain neither timestamps
nor utterance IDs. We therefore do not invent an audio timestamp or treat an
instruction ACK as proof the model acted. Output stays muted until an explicitly
acknowledged thinking update gives a timeline fence and a fresh assistant
transcript crosses it. Older transcript/audio is discarded while ownership is
closed. This can omit leading native audio before the fresh transcript arrives;
handset listening must check that transition. The protocol cannot independently
identify a late untimed packet after output has reopened. Application-rendered
audio and any skipped native output make native capture incomplete, so the saved
recording ASR covers what actually played instead of certifying incomplete native
text as a complete transcript.

Appointment requests now require semantic `intent: request | status_check`.
An already reported booking uses status even before the first protected request.
Any uncertain journal recovery conservatively uses status-only for the same
proposal, including `not_sent`; transport delivery does not prove no external
booking exists. This is stricter than the plan's maximum of two never-transmitted
requests: v4 permits one new request, then status-only reconciliation, with at
most three total attempts. The journal remains one action/proposal. Confirmation
still requires the exact played arrangement and a later explicit recipient
confirmation, with `externallyVerified=false`.

An authorized recipient ending/refusal can close an uncertain appointment;
`objective_resolved` still requires confirmation. Terminal authorization can
preempt pending tool work. Ordinary goodbye is not authorization. Actual farewell
playback or the bounded rendered fallback precedes Twilio hangup. Reciprocal
answers do not extend the absolute 30-second authorized-closing ceiling.

The result panel qualifies reported booking using journal state from the same
transcript attempt. Copy/PDF exports now carry that same qualification; foreign
attempt states cannot affect them. Historical transcript, summary and assessment
content are preserved. Telephone completion remains a separate lifecycle fact.

## Disclosure, localization and privacy

`buildInitialDisclosure` produces one short deterministic script in the selected
call locale, using the full submitted first and last name, selected reason,
AI identification, and permission for both recording and automatic transcription.
The full text, reason enum and version are frozen in newly approved snapshots.
The UI shows that text in the call language rather than translating it with the
plan; all seven interface languages warn that either selected reason is spoken
before recipient recording consent. Both name edits affect the draft preview.

All seven call locales and both voices are covered. `none` adds no reason.
No reason-opening playback gate follows recording startup. Live/backend receive
the approved reason and owner with the disclosure already completed. Semantic
consent still requires a complete real disclosure mark and a later answer;
identity/reason wording itself provides no consent evidence.

Legacy approval hashes and snapshots stay intact. The resolver preserves their
approved explanation verbatim in a standalone sentence and reports the reason
enum as unknown. It never infers a reason from text. The UI does not regenerate
an allegedly exact historic script when no frozen version was saved.

Native transcript admission requires a valid trusted recording `startedAt`,
independently of backend admission. Missing, malformed or pre-session boundaries
do not open task admission. Delayed pre-recording fragments are rejected during
conversation and final drain for every assistance reason. Shared Realtime copy
remains unchanged; local Live fallback remains disabled. Diagnostics contain
IDs, revisions, phases and outcomes rather than names, reason enums or speech.

## Verification and local activation

The nine private v3 bug diagnostics were converted into permanent desired-behavior
regressions in `unified-live-call.test.ts`, alongside existing scenario-independent
authorization, noise, stale-command, playback, closing and refusal cases. Added
coverage includes initial status-only checks, output-fence retry, invalid recording
boundaries, stalled TTS body, frozen-name edits and attempt-bound copy/PDF results.

Verification: 312 focused voice/storage tests passed, including a fresh PostgreSQL
fixture; the final unified-call suite passed all 178 cases after terminal preemption
and capture accounting changes. All 230 contracts and 333 web tests passed; API,
contracts and web type checks passed. API and isolated Next production builds
passed. The Next build required a permitted child-process run because Windows
mapped its generated type file; generated config changes were restored.

The broad API run passed 1,515 tests but six integration suites failed setup and
skipped 47 cases because the existing shared test database had an old checksum for
`0065_text_artifacts_and_jobs.sql`. Those six suites then passed all 47 cases in a
new isolated database, which was removed afterwards. No checksum was overwritten,
no application database was reset and no migration source was changed. This is
separate recovery evidence, not a claim that the original broad run was green.

Local API/web restart completed at 22:42 Zurich on 30 September after no-active-call
preflight and verification of 636 candidate source hashes. API PID 4796 and web
parent PID 27708 started hidden; loopback listeners are 4000/4001 and 3000. Runtime
is Live, fallback=false, agent hangup=true, `gpt-live-1`/`gpt-6-luna`, Shprohli and
the existing weekday projection. API liveness/readiness and `/ru` returned 200.
The public tunnel answers; private readiness returned 404. The voice route is POST;
its unsigned empty POST returned 403 before any call effect.
The working database has 90 migrations through 0089. No manual acceptance call
has been made. A final whitespace cleanup preserved production semantics, and
one export test was corrected to use an actual non-null attempt identity.

The original v3 baseline includes all prior
uncommitted work in `.tools/live-combined-baseline-20260930/manifest.json`.
The v4 source candidate is `.tools/live-combined-candidate-20260930/manifest.json`;
active process/settings are `.tools/runtime/stabilization-state.json`. Private
call evidence remains ignored under `.tools`; no call content was added to docs.

For rollback, compare current source with the candidate before restoring this
task's delta from the v3 baseline; preserve later user changes and check for an
active call before restarting. The earlier incident candidate and baseline were
not overwritten. A restart or source hash match is not handset acceptance.

## Manual acceptance

Create/review a call with a selected assistance reason and both filled name fields.
Check the exact preview against the initial spoken full unit; answer naturally,
then continue immediately into the task. Repeat `none`, the other reason, both
voices, and Russian/German call languages with a different interface language.

For an appointment, supply details in stages, interrupt an appointment question,
ask for an unavailable birth date, spontaneously report an already booked exact
arrangement, and exchange reciprocal goodbye. Check weekday/date/time, no invented
personal facts, one action with status-only recovery, no replay of canceled audio,
audible natural conversation after protected playback, and actual assistant hangup.
If it fails, inspect the attempt's runtime tag, contentless ambiguous-command/output
events, provider operation stages, journal delivery/intent and recording audio;
compare reported booking, app confirmation and connection ending separately.
