# Live runtime stabilization and initial disclosure implementation plan

Date: 30 September 2026. Branch: `codex/live-unified-runtime`.
Status: implemented on the branch as live-managed-v4; see the [v4 implementation and acceptance record](live-combined-stabilization-implementation-2026-09-30.md) for verification and local activation. Handset acceptance remains pending. The latest
[post-v3 handset review](live-post-v3-call-review-2026-09-30.md) failed stabilization
acceptance: Elena hung up after a long pause, the action stayed uncertain and the
application never accepted a terminal decision.

This is the next implementation entry point. It combines the remaining runtime
repair with the owner-approved
[short inline assistance disclosure specification](live-inline-assistance-disclosure-plan-2026-09-30.md).
That specification remains authoritative for the seven call/UI locales, full-name
sourcing, frozen script, legacy snapshot compatibility and recording-consent gates.
It no longer implies preserving the defective exact-Live-speech commitment path.
The implemented v3 recovery and incident records remain historical evidence.

## Intended division of responsibility

Live owns ordinary conversation: natural replies, clarifications, listening and
contextual delegation. The application owns consent/recording admission, permitted
external actions, durable state, required playback evidence, terminal decisions and
bounded recovery. Commands should convey an actual state change, tool result or
necessary recovery; recipient fragments alone should not trigger another competing
decision flow or repeated instructions to speak immediately.

Keep one Live session, the approved voice, Shprohli identity, deterministic weekday
labels and managed Responses delegation. This evidence does not justify changing
models, enabling Realtime fallback, migrating to client delegation or adding a
scenario-specific script. The changes apply to all policy-permitted task classes.

## 1. Reduce command traffic and serialize application recovery

In `live-conversation.ts` and `live-managed-tools.ts`, replace the automatic
per-settled-answer task poke with a bounded recovery watchdog. Native delegation
remains the normal path. Stop requiring a bookkeeping `report_task_state` tool on
every fresh delegation; retain it for a material wait/progress/closing transition
where the application actually needs state. Ordinary acknowledgements and spoken
answers do not require a second application reasoning request.

Maintain one application-owned backend operation/continuation lease per session,
with actual command, delegation, response, pending function results and terminal
state. Coalesce queued recovery into the newest complete recipient answer. A new
semantic revision invalidates old effects but does not free the physical lease
while the old response or continuation is still outstanding. Also account for
observed native work, including stale running work, before adding an application
request. The app cannot prevent every autonomous native overlap; it can avoid
adding another request and reject stale effects.

Return every required tool result before one continuation; flush multiple known
pending results together. A rejected/stale result still requires correct protocol
completion, not another independent fresh request. An unscoped native response
start is not causal proof that our pending request succeeded. Preserve explicit
correlation when available; otherwise record ambiguous association and keep recovery
bounded instead of inventing a wire delegation parameter.

An appointment tool waiting for the recipient must yield on the next complete
answer: resolve its pending result, publish the current action state and continue
once. A request for a name, a correction or a refusal cannot remain blocked behind
a 45-second tool wait. Preserve the distinction between an observed reply and an
accepted appointment confirmation.

Track semantic progress separately from acoustic activity, token fragments, filler
speech and ledger settlement. Complete recipient answers and accepted useful task
transitions drive recovery; ordinary speech keeps playback responsive but does not
reset the progress budget. Reuse existing configurable 15-second command/start,
30-second response and 45-second task-wait bounds as upper limits. Do not restart
the total recovery budget on newer fragments or obsolete timeouts. A genuinely
unavailable backend yields an honest bounded failure path; it cannot keep the call
alive by repeatedly saying it is checking.

No parser may infer appointment completion or end intent from a language-specific
word list. Use native semantic delegation; watchdog fallback interprets the latest
complete answer at most once within its current recovery budget.

## 2. Render application-owned protected speech outside the native dialogue

Reuse the existing `renderSpeech`/PCMU mechanism and approved voice for the small
set of application-owned mandatory utterances: the full initial disclaimer,
canonical appointment request/status question and terminal fallback copy. Ordinary
dialogue and a normal authorized farewell remain native Live speech.

Remove the requirement that Live generate an exact buffered booking/status script
after `session.instructions.append`. Produce its canonical text only from validated
authority/proposal data, render it within a bounded request/body-read deadline,
and cache per attempt/action/text/voice/locale. This introduces synthesis only for
protected action text, not a new conversation runtime. Measure the added latency
and voice continuity in handset acceptance; do not promise identical acoustics.

Give each protected playback an owner: attempt, action/version where applicable,
generation, preparation state, released bytes and uncleared matching Twilio mark.
Wait for a quiet recipient boundary before release. Cancellation during synthesis
or before release discards the buffer; late synthesis completion cannot send it.
Cancellation after release records possible delivery. Keep journal-before-playback,
exact authority checks, one action and later explicit recipient confirmation.

Use a transport-level protected-output slot to suppress competing native output
during preparation/playback and to discard stale output at cancellation/drain.
Pass and validate output timing evidence where available; do not claim that
instruction acknowledgements or a guessed quiet interval uniquely identify native
utterances. Never restore ordinary forwarding simply by deleting the canceled
gate. Reopen it only through an explicit current dialogue transition with a tested
output boundary; when ownership is ambiguous, retain uncertainty and use bounded
recovery rather than forwarding an old protected commitment. The old exact native
commitment directive is removed, so it cannot keep emitting protected tails after
cancellation. Mirror the actual application-owned text and played/cleared outcome
as context once, not a command to repeat it.

Diagnostic acceptance must exercise late output during/after cancellation, render
completion after a newer turn, clear followed by old mark, concurrent native speech
and failure to establish a safe output boundary. Preserve native-capture incomplete
status when heard/generation evidence is incomplete; recording ASR remains fallback.

## 3. Reconcile a reported existing action and close honestly

Keep one immutable appointment proposal and journal identity. Distinguish a fresh
booking request from a status-only reconciliation in the structured tool contract.
The backend chooses the intent semantically from the complete recipient answer;
the application validates the exact proposal, current revision and evidence.
Do not implement a text matcher for "already booked".

Retain the existing at-most-two never-transmitted request attempts and at-most-three
total request/status attempts. A recipient report that the arrangement already
exists, or any possible protected playback, requires status-only reconciliation
even if the protected buffer says `not_sent`. That field describes transport
delivery, not the absence of an external action. Without sufficient evidence for a
safe fresh request, use status-only recovery. Never convert an ambiguous reply into
a second booking, widen authorization or switch proposals under uncertainty.

Finish required booking details before asking for the final commitment. Unknown
facts remain unknown; ask whether the arrangement can proceed without them. Once
the recipient reports completion, do not resume a fresh commitment or repeat
already-answered administrative questions. Play the status question for the same
arrangement, then require a later exact recipient confirmation before marking
`confirmed`. Preserve `externallyVerified=false`; no calendar integration is added.

A recipient request to end or refusal permits `end_call` while the action remains
uncertain. `objective_resolved` still requires the existing application confirmation
contract. Prioritize a terminal tool decision over appointment retry preparation;
cancel/settle outstanding protected work without mislabeling its delivery. Ordinary
spoken goodbye alone does not authorize a hangup or prove task success. Require a
terminal decision, then actual farewell playback or the existing bounded fallback,
and issue Twilio hangup. Preserve the absolute 30-second authorized-closing ceiling;
reciprocal acknowledgements do not restart it. Watchdog recovery must obtain a
bounded terminal decision when native delegation fails to supply one.

Keep three result facts distinct: what the recipient reported, what the application
action journal confirmed, and who ended the telephone connection. Match them to the
same attempt in the result panel, headline, summary and text export. A reported
booking may remain in the transcript and summary, but `uncertain` must stay visible
as unresolved application confirmation. Provider `completed` cannot imply task
completion. Do not rewrite historical assessments or old approved evidence.

## 4. Include the selected reason in one short initial disclaimer

Implement the full linked disclosure specification in the same release:

- Full represented-person identity uses both filled call-form fields through
  `formatPersonName(firstName, lastName)`, server normalization and the approved
  snapshot. Preserve the submitted spelling; do not reload profile data, infer
  a surname, shorten to first name or let the plan LLM rewrite it.
- One deterministic helper produces identification, selected reason and the
  recording/automatic-transcription permission question in the call locale.
  Reasons stay `none`, `speech_impairment`, `language_barrier`; no diagnosis or
  new personal detail is inferred. Short Russian examples in the specification
  include both name and surname.
- All seven UI locales warn that a selected reason is disclosed before recipient
  recording consent. The exact script preview follows the call locale, including
  cross-locale combinations; approved-attempt details display frozen script text.
- Render the entire initial script as one required playback unit and one mark.
  Remove the redundant automatic initial permission question and the post-consent
  reason-opening gate. Keep semantic consent, actual complete playback, recording
  startup and independent native transcript admission as separate checked gates.
- Fix the late pre-recording timestamp admission independently of task/backend
  readiness, including startup and final drain. Supply Live/backend the same
  approved reason/owner, marked disclosed only after valid full playback.
- Keep legacy snapshots and approved hashes readable, bounded disclosure replay,
  refusal/AMD paths and language-switch policy. Do not modify shared Realtime
  copy without its adapter migration; active fallback remains false.

The implemented release candidate is `live-managed-v4`, initial script revision
`assistance-inline-v1`. Both reason-opening audit defects are now desired-behavior regressions. The reviewed handset call used `none`; a new v4 handset test remains required.

## Implementation order and acceptance

1. Save the current v3 source/runtime manifest and private incident evidence. Add
   the nine observed-behavior diagnostics as desired-behavior regressions before
   changing the corresponding paths; record which were previously asserting bugs.
2. Add backend operation ownership/watchdog and reduce redundant per-turn commands.
   Preserve tool-result continuation requirements and stale-effect checks.
3. Add the shared disclosure helper and protected rendered-playback ownership.
   Update snapshot/legacy resolver, independent transcript admission, all UI
   previews/locales and Live/backend approved assistance context together.
4. Add explicit status-only appointment intent, one-action recovery, terminal
   priority and consistent reported/confirmed/ended result projection.
5. Run focused socket/fake-time tests, relevant storage integration, contracts,
   API/web types and builds. Save candidate hashes and an implementation record.
   Restart locally only after no-active-call preflight and passing readiness checks.
   Keep Live, fallback=false, agent hangup=true; make no automatic outbound call.
6. Handset acceptance: a normal information call and a difficult appointment call
   with required personal details, unknown birth date, interrupted request,
   spontaneous "already booked" report, short noise, long recipient turn and
   reciprocal goodbye. Verify weekday/date/time, one action, status-only recovery,
   absence of prolonged command-induced pauses and actual application hangup.
   Repeat selected reasons and `none`, both voices, Russian and German calls.

Automated scope also covers all 42 call-locale/reason/voice scripts, seven UI locales,
cross-locale preview, both name-field edits, old snapshot/export compatibility,
early consent before full question, old/cleared marks, recording-start failure,
out-of-order announcements/responses, stale running work plus a newer complete
answer, pending tool results, canceled late output, reported booking despite
`not_sent`, refusal/recipient-end with an uncertain action, current backend failure
and total budget exhaustion. Filler or new fragments must not indefinitely postpone
resolution. Add tests for ordinary natural conversation without per-turn app pokes.

Use content-free technical traces for operation ownership, command reason,
response/delegation IDs, ambiguous correlation, suppressed commands, render/playback
generation, released/cleared/played state, consent/transcript admission and terminal
reason. Do not log names, reason text/enum, diagnoses or pre-consent speech.
Compare command count and protected-preparation/playback gaps with this incident;
lower command count alone does not prove success. Preserve rollback manifests and
do not claim handset readiness until both runtime and disclosure acceptance pass.
