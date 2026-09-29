# Native managed Live: implementation and acceptance

> Historical checkpoint, not the current runtime specification. As of 28 September,
> consent uses native `report_consent`, and `end_call` carries a reason without a
> scripted recap. See the [current runtime](live-unified-runtime.md) and
> [real-call review](live-call-review-2026-09-28.md). Results and pending items below
> describe the implementation at this report's date.


Date: 2026-09-27. Branch: `codex/live-unified-runtime`.
Status: implemented; automated checks passed, manual Twilio acceptance pending. Production unchanged.
This report supersedes the client-controller architecture in the earlier dated reports.

## Architecture

`OpenAILiveConversation` starts the official Live session with `delegation.type=responses`,
GPT-6 Luna and `parallel_tool_calls=false`. Before consent, the backend has no tools and
no task context. After recording and the opening are complete, the approved execution
plan enables the managed backend. Original input and translated review text are excluded.
Live receives the approved objective, questions and facts and conducts ordinary dialogue.
The backend receives the complete execution projection, including conditions and authorization.

The local `LiveTaskController`, standalone task backend, per-turn response requests and
classification of every ordinary appointment utterance have been removed. Input audio
continues during output; PCMU remains unchanged. Native Live supplies provisional transcripts.
Existing post-call transcription, assessment, compiler/review, AMD and UI fixes are retained.

Only effects cross the application boundary:

- `request_appointment`: validate exact approved scope, verify the proposed commitment,
  journal before buffered playback, then mark delivered or uncertain. Never replay automatically.
- `confirm_appointment`: require the same delivered proposal and subsequent observed recipient
  evidence. Save a recipient report; this is not independently verified calendar state.
- `end_call`: validate a short recap and the current state. Play the recap and farewell,
  and hang up only after the matching Twilio mark. Recipient input cancels closing.

The represented customer and called recipient are explicitly different roles. Booking content
asks the called provider to make and confirm the authorized appointment; it does not ask the
customer to authorize an already approved scope again. Semantic checks receive both the exact
proposal and its authorization, including the service and financial constraints.

Native `response.output_item.done` supplies function calls even when terminal `response.output`
is empty. Every pending tool gets a result; ordinary continuation uses the documented
`response.item.create` / `response.create` exchange. Accepted closing transfers playback to the
application and does not start a competing continuation. Audio interruption invalidates stale
effects. Duplicate function IDs reuse the result; changed arguments under the same ID are rejected.

An appointment request's function result waits for the subsequent recipient answer.
The answer is returned as untrusted observed speech, and only then does the normal
Responses tool loop continue. This avoids an immediate backend response saying it is
still waiting while the recipient is already confirming. Disconnect resolves the pending
local function without running another response. Ordinary turns do not trigger this path.

Transcript provenance belongs to the application, not tool arguments. The backend sees
the native conversation; code attaches its last observed recipient turns to effects.
Subsequent appointment confirmation still requires a turn after delivery. A real provider
trace exposed why asking the backend for application turn IDs was unreliable: it knew the
objective was resolved but refused `end_call` because the final answer's ID had not yet
arrived. Removing those arguments and the per-turn shadow Responses items eliminates that
dependency. Pending speech and stale results still prevent effects; no turn watchdog or
extra backend scheduler was added.

## Playback and failure handling

There is no invented Live `response.done` audio boundary. Controlled transitions use observed
native text, a quiet candidate and a playback mark. A complete required suffix can follow a
late fragment of the preceding utterance for streamed transitions. That does not certify the
earlier fragment. Buffered appointment commitments still require the entire text to match or
pass semantic verification before release. Ordinary conversation is streamed directly, not
screened before playback; the application cannot guarantee every autonomous spoken claim.

Closing and buffered commitments share a transition that lets already generated speech
drain before requesting the protected utterance. The quiet interval
does not itself authorize hangup. Cleared or stale marks cannot end a resumed conversation.
Backend timeout, malformed protocol and persistence failures fail closed. No silent Realtime
fallback is enabled. The separate legacy Realtime driver and explicit hybrid option remain.

Responses operations are accounted independently from Live duration, including failed,
cancelled and late completions received while closing. Missing final usage remains unknown.
Logs/telemetry retain operation identifiers and safe reasons, not prompts or audio. The optional
`realtime.ready.runtimeVersion=live-managed-v1` distinguishes this implementation in exports;
historical `conversation.task` events remain readable. No new migration was added by this
refactor; branch migration 0085 for the encrypted action journal is retained.

## Verification and remaining acceptance

The paid synthetic probes use the production bridge and real OpenAI Live/Responses. Only
Twilio recording, carrier connection, playback marks and hangup are simulated. Their fixtures
contain no customer recording. See commands in [the runtime guide](live-unified-runtime.md).
These probes are opt-in and incur provider charges; ordinary tests do not call providers.

Provider runs exposed actual integration issues: speech from a previous utterance crossing a
transition, a backend continuation competing with closing, and confusion between customer and
called provider during booking. These were corrected in the shared runtime/contract rather
than by matching particular answers. Early provider failures remain part of the acceptance
record; a later success is not a reliability rate or proof for every scenario.

The final synthetic information-call probe completed with one managed backend response,
a short recap, farewell and simulated hangup. The appointment probe completed with four
backend responses, one confirmed action for the exact offered date/time, five playback
marks and simulated hangup. The request tool waited for the actual subsequent answer
before returning. Neither probe reported internal workflow narration.

An immediately preceding appointment run failed before speech with
`LIVE_CONTEXT_ACK_TIMEOUT`. It did not execute an appointment action. This is retained as
a failed provider/integration run, not counted as a successful retry or hidden behind a
runtime fallback. Happy-path probes alone do not establish production reliability.

Final automated verification on this implementation:

- Full workspace test suite: 1,821 tests in 204 files passed, exit code 0.
  API: 1,370; web: 315; contracts: 136. Integration tests used an isolated local
  PostgreSQL database, which was removed after the run.
- Workspace lint, typecheck and production build: each exit code 0.
- Copy check: 860 files passed. Migration catalog: 85 migrations passed.
- Whitespace/conflict-marker diff check: passed.
- Local pre-restart database check: migration 0085 present, no active calls.

The local API was restarted with `VOICE_RUNTIME_DRIVER=live`,
`VOICE_RUNTIME_LIVE_FALLBACK=false` and agent hangup enabled. Web `/ru` and API readiness
returned HTTP 200; the separate Twilio webhook listener accepts TCP connections on port
4001. The existing public tunnel returns the expected 404 for an undefined health route
on that webhook-only listener. This is a connectivity check, not an end-to-end Twilio call.

The final test suite includes consent, native transcripts/audio, stale/parallel/duplicate
tools, delayed appointment answers (including a negative reply), interruption, protected
playback, closing marks, provider errors, accounting and legacy-driver selection/fallback.

The production deployment configuration check rejects the local development environment
(local origins, embedded worker and development key identifiers). Production configuration
has not been validated or changed in this turn; that check must run against the candidate
deployment configuration before release.

Before merge/deployment, manually test through real Twilio: a simple question, consultation
with pauses/background conversation, a permitted appointment, an out-of-scope proposal,
recipient correction, refusal, unknown answer, interrupted recap/farewell and voicemail.
Check consent in the supported call languages, pickup latency, automatic assessment, both
transcript tabs and the admin telemetry archive. The user's approval of those calls remains
the release gate. No production environment or default was changed by this work.
