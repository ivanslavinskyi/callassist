# Unified Live runtime — updated 29 September 2026

Branch: `codex/live-unified-runtime`. Production last reported by the owner:
`915a8f6`, Live, fallback=false, migrations through 0084 (owner report on 26 September,
not a fresh deployment inspection). The current branch extends through migration 0089.
No production deployment was performed. A local real Twilio information call passed on
28 September; see [evidence and remaining observations](live-call-review-2026-09-28.md).
The corrected runtime then passed a real Russian handset call on 29 September with continuous
Live session, semantic consent, achieved task, natural playback-confirmed closing and no Live
errors; this is the [stable local regression checkpoint](live-stable-checkpoint-2026-09-29.md).
That call predates the [three simplification changes](live-simplification-implementation-2026-09-28.md).
Those changes are active locally after the 28 September, 17:56 CEST API restart:
Live, fallback=false, embedded worker, liveness/readiness passed. Their automated
and synthetic-provider evidence is recorded separately; handset acceptance remains open.

The next [transcript and conversation implementation](live-transcript-implementation-2026-09-28.md)
adds native-first saved transcripts, revised seven-language CMS publications and
shorter stage/backchannel instructions. Recording ASR remains a fallback. Closing
retains its existing playback/continuation checks: a 20-request synthetic comparison
did not justify lower reasoning or shorter timers. This does not replace a new
real-call audio acceptance test.

## Runtime

The [29 September repair](live-progress-fix-2026-09-29.md) supersedes earlier consent
and completion behavior: overlapping answers are retained, acoustic wait extensions
are bounded, uncovered answers receive a managed decision request, and late assistant
speech cannot revoke an accepted end_call. See that report for validation limits.
The UI exposes voice only and labels the assistant SHPROHLI in all transcripts and
exports; stored legacy persona identifiers are not rewritten.

`VOICE_RUNTIME_DRIVER=live` and `VOICE_RUNTIME_LIVE_FALLBACK=false` create exactly
one native Live WebSocket per admitted stream. Admission accepts AMD `human` and, under
the current policy, inconclusive `unknown`; neither result itself authorizes recording.
No Realtime or separate
transcription socket is created. The application renders the exact AI/name/recording/
transcription disclosure with the Speech API in the same selected voice; Live owns the
opening, ordinary conversation and natural closing. Responses
uses native managed Responses delegation with GPT-6 Luna and parallel_tool_calls=false. The default driver
in `.env.example` is live; fallback defaults false. Explicit fallback=true
retains the older hybrid pilot for compatibility, including its Realtime speech.

The form offers male `cedar` and female `marin`. New approvals freeze the ID;
old approvals use a deterministic gender mapping. Native Live checks the voice and
session ID on start and backend updates, recording `realtime.voice` diagnostics.
Both voices receive a common calm pace instruction, slightly slower than ordinary
conversation, with brief sentence pauses and clear names, dates and numbers.
Controlled speech retains that pace. The owner reported voice continuity working
after the fix; listening acceptance of the later pace change remains pending.
See [implementation and acoustic acceptance limits](live-voice-continuity-2026-09-28.md).

For local acceptance and a subsequently approved rollout, set these on the API/worker:
```dotenv
VOICE_RUNTIME_DRIVER=live
VOICE_RUNTIME_LIVE_FALLBACK=false
OPENAI_LIVE_MODEL=gpt-live-1
OPENAI_LIVE_DELEGATION_MODEL=gpt-6-luna
OPENAI_SPEECH_MODEL=gpt-4o-mini-tts
REALTIME_AGENT_HANGUP_ENABLED=true
```
The existing hangup switch retains its historical name and applies to both drivers.
Without it, `end_call` is intentionally unavailable. Example-file defaults remain unchanged.

Newly approved native Live calls use [asynchronous AMD](async-amd-live-2026-09-28.md)
alongside the disclosure. Recording starts on consent independently of AMD. A late
non-human result never redirects an accepted conversation. Before consent, explicit
machine/fax results retain the approved Twilio policy. `unknown` is inconclusive and
continues the consent flow; it never starts recording or the task by itself. A declined handset call cannot reliably be distinguished from carrier
voicemail routing. No change to recording retention or post-call gpt-transcribe /
gpt-4o-transcribe processing.

## Startup preparation

Signed, attempt-bound ringing/answered callbacks prepare a minimal Live session and
render the localized disclosure on the webhook process in parallel during ringing. The
session contains no task or action tools,
sends only synthetic PCMU silence, and never plays audio before authenticated stream admission.
The incoming stream revalidates attempt/SID/snapshot/token and adopts that session.
At most 64 unadmitted sessions are retained per process, for at most 45 seconds;
terminal callbacks, unused-session expiry, failures and server shutdown close them early.
Late callbacks cannot prewarm an already admitted attempt. Missing/expired preparation
uses an ordinary cold Live startup, never another voice runtime. On multi-instance
hosting, use affinity for callbacks and Media Streams to benefit from preparation;
unadopted sessions still expire and are accounted for.

All prepared session and Speech API usage, including waiting and unsuccessful calls,
goes through the existing provider ledger. Disclosure synthesis is recorded as
`live_disclosure_synthesis` and cached in memory for replay within that call.
Preparation trades potentially billable waiting time
for overlap of setup with ringing/AMD. AMD thresholds remain unchanged, but detection
does not block the new native Live disclosure. The preceding v2 async policy remains
readable with its historical `unknown` handling; older approvals, Realtime and explicit
legacy fallback remain synchronous. Compare connection-to-disclosure, AMD duration
and consent-to-recording on real calls; native disclosure evidence
is committed after its verified playback mark. New compiled openings avoid filler;
previously approved openings are not silently rewritten or shortened.

## Application gates

During preparation and application-owned disclosure playback no tools are enabled.
Live receives recipient audio continuously but is instructed to listen silently while
the application plays the disclosure. Only after the complete clip's matching, uncleared
Twilio mark does the application enable the strict
`report_consent({ decision: affirmative | negative | unclear })` tool. The task plan
and its tools remain unavailable. Live delegates a subsequent complete answer in its native
conversation context; the application no longer assembles recipient text or calls
a separate consent classifier. There are no phrase lists or scenario-specific rules.
Natural contextual permission is accepted without a keypad press. The first unclear
decision replays the complete cached disclosure; a second adds a localized clarification
and optional keypad recovery. Spoken consent remains
available throughout. Silence times out without becoming consent. Backend failure
fails closed.

Update 29 September: the disclosure is no longer a Live speech instruction. The Speech
API receives the exact application text and returns PCM while Live prewarms. Recipient
audio is never buffered: acoustic barge-in immediately clears Twilio playback and Live
continues listening. A partially heard clip cannot unlock consent and is replayed in full
from memory after the recipient stops. Speech made before a complete disclosure mark is
not reused as affirmative consent. After the mark, a request to repeat or explain is
interpreted semantically as `unclear` and replays the complete disclosure from memory.
Native transcript timestamps enforce the same boundary if a pre-mark transcript arrives late.
Acoustic activity can extend the consent wait only
up to 20 seconds from playback completion, not indefinitely.

Input audio is continuously forwarded in PCMU at 8 kHz without transcoding or
pre-consent recording. Pre-consent recipient text is neither retained by the application
nor published as conversation history. The app keeps timing evidence only. Fixed
assistant disclosure text is retained only after its matching, uninterrupted Twilio
playback mark; no transcript-based disclosure classifier is involved. Consent delegation
does not exist before that mark. New speech, corrections, phase changes or disconnect
invalidate pending effects.
A continuation of an old consent delegation cannot refresh its evidence: corrected
answers require a fresh Live delegation. Only an accepted affirmative after verified
disclosure playback can start recording. Successful recording enables task context/tools;
when a nonempty assistance disclosure is approved, its controlled playback precedes this transition.
The ordinary purpose/readiness opening is generated by Live without a script or playback gate. Consent tool results are continued through Responses
so native delegation can finish and subsequent task delegation remains available.
The consent backend supplies no spoken acknowledgment over the next task instruction.
Live introduces the purpose without repeating the initiator and checks convenience naturally,
unless the recipient already invited continuation or began answering the task. Consent to
recording alone does not establish readiness to discuss the task.
The UI retains the durable consent fact, timestamp and method without inventing a
verbatim recipient answer. Model interpretation remains probabilistic.

| Stage | Available backend tools | Application transition |
| --- | --- | --- |
| Preparation / AMD | None | Validate human admission and signed attempt/snapshot binding |
| Disclosure playback | None | Render exact application text; clear immediately on barge-in; require an uninterrupted matching playback mark |
| Consent | `report_consent` only | Interpret the post-disclosure answer semantically and apply the current decision |
| Recording startup / optional assistance disclosure | Consent calls rejected; task tools unavailable | Recording must succeed; play a nonempty approved assistance disclosure once |
| Native opening / conversation | `end_call` when enabled; appointment tools only for approved scope | Validate current evidence/authorization and serialize effects |
| Closing | Task tools remain configured; new effects are gated by phase | Continue accepted `end_call` through Responses; inspect farewell after its terminal result and verify playback; interruption returns to conversation |

The app's consent retries use application-rendered localized permission questions;
`unclear` does not yet enable a free-form explanation of every disclosure/privacy
question. DTMF is recovery, not a requirement for spoken agreement. Speech verification
and closing classification remain separate from consent interpretation.

The disclosure has no native-text verification path. Its source of truth is the exact
text sent to the Speech API; the application converts returned raw 24 kHz PCM locally to
8 kHz PCMU, sends it to Twilio and advances only on the matching, uncleared mark. A Speech
API error, invalid audio or missing mark fails closed before recording. This removes the
old Live paraphrase/retry/watchdog stack while retaining a real playback boundary.
Real-call acceptance must still test pronunciation, interruption and latency.

The classifier uses `store=false`, no tools, a strict enum schema, a six-second
request deadline, and only the question/utterance plus native text held in memory.
This does not promise zero provider retention.
Controlled appointment speech verification uses `live_speech_classification`; consent uses the existing
`live_delegation` ledger stage. Consent diagnostics contain decisions and rejection
reasons, never recipient words. Historical `live_consent_classification` accounting
remains readable but new Live calls do not use that path. Cancellation
without provider usage remains unconfirmed cost. Disclosure synthesis uses
`live_disclosure_synthesis` with PCM-derived duration accounting. Appointment speech uses an additional `live_action_speech_classification` check and
buffers original PCMU until its native output text is verified, then submits audio and
a mark together. Ordinary speech, including appointment questions, is not pre-screened.
The prompt requires delegation before a commitment; this is not a guarantee that
an autonomous model can never speak an unauthorized claim. Speech verification is bounded to eight variant checks per controlled utterance,
including cancelled requests. Consent shares the managed delegation response limit
and has bounded clarification/playback deadlines. Ordinary task conversation is not routed through this gate.

Live owns closing wording (updated 28 September 2026). `end_call` accepts only a
reason; the backend supplies no spoken script. The application checks observed
recipient evidence and required appointment confirmation before authorizing closure.
Live then chooses one natural closing from the conversation context. Recap is optional,
without a word-count target; already conveyed information need not be repeated.
Internal constraints govern actions and are explained only when material to the
recipient's request or expectations. There is no required recap or duplicate acknowledgment. Natural acknowledgments of received
information may precede delegation; claims of completed external actions wait for actual
results. Promises require an approved executor, authorization and capability.

Live has no speech-done event. The normal end_call function result is followed by
response.create. Its terminal backend continuation enables inspection, without implying
that voice output has finished. No separate application instruction starts the normal farewell.
After 700 ms without voiced audio or new transcript
content, a text-only semantic check asks whether the actual Live transcript contains
a completed farewell with no pending question or unfinished speech. It writes no
replacement speech and performs no task reasoning. Silence, tool success or backend
completion alone cannot authorize hangup. A positive check queues a unique Twilio
mark; only its acknowledgement ends the call. Later voiced audio or text invalidates
the check and mark. Recipient interruption cancels closure; Live handles it in context
and requests fresh end_call authorization. Native closing text is persisted as streamed.
One classifier may be in flight, with at most two attempts including cancellations.
It judges conversational completion, not business truth. Recipient input cancels
closure and returns to Live. Late assistant questions cannot revoke an accepted
end_call: they use the same bounded farewell recovery. Incomplete speech waits for changed text; two seconds without
progress triggers recovery. Unclear/failed checks or a missing backend continuation (eight
seconds) use one short localized farewell through the existing controlled-speech path.
That fallback requires the complete expected transcript and a real playback mark, performs
no further model classification, and has an eight-second deadline capped by the original
30-second closing deadline. Normal mark acknowledgment is bounded by queued playback
plus three seconds. Failed fallback never records successful playback.
The semantic check is probabilistic and adds text-model latency/cost at closing;
it is not a pre-playback filter or proof of task success. Existing appointment
authorization and subsequent confirmation fences still apply.
Tools, provider disconnects and timers cannot silently restart the call in another model.

Live protocol errors are command-scoped rather than globally fatal. The runtime correlates
`error.client_event_id` with tracked `session.update`, context-append and `response.create`
commands. An explicit provider rejection is retried once because the rejected command was not
applied. An acknowledgement timeout is not retried because acceptance is ambiguous and resending
could duplicate context or create a second response. A repeated consent-response failure returns
to the existing semantic consent recovery; a repeated task-stage command failure uses the existing
`cannot_proceed` closing path. Late, uncorrelated or already superseded command errors are recorded
and the active conversation continues. A closed Live session/socket or an exhausted active
command/delegation remains fatal.

Task-stage failure speech waits until queued model audio has drained and a short quiet boundary has
been observed. It is never started on top of the model's current utterance or the recipient's
speech; if the recipient is still speaking at the bounded deadline, the runtime closes without
adding overlapping fallback speech. Every handled Live error emits durable `realtime.error`
telemetry with bounded protocol fields only: phase, disposition, code/type/param, command, client
event id and attempt. Provider messages and conversation text are excluded. An aborted semantic
classifier request is accounted as `network_error` with `LIVE_CLASSIFICATION_CANCELLED`; a real
provider failure remains `provider_error` with `LIVE_CLASSIFICATION_UNAVAILABLE`.

Native Responses delegation replaces the custom client task controller. Live normally decides
when reasoning/tools are needed and handles ordinary questions itself. Nested response
events provide usage and completed function items; the application returns all function
results and explicitly continues the managed backend, including an accepted closing tool.
The closing continuation returns concise task state without further tools or a spoken script.
There is no speak/wait/ignore decision loop or standalone Responses controller.
After the existing 600 ms recipient-turn settlement, the application requests a
managed backend decision if native delegation has not covered the answer. Announced
or running native work and pending continuations prevent a duplicate request. Each
answer/configuration revision gets at most one application request; acoustic noise
does not create another answer revision. The existing backend interprets consent or
task completion, with the same tool and evidence gates. Recipient observations
support application provenance without shadow transcript items or keyword rules.

Consent delegation validation (28 September 2026): 161 focused voice/accounting tests
and API TypeScript checking pass. Paid synthetic audio probes through the real Live
API accepted German "Ja, gerne" and "Ja", rejected a recording refusal, and returned
unclear for a transcription question. A two-answer probe returned unclear followed by
affirmative for a spoken "Ja" after clarification, with no DTMF. A full synthetic call
passed consent, opening, task question, end_call, natural farewell and simulated
playback-confirmed hangup. Earlier iterations failed to delegate task completion;
that earlier policy required delegation before acknowledging a resolving answer.
The current policy allows natural acknowledgments and reserves result-dependent claims
for confirmed tool outcomes. These probes simulate telephony and do not establish a real-call accuracy rate.
The subsequent [local handset call](live-call-review-2026-09-28.md) confirms this
information-request path; the broader acceptance matrix remains open.

`apps/api/scripts/probe-live-consent.mts` is an opt-in paid native consent probe.
Run it from the repository root with a synthetic 8 kHz PCMU fixture:
```
node --use-system-ca --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/scripts/probe-live-consent.mts --audio=<fixture.ulaw> --expected=affirmative
```
Expected decisions are affirmative, negative and unclear. Optional
`--then-audio=<second-fixture.ulaw>` tests a second spoken answer after clarification.
Only synthetic test speech may be logged by these diagnostic scripts.

Tools request_appointment, confirm_appointment and end_call enforce application state,
immutable authorization, evidence and duplicate protection. Tool execution is serialized;
new speech invalidates pending effects.
An appointment request returns its subsequent recipient answer as part of the tool
result before backend continuation; it does not generate a premature waiting report.
The pending local tool resolves on answer or disconnect, without a per-turn scheduler.
Managed responses have a 30-second deadline, 128-response limit and bounded outputs.
The existing call admission reserves spend for
the whole call and Twilio enforces its maximum duration; managed response events arrive
after work has begun, so this is not a per-request prepaid hard-dollar guarantee.
Unknown/cancelled usage stays unconfirmed. These limits do not certify semantic correctness.

Migration 0085 adds encrypted `call_voice_actions`, unique per attempt, bound to its
approved snapshot, with versioned sending/delivered/uncertain/confirmed transitions.
The journal is written before spoken commitment. A missing mark never permits automatic
replay. Confirmation records the recipient's report, not external calendar verification.
A later interruption may cancel acknowledgment without deleting the saved observation;
new corrections receive a fresh decision. Call deletion redacts its payload, account
export includes it, rotation/restore inventory covers it, and admin telemetry exports
only its state and correlation metadata. Older Realtime code does not need this table.

Opt-in paid probes from the repository root (synthetic data; no phone numbers called):
```
node --use-system-ca --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/scripts/generate-live-test-audio.mts
node --use-system-ca --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/scripts/probe-live-managed.mts
node --use-system-ca --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/scripts/probe-live-managed.mts --appointment
```
The first generates synthetic PCMU replies. The second feeds real audio through the
production bridge, real Live native transcripts and real Responses, simulating only
Twilio playback/recording/hangup. It asserts a spoken task question and automatic
farewell/hangup. The third exercises actual appointment tools, buffered commitment,
subsequent confirmation and the durable journal. These are provider checks, not proof
of carrier behavior or recipient acceptance. The [27 September report](live-managed-delegation-2026-09-27.md)
is a historical checkpoint; [28 September evidence](live-call-review-2026-09-28.md)
covers the current consent and closing path.

After consent, native transcript text/timing is retained. Controlled output fragments
are committed only after verified playback; cancelled fragments are discarded.
Native timing accompanies provisional SSE fragments. The UI merges provisional and
persisted fragments into one stable speaker card using provider event identity,
including when an HTTP snapshot precedes its SSE acknowledgment. No full snapshot
is fetched for each saved transcript fragment. Original evidence remains ungrouped
in storage; grouping is display-only.
On graceful completion, late native fragments drain through `session.closed` and
the storage queue. Complete post-recording-boundary capture becomes the canonical
`live_native` result through the existing `final_transcription` job. Missing/incomplete
capture uses `recording_asr`. Summary, assessment, task-language translation and PDF
share that immutable source revision; a ready native result has no duplicate
provisional tab. See [assembly and fallback](architecture.md#saved-conversation-transcript-and-recording-fallback).
Completed provisional transcripts use document scrolling, while active calls retain
the follow/pause behavior. No transcript is translated to disguise a language error.

## Language, export and billing

The compiler audits the execution projection in a separate bounded Responses request
before approval. All natural-language fields, including dates, question purposes,
conditions and appointment service descriptions, must use the selected call locale.
Identity names, addresses and identifiers are preserved. Up to three language repairs
are allowed after the initial generation and audit (four language-audited versions);
the first passing version stops the cycle. An invalid audit fails preparation,
persistent mismatch after the third repair blocks approval. The existing single initial
schema/policy repair remains separate. Source-language
UI objectives and sourceText are excluded from execution context. This audit is billed
through the existing compiler request reservation/usage hooks and twelve-request budget,
including moderation and transport retries. The shared preparation deadline is unchanged;
deadline or request-budget exhaustion can stop preparation before all repairs are used.
Additional generations/audits incur usage only when needed.
Previously approved immutable plans are not silently rewritten: recreate/review any
known mixed-language historical plan before repeating it.

The review uses the existing automatic text-artifact workflow: detect the objective's
language (any recognized text language, not just UI presets), compile and audit the
execution plan in the selected call language, then translate that exact plan for review.
Mixed input context is interpreted during compilation; it is never copied into the
voice runtime. Existing explicit text-language choices remain respected.
The reader now includes background/constraints, question purposes and priority,
conditional follow-ups, unresolved criteria and stop conditions alongside the objective,
opening, approved facts, prohibited actions and appointment permissions. All seven UI
locales have labels; the plan's translated text can use other languages.
Original and translated views remain available. Approval binds the compilation hash,
translation payload hash and language-selection revision. Translation changes only text
for display; execution always uses the immutable call-language snapshot. An incomplete,
foreign or stale translation cannot be shown as the current translated plan. Compiler
integrity failures bypass translation and display the localized preparation retry;
the user is never asked to repair a language mismatch. This translation flow needs no additional migration.

For automatic reviews, configure API and worker with `TEXT_PROCESSOR_DRIVER=openai`,
`TEXT_ARTIFACT_GENERATION_ENABLED=true` and include `plan_review:*:*,clarification_review:*:*`
in `TEXT_ARTIFACT_DIRECTIONS`, preserving any existing transcript/summary directions.
Translation requests use the existing `text_translation` provider ledger and admin costs.
The current production environment must be checked during deployment; this branch does
not change it remotely. A real synthetic RU/PL → German → RU/PL probe checks detection,
all translated fields, conditions and unchanged execution without making a phone call.

Admin → Calls now opens the telemetry export panel by default and explains disabled
server configuration or missing superadmin permissions. Enable
`ADMIN_TELEMETRY_EXPORT_ENABLED=true` in both API and worker environments; PostgreSQL
and the export worker are required. Native transcript timing is included in archives.
Owner-only downloads, encryption, expiry, revocation and auditing are unchanged.
Native Live duration, Responses tokens and compiler audit tokens use the existing ledger;
missing final provider usage remains uncertain, never zero.

## Acceptance / rollout

Current source ownership:

| Responsibility | Source |
| --- | --- |
| Runtime selection and preparation | [openai-live-bridge.ts](../apps/api/src/voice/openai-live-bridge.ts) |
| Native transport, stage-specific backend configuration and stale-result checks | [live-conversation.ts](../apps/api/src/voice/live-conversation.ts) |
| Consent/tool schemas and backend policies | [live-managed-tools.ts](../apps/api/src/voice/live-managed-tools.ts) |
| Admission, consent, recording, task effects and playback transitions | [unified-live-call.ts](../apps/api/src/voice/unified-live-call.ts) |
| Natural farewell completion and playback acknowledgment | [live-closing-speech.ts](../apps/api/src/voice/live-closing-speech.ts) |
| Speech/action/closing verification; no consent classification | [live-semantic-gate.ts](../apps/api/src/voice/live-semantic-gate.ts) |
| Canonical native transcript assembly and provenance | [native-transcript.ts](../apps/api/src/storage/native-transcript.ts) |

Apply additive migrations through 0089 before starting the new API/worker. Migration
0087 adds transcript provenance without rewriting historical payloads/hashes; 0088
creates updated CMS publications in seven locales while preserving legal acceptances
and publication history; 0089 allows the bounded `realtime.error` telemetry event. Use the
[schema release procedure](deployment-preflight.md#schema-release-0085-0089).
Run the full test, lint, typecheck, build and migration-catalog
checks. Start the local API with live/fallback=false and the existing webhook tunnel.
Check the human call, negative/unclear/early consent, DTMF, recording failure, natural
German agreement, interruption during natural closing/farewell, recipient correction, appointment
confirmation, carrier voicemail and provider disconnect. Test completed long transcripts
on 360/390/430 px, both tabs and all customer UI locales. Create/download an export and
check its native timing, operation stages and recorded costs.

Latest implementation verification: [1880 tests / 211 files, lint/types/build,
CMS and PDF checks](live-transcript-implementation-2026-09-28.md). Migrations through
0089 and API restart are verified locally; production and a new real-call check of
native result/summary/translation/PDF consistency remain open. No new voice classifier,
queue or lower-reasoning setting was introduced by that follow-up.

Earlier real-call verification is recorded in [the 28 September review](live-call-review-2026-09-28.md).
The [28 September voice follow-up](live-voice-continuity-2026-09-28.md) records the
later 1844-test full-suite checkpoint, user-reported voice continuity acceptance,
local migration 0086 and API restart. The subsequent pace-only change passed 97
focused Live tests and API type checking; its acoustic effect remains unverified.
The [27 September implementation report](live-managed-delegation-2026-09-27.md)
retains its earlier dated evidence.
Earlier reports must not be used as proof of the latest architecture's broader acceptance. The local frontend
uses `.next-unified-local` to avoid dev/build artifact collisions.

With explicit legacy fallback enabled, calls requiring appointment action authorization
stay in the prepared Realtime conversation, because that hybrid adapter has no native
Live protected-playback lifecycle. The unified Live path (`fallback=false`) handles
appointments through its own application gates and never opens Realtime.

Before deployment, test a simple factual call, a longer consultation, appointment
confirmation, a correction during natural closing, thanks during goodbye, an explicit wait,
background conversation, refusal and carrier voicemail. Measure pickup-to-disclosure
and answer-to-reply on the telephone. Verify automatic assessment, mobile transcript
scrolling and the admin archive. Model/voice quality remains an empirical acceptance
criterion even when deterministic runtime and provider checks pass.
For both voice choices, listen to the disclosure and first sentence after consent,
then the task and closing. Check a natural, unhurried pace without excessive pauses,
clear names/dates/numbers and consistent vocal identity. Pace is controlled by a
common prompt, not a numeric playback speed or a plan-form setting.

## Plan settings and context (28 September simplification)

New and edited plans always capture results in the application. Result-handling and
separate delivery controls are hidden for everyone; legacy delivery text moves once into
visible context and retains normal length validation. Existing historical enums/snapshots
remain readable. External delivery requirements are inferred from objective/context.
Only superadmins may customize tone/address; authenticated user/admin requests use
neutral/formal defaults before preparation fingerprints. Changed legacy retries pass through
the existing recompilation/review flow; original approvals and hashes remain untouched.

Live and its reasoning backend receive the same approved questions (including required
and purpose), conditional follow-ups, success/unresolved/stop conditions, facts, prohibitions
and appointment scope, plus actual storage/retention capabilities. Live thinking appends
are independently readable field fragments capped at 450 UTF-8 bytes, conservatively
below the 500-token limit; arbitrary sliced JSON is no longer used. No model summarizes
this projection. Compiler version 6 produces suggested openings while versions 3–5 remain
readable. See the [implementation plan](live-simplification-implementation-plan-2026-09-28.md)
and its implementation evidence for current acceptance status.
