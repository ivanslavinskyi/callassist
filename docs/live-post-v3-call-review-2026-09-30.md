# Live appointment call review after v3 recovery

Current follow-up: [v4 implementation and acceptance record](live-combined-stabilization-implementation-2026-09-30.md) implements the combined runtime/disclosure changes. Historical evidence below describes its original version; v4 handset acceptance remains pending.


Reviewed 30 September 2026 on `codex/live-unified-runtime`. The call started at
20:51:30 Zurich and ended at 20:55:30. The owner confirms that Elena hung up after
a long pause. This handset run does not pass runtime stabilization acceptance:
v3 prevented obsolete timeouts from terminating newer work, but the action stayed
uncertain, protected speech recovery stalled, and no application hangup occurred.
The [combined stabilization and disclosure plan](live-runtime-stabilization-and-disclosure-plan-2026-09-30.md)
is the next implementation entry point. No production source, runtime process,
database record or historical assessment was changed by this review.

## Evidence and active version

Read-only local database inspection selected the latest Twilio attempt,
`f960b5b5-66f0-477c-9a65-73a61d102bb2`, for brief
`ac0e6c28-9217-4e58-a049-a2333b0f9274`. Evidence includes 58 durable events,
90 provider operations, the immutable execution snapshot, encrypted action journal,
saved native fragments, the final recording-ASR transcript, assessment/summary,
recording metadata and API PID 24724 logs. All 24 production-source hashes match
the activated `.tools/live-incident-candidate-20260930/manifest.json`.

There was one `gpt-live-1` session with voice `cedar`, brand Shprohli and readiness
tag `live-managed-v3`. The two initial Speech API operations render the existing
disclosure and permission question; they are not a second conversation runtime.
Historical `realtime.*` telemetry names do not establish a Realtime connection.
The approved runtime contains no assistance reason; its `assistanceDisclosure` is
empty. Consequently the two reason-opening defects in the
[separate audit](live-assistance-reason-audit-2026-09-30.md) did not cause this call.
They remain open work for the combined release.

The two-channel recording is available for 215 seconds. The final transcript uses
`recording_asr` because protected output cancellation invalidated native completeness.
Audio was not independently listened to; no complete provider WebSocket capture is
retained. ASR boundaries and native timestamps do not establish exact handset
playback or every second of acoustic silence. Some final-ASR fragments overlap;
overlapping repeated text is not sufficient evidence of repeated spoken sentences.

Private evidence remains under ignored `.tools` paths:

- `latest-post-v3-call-20260930.private.json`
- `review-latest-post-v3-call.mts`, `inspect-latest-post-v3-call.mjs`
- `post-v3-incident-cases.txt`, `build-post-v3-incident.mjs`
- `post-v3-incident.test.ts`, `post-v3-incident-vitest.config.mjs`
- `post-v3-incident-diagnostics.log`

## Timeline

Times are Zurich on 30 September; subtract two hours for UTC.

| Time | Observed evidence | Interpretation |
| --- | --- | --- |
| 20:51:38.312 | One `disclosure.started` | No mandatory-disclaimer replay is recorded in this run. |
| 20:51:55.756 / 56.115 | Consent granted / recording started | Recorded consent precedes recording startup. |
| 20:52:37–38 | Thursday at two in the afternoon | Canonical proposal becomes Thursday, 1 October 2026, 14:00, Europe/Zurich, within authorization. |
| 20:53:14.987 | First action enters `sending`, request attempt 1 | The application prepares a buffered canonical booking request. |
| 20:53:23.212–23 | Recipient asks for name; controlled output canceled, `released=false` | Journal becomes `uncertain`, `not_sent`; no matching delivered mark exists. |
| 20:53:21–28 | Native output and recording-ASR contain a date/time/name recap | Generated speech continues around cancellation. Neither transcript establishes delivery of the complete canonical request. |
| 20:53:34 onward | Recipient asks for birth date | Assistant correctly states it has no approved birth date and asks whether booking can proceed without it. |
| 20:54:07.328 | First obsolete backend timeout | v3 settles it as stale and does not initiate a failure farewell. |
| 20:54:29–33 | Recipient reports the appointment is already booked | This is a reported booking, not an application-confirmed action or external calendar verification. |
| 20:54:45 | Assistant says it will clarify | No subsequent usable appointment answer reaches the handset transcript before the reciprocal farewell. |
| 20:54:50.560 | Second request enters `sending`, attempt 2 | Delivery-only recovery chooses another booking request despite the already-booked report. |
| 20:55:03–05 | Recipient says hello; second controlled output canceled, `released=false` | Action returns to `uncertain`, request attempt 2, `not_sent`. |
| 20:55:05.396 | Second obsolete timeout | Again correctly settled without a global failure farewell. |
| 20:55:20–23 | Recipient says goodbye; assistant reciprocates | Spoken farewell has no accepted `end_call` or `conversation.hangup` evidence. |
| 20:55:30.197 / 30.843 | `stream_stopped` / Twilio `completed` | Owner confirms Elena disconnected; application did not perform the hangup. |

The recording-ASR timeline has about 35.3 seconds between the end of the assistant's
last clarification filler and the start of its farewell, with the recipient's
hello and goodbye inside that interval. This supports the observed long pause but
is not an independently measured continuous acoustic-silence interval.

## What improved and what still failed

The two obsolete 30-second response timeouts no longer end newer successful work.
There is one disclaimer start; the selected date/weekday and voice/session are
consistent. The action journal preserves one immutable proposal rather than
creating a second action. The assistant did not invent the requested birth date.
These are useful v3 improvements, not proof of complete runtime stability.

### Application requests can overlap outstanding native work

`OpenAILiveConversation.requestTaskDecision` suppresses existing runs/announcements
only in the current input epoch. Every nonempty input delta advances that epoch.
An older backend response can therefore remain physically running while the
application starts a fresh `response.create`. A stale response is fenced from
effects, but its physical provider work is not canceled by our epoch counter.
The synthetic diagnostic reproduces this ordering without a provider connection.

The real call has 38 backend responses: 34 successful, two timed out and two
interrupted at stream shutdown. Successful responses have a median of 1,551 ms
and a maximum of 4,290 ms. Three command acknowledgement timeouts and four
`invalid_request_error` events coexist with healthy work. Two final responses are
still outstanding when Elena disconnects. This does not prove a provider outage.
The precise cause of the four provider errors is unknown because no safe detailed
provider error message or complete wire trace was retained.

The application's per-answer recovery, mandatory `report_task_state` decisions,
tool continuations and native delegation all share the managed backend. The current
epoch-based guard permits additional commands across a still-running old response.
It also acknowledges an unscoped request from a matching-revision native start
without causal proof. These are orchestration risks; it would overstate the
evidence to attribute every real error or pause to one specific command collision.

OpenAI Docs confirms that Live speech and delegated work proceed independently,
and appending instructions does not cancel existing backend work. Function results
must be returned before a continuation request. The wire payload provides no
app-selected delegation ID on `response.create`.
[Delegation and tools](https://developers.openai.com/api/docs/guides/live-delegation).

### Canceled protected speech loses output ownership

`#cancelCritical` removes the controlled speech gate and leaves phase
`conversation`. Late Live output then takes the ordinary `audio()` branch and is
forwarded without that canceled gate. A diagnostic buffers part of a canonical
request, cancels it on a recipient question, then supplies its late output: Twilio
receives audio while the journal still says `not_sent`. This is a reproduced
application defect, independent of whether a real call heard the whole request.

The real call's two cancellations have `released=false`, and the recording-ASR
contains a date/time recap around the first cancellation. That is compatible with
the reproduced hole; the absent raw output ownership trace prevents identifying
every real chunk as canceled canonical audio rather than a fresh native recap.
`not_sent` describes the protected buffer only. It does not prove that ordinary
Live speech or the recipient could not already have caused an external booking.

The current gate asks Live to speak an exact application text, then waits for
whole generated text/semantic equivalence before releasing the buffered audio.
During both attempts the recipient speaks before release. Fragmented or delayed
output, verification and recipient interruptions make this an unnecessary second
speech-control lifecycle on top of Live's natural conversation.

Input/output transcript deltas are fragments, not complete-turn events, and an
instruction acknowledgement is not proof that Live acted on it or completed an
utterance. [Live API reference](https://developers.openai.com/api/reference/typescript/resources/live).

### Recovery does not distinguish a reported existing booking

The first never-transmitted request may be retried once. The current selection
uses only `delivery.kind/status/attempt`, so attempt 2 remains a booking request
even when the latest recipient answer reports that the exact arrangement already
exists. A diagnostic reproduces that selection. The real run exhibits both facts.
No second booking is proved; nevertheless, transport non-delivery is insufficient
authority to ask for another booking after a recipient report of completion.
Recovery needs a semantically chosen, application-validated status-only operation
for the same exact proposal, without weakening the one-action or later-confirmation
checks. Merely accepting the existing report as tool confirmation would bypass
the playback/follow-up evidence contract.

### Spoken farewell and result assessment are separate from completion

There are no recorded `confirm_appointment`, `end_call` or `conversation.hangup`
events. An uncertain appointment correctly blocks `objective_resolved`; it does
not block `recipient_requested_end` or an honest `cannot_proceed` close. A diagnostic
shows that ordinary spoken goodbye does not disconnect, and that recipient-requested
closing is already allowed while the action remains uncertain. The real call never
reaches that accepted terminal decision.

The assessment reports `goal=achieved` based on the recipient's explicit booking
report; the summary marks findings as `reported`. That evidence is real, but the
application action remains `uncertain` and the provider status `completed` only
means the telephone connection ended. v3 exposes action uncertainty separately;
the combined plan must make these distinctions consistent in result headings,
summary and export without deleting the recipient's statement or retroactively
changing historical evidence.

## Reproduction status

Four private diagnostics passed on unchanged v3 production sources. They assert
the observed behavior, not the desired stabilized behavior. They cover overlapping
fresh work, late canceled output, the delivery-only retry after a booking report,
and spoken farewell without hangup plus the already-permitted recipient-end path.
They use fake time/sockets, synthetic PCMU and an in-memory repository. No actual
provider request, outbound call or application database mutation occurs.

```powershell
& 'C:\Program Files\nodejs\node.exe' apps/api/node_modules/vitest/vitest.mjs run --config .tools/post-v3-incident-vitest.config.mjs
```

The combined release must turn these into desired-behavior regressions alongside
the five assistance-admission diagnostics. This review does not activate a fix.
