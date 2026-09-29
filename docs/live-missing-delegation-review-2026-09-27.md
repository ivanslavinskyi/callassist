# Missing delegation and formal-address regression

> Historical checkpoint, not the current runtime specification. As of 28 September,
> consent uses native `report_consent`, and `end_call` carries a reason without a
> scripted recap. See the [current runtime](live-unified-runtime.md) and
> [real-call review](live-call-review-2026-09-28.md). Results and pending items below
> describe the implementation at this report's date.


Review only. No runtime changes made during this investigation.

Call `691840dc-73c4-4b0b-9c2d-5bf2682214a8`, attempt
`89e657be-232b-4e09-a607-6cf0e7405fae`, 27 September 2026,
18:28:36–18:30:36 Europe/Zurich. Evidence: approved execution snapshot,
native transcript, recording-derived transcript, call events, provider ledger,
current API logs and implementation. Audio was not independently listened to;
transcripts do not establish the exact moment at which sound stopped.

## Observed behavior

- Approved locale de-CH, addressingStyle formal, tone neutral. The approved question
  uses “Sie”. No approved switch to informal address exists.
- Live says “Was würdest du dir denn gerne zum Abendessen wünschen?” and later
  “Alles klar, du möchtest also Pizza?”. Both native and recording-derived transcripts
  show this switch from the opening's formal address to informal address.
- Native recipient answer “Ich wünsche Pizza” arrives around 18:29:44–47;
  Live repeats the answer as a question. Recipient “Ja” arrives around 18:29:53–54.
  No more assistant utterances are recorded before stream stop at 18:30:35.784.
- Zero recorded live_delegation operations, zero tool_result/end_call/closing events.
  Thus this is not the previous interrupted-closing dead end: closing never began.
- One successful GPT-Live-1 session (114 usage seconds), no observed Live transport
  failure or backend timeout. Stream stop alone does not establish who hung up.
  No Realtime voice runtime was involved. Separate Luna requests were consent and
  controlled-speech checks, not conversation delegation.
- Automatic summary succeeded on its first request (5.965 seconds), and assessment
  became ready/confirmed/achieved. The new plan contains only the substantive dinner
  criterion, not internal saving. Billing settled once; this does not imply the
  live interaction or closing was satisfactory.

## Implementation findings

`provideRecipientEvidence` queues a Responses input item but calls `#requestBackend`
without setting continuationPending. Ordinary turns therefore depend entirely on
Live autonomously delegating. The regular backend deadline starts only when a response
is requested/observed. The newer closing-decision deadline starts only after interrupted
closing. Neither covers a completed task answer with no delegation at all.

The backend receives the approved plan and formal addressing. `buildLiveInstructions`
does not pass addressingStyle or tone to the voice frontend. The opening's polite
wording is an example, not an explicit persistent speech-style instruction.

`configureBackend` sends session.update, but the event handler does not verify its
correlated session.updated response before treating the task backend as enabled.
There is no evidence that this update failed in this call; the missing acknowledgement
check is an additional diagnostic/readiness gap, not a proven provider error.

The existing “does not disconnect a listening conversation merely because a recipient
answer did not request a backend” test expects zero response.create commands after
sixteen seconds. It guards against an abrupt hangup but does not assert useful progress.
The synthetic native probe explicitly sends response.create and injects typed turns.
It validates backend behavior, not audio-triggered delegation or end-to-end task progress.

## Focused correction proposed

1. Give the voice frontend the approved locale, addressing style and tone explicitly,
   with the corresponding formal/informal form. Apply during startup and conversation;
   a first name or meal topic must not imply informal address. The backend uses the
   same immutable source. No form change required from the user.
2. Track completed recipient turns and whether backend processing covers their current
   revision. Track session.delegation.created as well as nested response.created.
   If native delegation does not begin within a bounded short interval, schedule one
   backend request through the existing single request owner. Do not dispatch on every
   transcript fragment or replay a tool/action. New speech invalidates stale decisions;
   unfinished speech, explicit wait and actual new questions remain distinct.
3. Correlate session.updated with the outgoing configuration command before considering
   conversation tools ready. Record only configuration/progress metadata, never private
   prompts or pre-consent transcript content.
4. Keep the concise recap and Twilio-mark hangup path. A settled answer must lead to
   the next question, a clarification or end_call; waiting indefinitely for a voluntary
   goodbye is not an acceptable terminal state. Recovery must remain bounded and avoid
   simultaneous native/application backend runs, including the event-arrival race.
5. Add regression tests for no native delegation on readiness/task answer/final yes,
   native delegation arriving at the recovery boundary, stale turns, formal/informal
   voice instructions across supported locales, and configuration acknowledgement.
   Add a real audio-driven Live probe using a synthetic German conversation through
   the production bridge, without test-injected backend/tool events. Then manually
   validate the short German call through Twilio.

## Additional observations

AMD took 6.042 seconds. First disclosure audio began 7.849 seconds after the provider
connection event. Two disclosure.started events and two consent classification requests
exist. The first pre-consent answer was intentionally not retained, so the review cannot
establish whether the clarification was justified. Do not invent that answer or use
post-consent recording to claim it was audible before consent.

Official documentation distinguishes backend configuration from the decision to
delegate, permits explicit response.create, and documents session.updated correlation:
- https://developers.openai.com/api/docs/guides/live-delegation
- https://developers.openai.com/api/docs/guides/live-conversations
