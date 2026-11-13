# Successful conversation with a partial published assessment

Investigated local attempt `4b8b8b72-ff11-4d95-b20b-1514fef85450`, call
`01e042df-af38-4380-9efd-d9e7f76d3b87`, on 13 November 2026.
The attempt ran from 11:15:56 to 11:17:11 UTC (12:15:56–12:17:11 Zurich).

## Confirmed cause

The post-call model returned `goal.status = achieved`, with all three approved
success criteria also `achieved`. The application then deterministically changed
the overall goal to `partial` because the appointment action journal was empty.
The UI's German `Teilweise erreicht` correctly translates the stored `partial`;
the displayed AI label includes this application override rather than showing
only the original model assessment.

This is established by comparing the retained model-output chunk with the
published artifact and replaying the unchanged composition function locally.
The replay reproduced the entire published payload exactly, without a model
request or database write.

## Conversation and criteria

The approved task was to arrange a test 15-minute meeting about AI projects,
offer November 24 at 14:00 or November 25 at 10:00, ask for another time only if
neither worked, and read back the date/time/purpose for confirmation.

The final original transcript contains:

1. Both original options offered.
2. Recipient: “Давайте лучше двадцать пятого”.
3. Assistant readback: November 25, 2026 at 10:00, 15 minutes, AI projects,
   followed by “Всё верно, можем так договориться?”
4. Recipient: “Да”.
5. Assistant farewell.

The model marked original-option agreement and final readback/confirmation as
achieved. It correctly treated the alternative-time branch as unnecessary because
an original option had been selected. There were no unresolved details.
Its appointment extraction independently reported `disposition=confirmed`.

Transcript capture is `complete`, `sessionFinalized=true`, with no capture issues.
The trace manifest has zero dropped events, `complete=true`, `sessionClosed=true`
and no drain timeout. This is not the previous incomplete-transcript incident.

## Missing internal action

- `live_native_action_revisions` contains zero rows for this attempt.
- The frozen summary context has `nativeAppointmentAction=null`.
- The full trace contains one delegation, initiated after the spoken farewell
  by closing recovery. Its only completed function call is `end_call` with
  `reason=cannot_proceed`; no `prepare_appointment` or
  `record_appointment_result` invocation occurred.
- The actual saved session-start configuration included both appointment tools,
  the instruction to delegate before accepting/requesting a commitment, and the
  instruction to record the answer before announcing success. They were present
  but the appointment workflow was not invoked during the conversation.
- There is no evidence of an attempted appointment write being rejected or lost.
  The complete trace instead shows that the relevant tools were never called.

The tools authorize a proposed commitment and record the recipient's response;
they do not write into an external calendar. Thus the missing item is internal
application evidence, not an absent calendar invitation.

The closing reason corroborates the missing action state but is not the cause of
the assessment downgrade: the summary composition directly checks the frozen
action journal. The closing backend's choice of `cannot_proceed` does not mean
the recipient refused the meeting.

## Code and retained evidence

`apps/api/src/text-processing/text-artifact-service.ts` saves the validated model
output as a chunk before applying `composeCalendarSummary`. In
`apps/api/src/text-processing/summary-calendar.ts`, `composeNativeSummary`
requires agreement between the transcript result, approved schedule and a
matching journal action in state `confirmed`. Without that action, its
`downgrade()` changes an achieved overall goal to partial for a confirmed
conversation. It leaves the independently achieved criteria and narrative intact.
That produces the visible inconsistency: “meeting confirmed” and all criteria
achieved, but an overall partial result.

The native runtime contract is explicit in `apps/api/src/voice/live-task-context.ts`.
The `end_call` guard in `apps/api/src/voice/native-live-v2-call.ts` likewise requires
a confirmed journal action for `objective_resolved`, unless a valid conditional
no-action branch applies.

Evidence identifiers:

- Compilation: `adc0af72-2377-4972-9919-f68dee0ab934`.
- Original transcript revision: `96210d81-81ec-4f33-9041-0974fd06e1a0`.
- Summary artifact: `ebeb5f8f-ae35-489d-9488-b36e7e22f87e`.
- Model-output chunk: `7c7601aa-04a4-4cf3-81c1-ba88f005d45c`, index 0.
- Generator: `summary-v8:grounded-v3:text-processing-v2:openai:gpt-5.6`.
- Private snapshot: `.tools/runtime/roles-local-2026-11-09/assessment-4b8b8b72-ff11-4d95-b20b-1514fef85450.private.json`.
- Offline reproduction: `.tools/replay-latest-call-assessment.mjs`.

## Scope and interpretation

The spoken task was fulfilled according to the original transcript and the model's
assessment. The application's stronger completion contract additionally required
internal action registration, which was skipped. The reason the voice model
skipped the prescribed delegation cannot be recovered from a hidden reasoning
trace; its observable omission and downstream effect are established.

No voice runtime, assessment behavior, stored result or application settings were
changed. No paid API requests or new calls were made. A follow-up fix should make
spoken agreement, internal registration and the displayed result consistent;
silently upgrading a missing journal record would bypass the existing contract.
