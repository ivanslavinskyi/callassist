# Noisy interview: closing regression review, 27 September 2026

> Historical checkpoint, not the current runtime specification. As of 28 September,
> consent uses native `report_consent`, and `end_call` carries a reason without a
> scripted recap. See the [current runtime](live-unified-runtime.md) and
> [real-call review](live-call-review-2026-09-28.md). Results and pending items below
> describe the implementation at this report's date.


Initial investigation followed by the approved implementation below.
Call: `f4f47f5b-af66-4f94-a79e-67fb773937bc`, attempt
`e2f7ddf8-9271-4fe8-879a-e4d4eff9282a`, 17:41–17:46 Europe/Zurich.
Evidence: application events, native transcripts, recording-derived final transcript,
approved snapshot, provider ledger, local logs and current code. The recording was
not independently listened to in this review; neither transcript is ground truth.

## Confirmed sequence (local time)

| Time | Event |
| --- | --- |
| 17:41:34 | One disclosure begins. |
| 17:41:46 | Voice consent accepted; recording starts. One semantic request, 1.543 s. |
| 17:42–17:44 | Nine interview questions receive answers. Repeated acknowledgments remain. |
| 17:44:15 | First end_call rejected because recipient turn is incomplete during side conversation. |
| 17:44:33 | Closing accepted. |
| 17:44:35 | Closing interrupted; recipient says they are listening and asks to continue. |
| 17:44:43 | Interruption routed as answer. |
| 17:44:46 | Closing accepted again; lengthy recap follows, about 25–27 seconds. |
| 17:45:14–15 | Closing interrupted around “everything is correct”. |
| 17:45:23 | This acknowledgment routed as answer, rather than completing closing. |
| 17:45:25 | Closing accepted a third time. Final ASR includes a recap of the confirmation itself. |
| 17:45:33 | Another interruption around “yes”. No subsequent accepted route or played farewell. |
| 17:46:21 | Twilio stream stops, roughly 48 seconds later. No application hangup/playback_complete. |

One GPT-Live-1 voice session; 298 seconds reported usage. No Realtime voice switch.
Nineteen successful Luna delegations. The final recording contains 275 seconds.
One speech classification was cancelled at the interruption boundary and logged as
unavailable; this did not end the session. There is no recorded OpenAI transport
failure explaining the final silence. Stream stop alone cannot identify who hung up.

## Root causes in application code

1. `PcmuActivity` detects energy, not whether a person is addressing the agent.
   100 ms above threshold triggers activity. `inputAudio` immediately cancels closing;
   native recipient transcript deltas can also cancel it. A short acknowledgment,
   nearby speech or noise can enter the same interrupted-closing path as a correction.
2. `#notifyInterruptedClosing` sets `#interruptedClosing=true`. The transport drops
   assistant audio and transcripts until a valid `route_interrupted_closing` decision.
   The last interruption never receives that accepted decision. A successful backend
   response clears its deadline even if it did not resolve this required application
   transition. The muted state has no dedicated recovery deadline. This explains the
   silent dead end without a provider outage.
3. The route policy offers answer/clarify/wait/end but fails to explicitly represent
   a closing acknowledgment (“correct”, contextual “yes”) or resuming after unrelated
   speech. The instruction describes interruptions as a new question/correction.
   Returning to answer requires a new end_call and discards previous recap progress.
4. Every objective_resolved close requires a nonempty recap. This includes repeated
   closing after an already played recap. The two-string / 400-character constraint
   does not enforce two sentences or select only essential results; it permits an
   exhaustive list of interview answers. It also permits a useless recap of the
   acknowledgment itself. The fixed introduction adds further repetition.
5. Shared backend instructions allow a spoken summary before end_call while the
   unified lifecycle owns another recap. This creates competing responsibilities.
   Explicit background/side-conversation guidance is absent from the current Live
   prompt; every detected recipient fragment is supplied as conversation evidence.

## Evidence limits and secondary findings

- The reported exact question “do you agree with the above?” is absent from both
  saved transcripts. Final ASR does contain “you confirmed that the stated answers
  are correct”. Interrupted controlled speech is not always persisted in native
  history, so absence does not disprove that the question was audible.
- Side conversation with children is visible in native text around the first closing
  attempt. Final ASR also adds “pizza” after “meat”, absent from native text. The
  speaker/intended addressee and any genuine correction need the audio; do not silently
  choose one transcript as authoritative or add these fragments as confirmed answers.
- Three post-call summary requests failed schema validation (`TEXT_RESPONSE_INVALID`)
  after the conversation ended. This is a separate post-call defect, not the live stall.
- Existing interrupted-closing tests inject valid route tools. They miss a completed
  backend response without the required tool, followed by an indefinitely muted session.

## Proposed focused correction

1. One short substantive recap, normally 20–30 words / about 8–12 seconds: the essential
   outcome, not all answers. For an interview, one or two meaningful themes suffice.
   For appointments preserve exact agreed date/time and unresolved conditions. No
   generic request to approve the recap; necessary transaction confirmation remains
   a separate prerequisite. Skip recap when already delivered and unchanged.
2. Persist closing progress across interruptions: recap pending/delivered, goodbye
   pending/delivered. Acknowledgments continue to goodbye; actual corrections update
   only affected information. Never summarize an acknowledgment or restart the interview.
3. Separate yielding audio from cancelling task/closing intent. Classify an interruption
   in context via the existing reasoning backend: acknowledgment/resume, real correction
   or question, explicit wait, irrelevant speech/noise, or genuinely unclear speech.
   No additional always-on ASR or second voice model. Do not infer recipient identity
   or intent solely from energy, language or a token such as “yes”.
4. The required interruption decision must resolve explicitly. A backend completion
   without it must not satisfy the application watchdog. Bound recovery (one controlled
   decision retry, then an audible clarification or graceful failure path); never wait
   indefinitely while discarding all voice output. Resume through a single owner of
   backend requests to avoid reintroducing competing Responses runs.
5. Add concise Live/backend instructions for side conversation, thinking pauses and
   background noise. Preserve uncertainty, avoid incorporating unrelated remarks into
   task answers, and ask a focused clarification only when a material answer is ambiguous.
   This improves behavior but is not a guarantee of speaker separation on one channel.
6. Regression scenarios: recap + “correct” / “yes” / thanks; actual correction; question
   after thanks; speech to a child then “continue”; background noise without text; stale
   or missing route tool; explicit wait then resume; interruption during goodbye; no
   duplicate recap, external action or premature hangup. Use a synthetic noisy audio
   fixture plus manual phone acceptance, not only tools injected by unit tests.

Official guidance supports separating speech interruptions from task changes and not
treating nearby conversation as a new request:
- https://developers.openai.com/api/docs/guides/live-prompting
- https://developers.openai.com/api/docs/guides/live-delegation

## Implemented follow-up

- Live-specific routing distinguishes acknowledgment/resume, unrelated speech/continue,
  correction/answer, clarify, explicit wait and stop. The Realtime tool schema remains
  unchanged. Native audio still yields immediately; semantic routing determines the
  next task state. Nearby speech is not automatically a task answer.
- Recaps normally contain 20–30 words, with hard limits of 35 words and 260 characters.
  No fixed preamble, exhaustive interview list, acknowledgment recap or general approval
  question. Appointment confirmation and authorization remain mandatory beforehand.
- Played recap progress survives interruption. An acknowledgment proceeds to goodbye;
  unrelated noise resumes the pending stage. Actual corrections can replace the recap.
  Hangup still requires the current Twilio playback mark; cleared/stale marks cannot end
  the call. No extra transcription or voice model is introduced.
- A separate interruption deadline survives empty backend completions. After ten seconds
  of a settled turn it requests one routing recovery through the existing single request
  owner. After another ten seconds without a decision, it unmutes Live and requests one
  brief clarification, without inferring consent, success or permission to hang up.
  An explicit wait has a thirty-second quiet period; new speech resumes routing. The
  ordinary backend transport deadline and call duration limit remain in force.
- Tests cover played/pending recap, acknowledgment, PCMU energy without transcript,
  missing route, wait/resume, correction, stale route and premature end_call. Synthetic
  provider probes test seven summary languages and multilingual closing decisions.
  These are not a substitute for a noisy real phone call or speaker diarization.

## Automatic assessment and internal storage

The last call's automatic summary ran three times, each failing with the former generic
`TEXT_RESPONSE_INVALID`. Manual regeneration succeeded. Rejected response bodies were
not retained, so their exact validation failure cannot be reconstructed retrospectively.
The provider schema omitted local limits, including the four-point overview limit;
these are now sent explicitly, with bounded lengths/counts and source ID enums for
ordinary transcripts. Large transcripts retain exact local citation validation without
exceeding OpenAI's enum limits. Provider accounting now distinguishes schema, assessment,
reference and grounding failures with content-free codes. Evidence checks remain strict.

The approved plan incorrectly included “Answers are saved in SHPROHLI” as a success
criterion. New compiler instructions prohibit application operations as conversational
success criteria. For existing plans, the summary service supplies an application fact
only after reading a committed transcript revision: those supplied segments are stored.
This does not prove external email delivery, booking or any other external action.
Routine storage is omitted from overview/unresolved; no recipient confirmation is sought.
The new summary generator revision prevents reuse of old generated chunks. Existing
canonical assessments and settled credits are not silently rewritten or recharged.

Automatic enqueue on final-transcript completion and durable retry are tested without
a user request. No database migration or production change is needed. The post-call
recording/transcription pipeline remains enabled.

Provider probe: `node --use-system-ca --import tsx scripts/probe-live-closing-summary.mts`
from `apps/api` (paid, opt-in, synthetic data only). Official schema constraints:
https://developers.openai.com/api/docs/guides/structured-outputs

Validation after implementation: API 1,373 tests, web 300, contracts 136 passed;
typecheck/lint/build 9 tasks passed; focused closing/summary regression 162 tests passed.
Real provider probes passed seven summary languages, eleven closing routes and the
negative external-delivery case. Local API restarted with Live and fallback=false;
readiness and the Russian UI returned HTTP 200. Production was not changed. No new
real phone call has yet validated this follow-up; the saved report for the earlier
call retains its canonical assessment.
