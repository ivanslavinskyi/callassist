# Post-call assessment and premature credit refunds — 2026-09-15

Status: **implemented and active locally; external call acceptance remains open**. This follows
the [lifecycle/history checkpoint](call-lifecycle-history-2026-09-15.md) and is an
B05/B09/B10 acceptance item in the [release roadmap](mvp-plan.md).

## Evidence from the reported call

Read-only inspection of the reported 35-second recording established:

- Consent and recording start were recorded before the task exchange.
- The approved task was to obtain the recipient's dinner preference.
- The provisional recipient transcript was unrelated to that task; the final
  recipient segment contained the dinner choice in response to the task question.
- The final summary cited that question and answer and reported the choice.
- Both realtime `credit_qualification` requests completed successfully at the
  provider level. Negative/invalid semantic decisions are not persisted, so the
  exact classifier category or parser rejection cannot be reconstructed.
- The conversation agent requested `end_call` with `objective_resolved`. This is
  supporting telemetry, not independently sufficient evidence for charging.

All timestamps below are Europe/Zurich on 2026-09-15:

| Event | Time |
| --- | --- |
| Consent granted | 15:31:15.232 |
| Provider completion / credit refund | 15:31:50.653 / 15:31:50.664 |
| Final transcript available | 15:31:57.774 |
| Summary ready | 15:32:04.318 |

The final evidence arrived after the irreversible settlement. Audio was not
replayed in this investigation. Private identifiers and verbatim call content are
omitted from this document. The initial diagnosis was read-only; subsequent synthetic
provider evaluation and implementation checks are recorded below.

## Original implementation and failure mechanism

`summary-input.ts` already includes the attempt's compiled objective, success
criteria and ordered questions with original, speaker-attributed final segments.
`openai-text-processor.ts` already uses strict JSON Schema for the summary. Adding
the goal alone therefore cannot close the gap.

Credit qualification originally used provisional question/answer pairs through
the realtime connection, with at most eight requests and an eight-second timeout
per request. Only positive validated decisions are persisted as qualification.
The repository accepts this qualification only while the attempt is active.
Terminal callbacks refund any unsettled reservation immediately. A unique ledger
constraint prevents a later charge from reversing that refund.

The first lifecycle projection used a qualified charge as evidence of a substantive
answer. That faithfully exposes the accounting fact but misses conversations that
were confirmed only by later, better transcription. Conversation evidence and
accounting settlement need separate sources of truth.

## Implemented flow

1. Preserve provider-derived connection/consent/stop facts. No answer, busy and
   ended-without-consent attempts can refund immediately without an LLM request.
2. For consented conversations, keep the reservation pending after hangup while
   the existing final-transcript/summary job runs. Do not finalize billing from
   provisional ASR. The separate per-reply realtime classifier and its service entry
   point have been removed. Legacy ledger validation remains for historical compatibility.
3. Extend the existing summary generation with a bounded assessment object:
   substantive exchange `confirmed | absent | uncertain`, answer category,
   goal `achieved | partial | not_achieved | uncertain`, and cited source segments.
   Evaluate goal criteria individually; negative factual answers, lack of knowledge
   and referrals can qualify as a substantive conversation without achieving every goal.
4. Validate evidence on the server: same attempt, approved plan and transcript
   revision; trusted consent event; recipient speaker; question/answer or delivered
   message context; existing segment IDs and exact quoted evidence. Assistant
   assertions, readiness, greetings, farewell and `end_call` alone cannot qualify.
   Refusal, truncated output, invalid citations and ASR ambiguity remain uncertain.
5. Persist one canonical assessment independently of its translated presentation.
   Bind it to attempt ID, compilation hash, transcript revision/hash and evaluator
   version. UI language changes and repeated summary requests must neither reassess
   billing nor cause another settlement. Share it across customer UI and admin.
6. Finalize reservation and its billing decision atomically, with exactly one
   settlement per attempt. The server decides the charge from trusted consent plus
   validated substantive-answer evidence; the model does not emit a debit command.
7. Bound pending time and retries. Beta default: at most five minutes from
   hangup, with at most one retry for transient failures and existing request/cost
   caps. A durable indexed sweep releases unresolved reservations with a recorded
   reason. Timeout is `assessment unavailable`, not a claim that nobody answered.
   A result arriving after a final refund may correct the conversation/goal display
   but must not silently charge the account retroactively.
8. Display pending assessment explicitly. Once ready, show conversation outcome,
   goal outcome and credit status separately. Admin counters must distinguish
   substantive conversations, goal achievement, returned credits and unresolved
   assessments. Latest manual user goal feedback and AI goal assessment have separate
   counters and denominators; staff classification changes neither AI nor user feedback. Historical refunded calls can have corrected outcome evidence
   while retaining their immutable refunds.

This is one normal summary/assessment request for a short call, not a second
full-transcript request. Longer chunked transcripts need a bounded final assessment
over the combined evidence, including contradictions across chunks; never decide
global task success by taking the first positive chunk.

## Cost and validation

The existing summary operation used requested `gpt-5.6`, reported
`gpt-5.6-sol`, 1,525 input tokens and 360 output tokens (including 58 reasoning
tokens), with 6,392 ms provider-request duration. At current standard short-context
list rates of $4/$20 per million input/output tokens, its estimate before caching
is **$0.0133**. This excludes transcription and telephony and is not an invoice.
An additional 200 output tokens would cost $0.004 at that rate; extra instructions
and reasoning also count. Measure the marginal cost after implementation.
See [official pricing](https://developers.openai.com/api/docs/pricing).

Use the current summary model first to isolate the workflow fix. Evaluate cheaper
models against a labelled multilingual corpus before switching. No price or
quality claim for an untested replacement is implied.

Strict structured output enforces shape, not factual correctness; evidence checks
and evaluation remain necessary. See
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

Acceptance must include wrong provisional/right final ASR, task answers before
hangup, missing/failed transcription, silence, voicemail, consent only, bare yes/no,
task-related negatives/referrals, offered versus confirmed appointments, ambiguous
ASR, prompt injection in transcript content, language switches, late/repeated jobs,
refund races, server restarts, multiple attempts and consistent admin counters.
Add this reported case as an anonymized regression fixture; mocked passing tests
alone are not real-provider acceptance.

## Implementation boundaries and verification

- Migration `0074_final_call_assessments.sql`; apply before restarting all API/workers.
- One canonical assessment per attempt/source revision; strict `assessment` JSON includes
  conversation disposition/category/exact quote, goal and ordered success criteria.
  Original speaker attribution and plan/transcript hashes are checked before settlement.
- Summary publication, assessment and credit settlement share a transaction. Database reads
  of assessment/ledger facts use a repeatable-read snapshot. Callback locks take call before
  attempt; callbacks and assessments from an older attempt cannot change the next attempt.
- Two automatic summary attempts; existing lifetime request/generation/beta spend limits remain.
  At most five minutes from first processed termination; worker maintenance runs independently
  of blocked generation. A delayed terminal callback can delay the start of this deadline.
  Total worker/database outages delay refund execution until recovery; the deadline still
  prevents a later positive result from causing a debit.
- Language-only summaries never independently grade. They reuse the canonical assessment if
  available; otherwise they may publish their text while the canonical job is queued.
- Missing trusted consent or usable speaker attribution cannot produce a charge. Invalid
  source IDs, quotes, criteria, citations and stale leases cannot publish an assessment.
  Grammar imperfections in ASR alone do not erase a semantically clear task answer.
- Decision text is encrypted, exported with account data and redacted with call content.
  Rotation/restore inventories include the new ciphertext column; no private quotes are
  exposed in admin aggregate statistics or operational logs.
- Historical refunds are final. Later confirmed conversation/goal evidence is shown with an
  explicit notice that no credit will be deducted retroactively. Historical calls are not
  automatically regraded en masse.

Executable smoke evaluation: `apps/api/src/text-processing/final-assessment.eval.ts`.
It requires explicit `ALLOW_BILLABLE_EVAL=true`, runs eight synthetic cases without
calls/SMS or real contact data, logs model/usage/latency and never settles customer credits.
`ASSESSMENT_EVAL_CASE` selects one named fixture. The first real-provider run caught an
ASR-grammar false negative for a German dinner-choice answer; a general contextual-semantics
instruction corrected the named fixture. The corpus includes consent only, lack of knowledge,
referral, an unconfirmed appointment offer, a factual negative answer, immediate refusal and
transcript instruction injection, with output in EN/DE/FR/IT/UK/RU.

This small corpus is a smoke gate, not a measured production accuracy guarantee. Broader
multilingual and real-call B09 acceptance remains open, especially diarization, voicemail,
short yes/no answers, contradictions, complex bookings and provider outages.

## Local checkpoint ? 2026-09-15

- Complete isolated API suite: **994 passed**, including PostgreSQL restart, settlement
  races, older-attempt callbacks, analysis-before-hangup, terminal failure, late refund,
  blocked-worker deadline, evidence rejection and independent feedback counts.
- Contracts: **114 passed**; web: **223 passed**. Type checks and production web build passed.
  API/contracts package builds and final lint also passed. Total: **1,331 tests**.
  The outer PowerShell API command reported exit 1 with a NativeCommandError for an
  expected fault-injection stderr message; Vitest itself reported 93/93 files and
  994/994 tests passed, with no unhandled errors. This is not a green CI-run claim.
- Real-provider smoke: the revised eight-case run accepted seven on first attempt and
  rejected one malformed consent-only response. Rechecking that case produced absent/not
  achieved, without weakening server validation. The German ASR case passed after the
  contextual-semantics correction. These are small smoke samples, not an accuracy estimate.
- Actual reported call reprocessed through the normal durable summary worker and spend
  controls: **conversation confirmed, goal achieved**, summary ready. The original refund
  remained unchanged; no retroactive charge was issued. This run used retained final text,
  not another telephone call or audio transcription.
- Migration 0074 applied after confirming zero active calls, attempts and preparations.
  Local API restarted with existing provider/tunnel settings; `/health/ready` reports ready.
- Browser inspection of actual shared components: EN desktop and DE at 390 px, with pending,
  confirmed, late-refunded and unavailable cases plus independent admin statistics. QA used
  synthetic data; temporary tab, viewport override and preview server were cleaned up.

No VPS deployment or public GO is claimed. New end-to-end telephone calls remain part of B09.
