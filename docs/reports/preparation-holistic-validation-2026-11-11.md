# Holistic preparation validation

Date: 11 November 2026, Europe/Zurich. Scope: the current working tree and local
application. Production was not changed. The implementation follows the
[approved plan](../plans/preparation-audit-simplification-2026-11-11.md).
Latest local runtime: `live-plan-only-2026-11-11.2`; compiler 17, schema 11 and
approval 10. The user confirmed correct behavior after the final local restart.
Earlier sections retain their original verification chronology and runtime versions.

## Implementation

The native profile now writes compiler 17 / schema 11 under
`preparation-live-holistic-2026-11-11`. One compact generator result is assembled
locally and reviewed by the existing audit against the exact execution context.
The audit returns a verdict and explanation; it has no candidate paths or source
quotations. One shared recovery replaces overlapping repair loops. It either
corrects the full candidate or repeats an invalid audit against unchanged context.
No additional model stage was introduced.

The initial preparation change retained approval 10 and voice
`live-plan-only-2026-11-10`; subsequent runtime changes are recorded below. Native action
authority still enforces operation, principal, alternatives, price/time limits,
requirements and recipient evidence. Historical contracts and snapshot hashes
remain readable. Summary source 3 adapts the new source-free authority for post-call
assessment without changing the conversation protocol.

Migration 0116 records safe correlated metadata and bounded encrypted evidence
independently of plan publication. It includes failed/recovered output, validation
errors and exact audited contexts. Cancellation clears private evidence; deletion,
30-day expiry, stale workers and failed writes are covered. Superadmin evidence
access requires a reason and writes an encrypted audit record. Ordinary logs and
admin lists contain fixed codes and metadata, not private task text.

## Repeated real-model evaluation

The fixed synthetic corpus has 12 families, three repetitions each, including a
paraphrased input. It covers all seven call languages; first-person ownership,
translation, superseded identifiers, conditional outcomes, informational requests,
booking, relative dates, price limits, identifiers, optional context, quoted
instructions and cancellation. Inputs use fictional people, numbers and references.
The time is frozen at 2026-11-11T12:00:00Z. No telephone calls are made.

Both variants use generation `gpt-6-luna` and audit `gpt-5.6`, default service tier,
the same policy budgets and corpus. Baseline means compiler 16 in the starting
working tree, including prior local fixes; it is not a replay of a production
provider response. A separate negative review mutates a material identity, reference,
condition, time/price bound or permission in the actual candidate. These extra
evaluation reviews are outside the production preparation flow.

| Measure | Compiler 16 baseline | Final compiler 17 |
| --- | ---: | ---: |
| Prepared for review | 33/36 (91.7%) | 35/36 (97.2%) |
| Ready without candidate recovery | 24/36 | 28/36 |
| Material mutations accepted | 0/35 reviewed | 0/36 reviewed |
| Median preparation latency | 15.12 s | 9.08 s |
| p95 preparation latency | 39.91 s | 23.27 s |
| Mean provider operations, including moderation | 4.611 | 4.444 |

One baseline preparation failed before a usable audit input existed, so its negative
review is missing, not counted as a rejection. Latency excludes the separate negative
review. Baseline first-pass/rejection/request/latency gates and the proposed 95%
readiness gate passed; no supported family failed consistently. These are 36-run
samples, not a guarantee about production or all natural-language inputs.

Two earlier development runs were preserved rather than discarded: initial compiler
17 reached 35/36 and the second reached 36/36, each rejecting 36/36 mutations. Manual
inspection then identified assistant speech incorrectly retaining source-author
“my” in some plans, despite aggregate readiness. Shared instructions were corrected
to distinguish source perspective from assistant speech; the full final corpus was
rerun. The final reported run, not the best earlier result, is the table above.

Manual review confirmed corrected first-person ownership in the final plans. The
remaining final block was an actual consistency defect: after correcting an
invented earliest-slot preference, the candidate still placed a booking request
before checking the no-new-fees prerequisite. The bounded audit stopped it after
the shared recovery was spent. This residual is visible in diagnostics; increasing
model stages or accepting an inconsistent plan was not used to improve the score.

Corpus SHA-256: `3e854d7872d05b531c169e83243d3ea0fb971b8b29ed279b960faf7c0ca6cbbc`.
Final generation instructions: `da21c30e7c665a30c9836ed92ba83305e8fa20e6cb2d2fbd2cbda90a67ffd78a`.
Final audit instructions: `c39bf47403882369ea0f3b30facf5ceca6e8dbd0c0d83d35aea3bb5f7520870e`.
Local detailed artifacts remain under `.tools/runtime/holistic-eval-2026-11-11`,
`holistic-eval-2026-11-11-v2` and `holistic-eval-2026-11-11-v3`. They are ignored,
contain only synthetic evaluation inputs and are not part of the public log surface.

Reproduce using `pnpm --filter @callassist/api eval:preparation:holistic --live`
with provider credentials and trusted certificates. The checked-in
[harness](../../apps/api/scripts/evaluate-holistic-preparation.mjs) creates a new
timestamped directory and bounds conservative request reservations to USD 30.
`--holistic-only` runs the new writer alone. It does not modify deployment policy,
send user messages or dial a telephone.

## Automated verification

The regression set covers compiler format/semantic recovery, shared recovery
exhaustion, padding/EOF/incomplete/invalid UTF-8, provider budgets, cancellation,
frozen time, exact audit/approval projection, and deterministic native constraints.
Historical and new approval-10 plans run through actual Live admission with mocked
sockets/telephony, including refusal before dialing. Native appointment and terminal
checks retain their evidence and limit enforcement.

PostgreSQL tests exercise independent encrypted writes before publication, concurrent
budgets, truncation/escaping, duplicate and stale writes, cancellation, deletion,
retention and audited private access. Route tests cover admin versus superadmin,
origin/reason requirements and no-store responses. Worker logging tests check the
real nested error chain without exposing private messages. Telemetry export source
inventory and historical/new summary projections are included.

Final API regression coverage: 71 files / 1,338 tests. The two newly parameterized
UTF-8 fixtures initially passed scalar numbers instead of byte arrays; after fixing
the fixtures, all 41 compiler/reader tests in the affected files passed. The other
1,297 tests in that regression set passed unchanged. Earlier broader runs also
covered realtime compatibility and additional profile tests.

Contract tests: 26 files / 290 tests passed. Web projection/presentation tests:
3 files / 72 tests passed. API and web TypeScript checks and production builds passed.
The built runtime CLI was tested on a disposable database: native activation,
idempotence, read-only checking and compatible managed rollback passed without
provider traffic or implicit migration.

## Local activation and limits

Local calls/preparations/jobs were idle before migration and restart. Migration 0116
and explicit profile activation changed only the local preparation policy to
revision 20, retaining the generation/audit models. API, worker and web readiness
passed; the tunnel still hides private API routes and validates voice webhook
signatures. The app is available at `http://localhost:3000/ru`.

A synthetic task then passed real-model preparation, HTTP approval and construction
of the existing native voice session. The exact audited context matched the approved
context; the admin list had no private details, and private evidence access produced
an audit record. The local smoke run took 16.30 seconds and emitted source, provider,
candidate, audit, readiness and publication events. Temporary verification sessions
were revoked. Voice admission/action compatibility was tested, but no real telephone
conversation or production capacity test was performed.

Production requires the explicit drain, migration, matching-build activation and
readiness procedure in [runtime profiles](../runtime-profiles.md). Older binaries
cannot be assumed to read schema 11/summary source 3. Use a compatible forward fix or
managed profile on the upgraded build for rollback; do not revert the database or
blindly restart an old release after new artifacts exist.


## Follow-up: canonical call language

A subsequent local call at 15:54 Zurich time exposed a gap in the initial model
corpus. Compiler 17 produced German spoken questions but Russian objectives,
background, question purposes, conditions and outcome criteria. The existing audit
accepted that mixed-language plan. The complete saved trace proved that Live and
its reasoning backend received exactly the approved plan; the original task and
review translation were not added as a second source. This was still a violation
of the existing canonical-language contract.

The shared generation/audit instructions now explicitly apply the selected call
language to every human-language execution field and the entire appendix, including
unspoken reasoning content. Names and exact identifiers are preserved. Source-language
metadata and preparation-only clarification are separate. The existing audit returns
`revise` for a partial translation; the same shared recovery corrects the candidate.
No language detector, alphabet-based application gate, second runtime plan or extra
model stage was added. A shared first name also does not authorize transferring a
surname between the represented person and recipient.

Verification after this correction:

- 122 API tests and 28 web tests passed; API TypeScript and build passed.
- The translated-review workflow now covers compiler 17 / schema 11 / approval 10
  through an actual mocked Live `session.start`. A display translation, including
  appendix fields, preserves the canonical stored plan and hash. Both Live and its
  backend receive the canonical German context without the Polish display text or
  Russian source facts.
- Real models (`gpt-6-luna` generation, `gpt-5.6` audit) prepared 21/21 synthetic
  tasks across seven call locales, three runs per locale, including paraphrases.
  The source language differs from the call language. Inspection confirmed the
  call language in generated runtime prose; all were ready for review.
- The real existing audit rejected 45/45 intentionally mixed-language variants:
  individual objective/background/purpose/condition/criterion/fact/restriction and
  appendix fields, English and French prose inside a German plan, and the complete
  unspoken portion left in the source language. Meaning was preserved in these
  mutations. All three fully German control plans were accepted. Errors were not
  counted as successful rejections; no evaluation request failed.
- After the local restart, the HTTP flow with a Russian synthetic task, German
  canonical plan, Russian display translation and translated approval passed.
  Approval preserved the exact canonical compilation/hash and voice context. API,
  worker, web and webhook checks passed. No telephone call was placed by verification.

The reusable command is `pnpm --filter @callassist/api eval:preparation:language --live`.
Its [harness](../../apps/api/scripts/evaluate-canonical-language.mjs) uses fictional
fixtures and existing pricing reservations with a USD 12 conservative reservation
limit. The detailed local sample is under
`.tools/runtime/canonical-language-2026-11-11T15-14-26-804Z`.
Generation instruction hash:
`863f29e7304a9e1236428e642762a0476322457ec56aa5a863d667619f5c0062`.
Audit instruction hash:
`fa6cf840ca4399c6820c866e044d025350f4d5e4a808f046b4037c1ed3a7b911`.
These results supersede the earlier prompt hashes for new local preparations;
older recorded results and approved histories remain unchanged. The sample is
regression evidence, not a guarantee of perfect model judgment on arbitrary input.

## Conversation follow-up after the 17:15 and 17:20 local calls

Runtime identity is now `live-plan-only-2026-11-11`; compiler 17, schema 11 and
approval 10 remain compatible. Live still receives the full canonical task at
startup and owns ordinary replies, clarification and simple comparisons. There is
no new model stage, per-turn gate, natural-language parser or audio muting rule.

- Shared generation/audit instructions preserve freedom of choice, explicit
  preferences and corrections; common numeric limits are not duplicated as
  additional authority requirements.
- Successful appointment tools already publish application state. Their existing
  backend continuation emits no redundant status narration. Live treats internal
  authorization and journal updates as private decision context.
- One shared definition of appointment confirmation is used by backend instructions
  and the tool schema. It interprets the question plus complete answer, including
  corrections, without demanding special wording or tense. Capability and a promise
  only to check remain insufficient.
- Existing result-recovery deduplication now includes the observed input revision.
  A later reply can resolve an inconclusive attempt; unchanged input is not reviewed
  again. Authority, numeric evidence, playback and closing guards remain active.

Validation:

- 708 voice/appointment/preparation/language-workflow tests passed; the two PostgreSQL
  suites initially lacked access to the configured stale port and were rerun against
  isolated random databases on the working local PostgreSQL: all 8 tests passed.
- The final targeted suite covered 130 tests. Its profile-identity mismatch was
  corrected; the affected runtime/profile files were rerun with all 62 tests passing.
  API typecheck and production build passed after the correction.
- The synthetic model harness `apps/api/scripts/evaluate-plan-conversation.mjs --live`
  passed 38/39 first-response checks: seven generations in five languages including
  earliest preference and its removal, four audit controls/mutations, and twice each
  of fourteen backend decision/continuation cases. No phone call was placed.
- The one failed first response attempted `end_call` on an unfinished answer. It was
  replayed in the actual runtime handler: `appointment_result_unconfirmed`, no hangup,
  and the later answer remains processable. Two additional real-model requests replayed
  that guard result and then the completed answer: silent/safe recovery followed by
  `record_appointment_result(outcome=confirmed)`, with no new booking or spoken question.
  The original model failure remains recorded, rather than counted as a first-pass success.
- This checks software compatibility and text-model decisions. It is not a new
  acoustic acceptance call; paid native audio probes retain the separate diagnostic
  project/key requirement.

The local model evidence is in
`.tools/runtime/plan-conversation-2026-11-11T16-47-20-088Z`, including
`incomplete-answer-recovery.json`. Conservative request reservations were USD 1.948
for the 39-case run (not an invoice). Generation/audit hashes are respectively
`59cf21c0590ec8e55833ab3ae2e21ec64ee02529e168063a7d89f55475d58938` and
`a773d1a921436e23a5ac246b4f52a7dcd8984095c837971d502731d2565edff3`.

API and worker were restarted after an idle check. Local web, API readiness, worker
and voice tunnel checks passed with source digest
`13d0b0c66134dcb098ca30c29c37294f052c5b7fa0238a8c17d007bd16b7978f`.

The separation of conversational responsibility and backend procedures follows the
[official GPT-Live prompting guidance](https://developers.openai.com/api/docs/guides/live-prompting).

## Review translation language: 11 November, 17:58 Zurich

Preparation `cf8b7ec6-b7fd-48e0-8116-7b440c0ec0d5` was authored in Russian and
correctly compiled into German (`de-CH`). Its generated `sourceLanguage` was
`Russisch`, a localized language name instead of a BCP 47 tag. The permissive
candidate string accepted it; `resolveTaskLanguage` could not recognize it and
selected the frozen English account preference. The English review artifact was
therefore generated for the selected target. This was not a frontend projection
error or source-task leakage into Live.

The generation-only schema now requires a language-tag format and validates it
through the existing normalizer. Assembly canonicalizes valid tags. Shared
instructions distinguish the original task language from the canonical call
language; the existing holistic audit receives this metadata separately from the
exact runtime context. Invalid output follows the existing single recovery budget
and encrypted `OUTPUT_SCHEMA_INVALID` diagnostics. There is no new model stage,
language-name dictionary, source-text detector or backend call during conversation.
Persisted compilation schemas and hashes remain unchanged.

Validation:

- 97 tests passed across preparation, language selection, translation/approval and
  native Live admission/runtime suites. Regression coverage includes `Russisch`,
  English account fallback precedence, regional/script tags, and Russian review
  approval followed by a real runtime-handler startup containing only German task
  content. API typecheck and production build passed.
- Three real-model synthetic preparations selected `ru` over the English account
  preference and retained German canonical content: language selection passed 3/3.
  Overall preparation acceptance was 2/3, not 3/3. One case recovered an unrelated
  formal-addressing mismatch; another exhausted recovery when the audit demanded
  moving a condition from `orderedQuestions[].purpose` to `conditionalFollowUps`.
  The latter candidate already said the question applied only after a yes answer.
  This separate representation-sensitive audit finding needs evaluation against
  runtime semantics; it is not treated as a language-format regression or hidden
  by another retry.
- Evidence: `.tools/runtime/source-language-2026-11-11T17-11-44-991Z`;
  conservative provider reservations USD 0.669766, not invoiced cost. No calls placed.
- The original plan's Russian review artifact became ready while the user changed
  the selection manually. A stale-revision check prevented overwriting that choice.
  The user explicitly chose to retain English; selection revision 3 remains English.
  The original German compilation and its hash are unchanged.
- API and worker restarted after an idle check; API readiness, worker, web and voice
  tunnel checks passed. Source digest:
  `19d1b2d98783bf8c6e49d0caf0c39521cdae2c4da3674b3c48c63b15417062f0`.

## Appointment contract follow-up after the 18:25 local call

Implemented runtime identity: `live-plan-only-2026-11-11.2`. Compiler 17,
schema 11 and approval 10 are unchanged. The actual last call's startup task
is deeply equal to the task generated by the updated runtime from its approved
snapshot. Live keeps the full canonical context and ordinary conversational
decisions. There is no new model stage, per-turn gate, tool, database table or
automatic removal of approved conditions.

The advertised appointment tool now derives its IDs, operation and time zone from
the approved authority. No conditions means `requirements.maxItems = 0`. The
validator distinguishes invalid/duplicate IDs, missing required evidence,
unobserved quotes and real authority violations. Errors identify the field and
expected IDs so the existing backend continuation can repair arguments internally.
Successful tools publish the existing state and hand conversation back to Live.
Internal authorization cannot claim to book in the recipient's calendar.

The existing tool-result event now carries optional validation category/field,
observation revision and hashed IDs, together with its existing snapshot and
request identity. Actual IDs and quotes remain in the protected trace.

Validation:

- Broad runtime, appointment, profile, language-workflow and telemetry-inventory
  suites: 714 tests passed. Two PostgreSQL suites initially failed setup on stale
  port 55432; rerun against isolated databases on the working local port 5543:
  all 8 tests passed. No product database was used as a test database.
- Contract telemetry suite: 15 tests passed. After the final instruction changes,
  the targeted runtime/language/profile/appointment suite passed 115 tests.
  API typecheck, production build and `git diff --check` passed.
- Offline replay of the actual five rejected requests uses the original observed
  transcript prefix and the actual `NativeAppointmentCall` handler. All five
  receive a precise internal argument rejection, then authorize with only the
  invented conditions removed, without new recipient words. Seven negative
  controls still reject excessive price, date/time violations, unapproved terms,
  fabricated evidence, another operation and a missing approved condition.
  The harness freezes the captured date for repeatable historical validation.
- Runtime protocol tests cover the full prepare/result/playback/end-call path,
  contextual short confirmation and no extra completion-watchdog request on the
  normal path. Existing cancellation, rescheduling, decline/correction,
  duplicate prevention, uncertain delivery and language tests remain active.
- Final synthetic real-model run: 32/32 scenarios passed in 34 Responses requests.
  Two fresh preparations first joined separate replies into an invalid price
  quote; both repaired it in the existing tool continuation, without another
  question or new human evidence. Thus this is 30 first-response passes plus
  two recovered cases, not a claim of error-free model output. Invented-ID
  recovery, short acceptance, capability-only answers, incomplete replies,
  corrections, declined/conditional outcomes and silent tool continuations are
  included. Russian, German and English result meanings were exercised.
- Earlier synthetic runs (27/32 and 29/32) exposed quote joining, capability versus
  action ambiguity, redundant currency clarification and work after a successful
  authorization. The shared wording was tightened. Two harness issues were also
  fixed: object-key ordering was not semantic equality, and an authorized fixture
  incorrectly claimed already-played delivery. Original failures remain recorded.

Final synthetic evidence:
`.tools/runtime/plan-conversation-2026-11-11T18-06-53-861Z`.
Voice instruction hash:
`8b2fe34fc8b7e8ee1644b847199be6e82bde61339747b2988a799228489c5c5a`;
backend instruction hash:
`9a3824f295c83d17d53bac3fc040acc1d447b967fda1293024620cc2064748c7`.
Conservative final provider reservation: USD 0.187431, not invoiced cost.

Automatic approval review rejected sending the private original call capture to
the external model API. It was replayed offline instead; the approved online
harness reads no call captures or user database and uses fictional participants.
No new acoustic acceptance call was performed: the existing native audio probe
requires a separate diagnostic project and key, which are absent. Text-model and
protocol tests do not establish audio naturalness. No phone calls were placed,
and no saved call, approval or action journal was changed by these tests.

Final offline capture replay:
`.tools/runtime/appointment-contract-2026-11-11T18-10-07-017Z` (5/5, seven controls).
The final handler fixture check passed all 24 tests after aligning its offered
date/time with its synthetic proposal.

API and worker restarted at 18:10 UTC after confirming zero active calls,
preparations and running jobs. The working implementation is
`live-plan-only-2026-11-11.2`, source digest
`edbea228178bce4e8ac5aa61639f9d82fbc7e5691f2de8a51330d7c18c0cdde2`.
Web `http://localhost:3000/ru`, API liveness/readiness and worker checks returned
200. Tunnel/private-route and signed/unsigned webhook controls returned their
expected statuses. These checks placed no calls. Evidence:
`.tools/appointment-contract-health.log`.

## User acceptance and repository handoff

On 11 November 2026, after the final local restart, the user confirmed that the
behavior is now correct and requested documentation, commit, push and CI completion.
This is user-reported acceptance of the local correction. No new call ID, audio
inspection or independent trace analysis is implied. The automated audio-probe
limitation above remains part of the test record. Production activation is separate
from this repository handoff.

Pre-push verification on the accepted working tree: all 499 web tests and 290
contract tests passed; API, web and contracts typechecks and web lint passed.
The migration catalog validated all 116 entries. First-party license and public
copy checks passed. All 387 local links in the 12 changed Markdown documents
resolved, including heading anchors. The earlier runtime/database tests are
recorded above; full repository verification is also defined by `.github/workflows/ci.yml`.

The first full CI run found four stale release expectations: two configuration
tests still pinned compiler 16, the upgrade test stopped at migration 0115, and
rotation expected 31 ciphertext families instead of 33 after the diagnostic tables.
Those fixtures were aligned with the implemented profile/catalog. Runtime behavior
was unchanged. The initial run passed 2,656 API tests plus all web/contract tests;
its four failures are retained in [the original CI run](https://github.com/ivanslavinskyi/callassist/actions/runs/43087153320).
All 17 tests in the four affected suites then passed locally against a disposable
database, including upgrade idempotency and encryption rotation.
