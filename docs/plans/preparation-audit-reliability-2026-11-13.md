# Simplifying preparation audit while preserving voice and assessment

Date and source review: 13 November 2026, Europe/Zurich.
Planning revision: 5, incorporating the multilingual evaluation and preparation-only follow-up.
Status: preparation changes implemented under the user's subsequent authorization;
see the [implementation report](../reports/preparation-material-validation-2026-11-13.md)
for actual tests, model outcomes, local activation and remaining gates. The separate
[review-translation fix](../reports/review-translation-simplification-2026-11-13.md)
is implemented and verified locally. No production deployment or telephone call is included.
Scope: preparation reliability for new calls and display translation.
Preserve the accepted voice runtime and post-call assessment.

Subsequent [USD 4 multilingual validation](../reports/preparation-multilingual-validation-2026-11-13.md)
completed 48 real preparations and found remaining reproducible defects, including
invalid removal of necessary appointment clarification and accepted foreign-language
objectives. Preparation-wide reliability gates are still open. The report records
the next preparation-only corrections; none was applied during that frozen evaluation.
The user subsequently authorized their implementation and replay within the remaining
USD 4 allocation. The [v2 follow-up report](../reports/preparation-reliability-v2-2026-11-13.md)
records the versioned capability, language, materiality and delegation corrections,
both development iterations, preserved runtime boundaries and actual validation.
The larger production/telephone acceptance gates below remain separate.

This extends the implemented [11 November preparation plan](preparation-audit-simplification-2026-11-11.md).
It changes the auditor's blocking threshold and correction instructions, not the
approved execution contract. The earlier implementation and evidence remain valid
historical records; local implementation does not establish production deployment.

## 1. Decision and objective

Keep one generator, deterministic assembly, one semantic auditor and the existing
single shared recovery. Narrow the auditor to material differences between the
user's task and the complete execution context. Do not use it as an editor of
equivalent wording. Make corrections preserve unaffected content.

The follow-up incident adds a necessary priority: explain the existing executable
authority contract clearly to both generator and auditor, and require a correction
to resolve the executable defect. Narrowing the audit alone is insufficient.
Reducing false blocks must not make an unexecutable plan pass review.

Optimize both false rejection and missed material errors. A higher acceptance
rate alone is not success. No finite corpus proves reliability across every
possible scenario; use general rules, negative controls, repeated evaluation and
observable release gates rather than scenario-specific exceptions.

The primary change adds no model stage, scenario router, intermediate task schema,
JSON patch engine, keyword blacklist, automatic whole-task retry or extra recovery
attempt. Keep generation/audit models and service tiers fixed during comparison.

## 2. Evidence and failure mechanism

The 13 November local and owner-exported production evidence describes the same
fictional meeting objective. The recipient details differ. Both use compiler 17,
schema 11, the same preparation policy name, generation/audit models and identical
generation/audit prompt and schema hashes. This establishes parity of those
preparation components, not independently verified parity of every deployed file.
Different policy revision counters are not different source releases.

| Stage | Local observation | Production observation |
| --- | --- | --- |
| First candidate | Authority contains two offered slots but omits the allowed fallback | Same material omission |
| First audit | Requests fallback authority and preservation of the fictional context | Equivalent correction requested |
| Correction | Adds fallback and retains neutral meeting confirmation | Adds fallback but rewrites a neutral confirmation using “встречаемся” |
| Second audit | Accepts | Interprets the new wording as making the assistant a meeting participant |
| Result | Ready plan; subsequent display translation fails | Shared recovery exhausted; generic `fact_integrity_failure` |

The first finding concerns executable authority and must remain detectable. The
second proves the auditor's interpretation, not a demonstrated wrong telephone
action: structured parties stayed correct, and question examples are not a verbatim
script. It illustrates why an isolated wording concern must be evaluated against
the full context before it blocks a call. Explicitly assigning an appointment to
the assistant would still be a material error.

### Follow-up: replacing the duration with “short”

In the preparation started at 09:19:48 CET, the only user-field change was replacing
`15-minute` with `short`. The policy, compiler, generation/audit models and effective
prompt/schema hashes remained the same as in the initial incident. Input/output
moderation completed successfully; this was another semantic preparation failure,
not translation, malformed JSON or a model transport error.

The first audit again identified the missing executable fallback and loss of the
explicit fictional qualifier. The correction restored that qualifier and neutral
confirmation wording. However, it added the fallback only to prose and a **common
requirement**, leaving exactly one alternative with the same two permitted slots.
The second audit correctly rejected this unresolved authority defect. Unlike the
earlier wording dispute, this rejection has a demonstrated runtime consequence.

Offline replay with the unchanged `validateNativeAppointment`, the exported
execution authorities and the frozen incident time produced:

| Authority / synthetic proposal | Actual validator result |
| --- | --- |
| First candidate; an initial offered slot, no extra requirement evidence | Accepted |
| First candidate; recipient proposes a different future slot | `outside_authorized_window` |
| Corrected candidate; the same different future slot | `outside_authorized_window` |
| Corrected candidate; an initial offered slot, no common-requirement evidence | `missing_requirement_evidence` |
| In-memory example with a separate conditional fallback and required evidence | Accepted for both the initial branch and the evidenced fallback |
| That example's fallback without earlier-alternative rejection evidence | `earlier_alternative_evidence_required` |
| That example's fallback without its recipient-offer requirement evidence | `missing_requirement_evidence` |

The in-memory example demonstrates representational support in the existing
runtime; it was not a generated/reviewed plan, a confirmed booking or an executed
call. No database content was changed. The missing-requirement result establishes
an extra evidence obligation on the original branch, not proof that every real
conversation would fail it.

Therefore retain two separate incident classes in design and metrics:

- An over-broad review or an unrelated rewrite can create avoidable rejection.
- A repair can appear complete in prose while leaving executable authority wrong.
  That rejection must remain; improve generation and repair instead of accepting it.

### Separate translation defect

The translation failure is separate. The current literal detector treats
`15-minute` as an opaque identifier; it also extracts the partial token `15-min`
from German `15-minütiges`. The incident's
six translation requests received HTTP 200 and were rejected locally with
`TEXT_INVALID_SCHEMA`. The rejected translation responses were not retained;
the lexical defect was reproduced on the source field, not recovered from those
six responses. It does not explain compiler-17 production blocking.

Keep original private evidence outside Git. Regression fixtures must use fictional
parties/contact details and retain the relevant task, branches and wording.

## 3. Responsibilities and the blocking threshold

| Layer | Responsibility |
| --- | --- |
| Input/output moderation | Existing content-safety checks; not proof of complete product-policy compliance or source fidelity |
| Generator | Faithful localized task, criteria, conditional branches and proposed authority |
| Application assembly | Trusted participants/settings, types, calendar normalization, fixed controls, limits and immutable binding |
| Semantic auditor | Material source-to-execution differences and genuine missing prerequisites |
| Voice runtime | Conversation and delegated reasoning within the approved snapshot and existing action/evidence checks |
| Post-call evaluator | Original transcript evidence against the executed task, retaining original task sources and action context |

Use this audit question:

> Would executing this complete plan, with its trusted parties and structured
> authority, materially change an action, condition, permission, disclosed fact or
> required outcome compared with the user's actual request?

Retain the current `{ verdict: accept | revise | clarify, message }` response shape.
Do not add per-field scores, confidence voting, proof arrays or another reviewer.

| Situation | Required behavior |
| --- | --- |
| Wrong party, value ownership, date, amount, contact or reference | `revise` when the complete context contains a material mismatch |
| Lost or broadened action permission; lost fallback, restriction or prerequisite | `revise`; prose does not compensate for incompatible executable authority |
| Invented commitment, task outcome, disclosure or product-policy permission | `revise` or the existing policy restriction, as appropriate |
| User omission genuinely prevents safe preparation and cannot be resolved during the call | `clarify`, with one focused question |
| Different phrasing, equivalent ordering, harmless redundancy, optional detail or an unnecessary repeated name | `accept`; no editorial correction cycle |
| Ambiguous wording in an example, with parties/action unambiguous in the complete context | Do not block on the isolated wording alone |
| An example actually requests an unauthorized action or contradicts the established parties | `revise`; calling it an example does not excuse a material contradiction |
| Invalid model response, exhausted budget or unresolved material ambiguity | Existing bounded failure; never silently interpret technical failure as acceptance |

A `revise` message must state the source requirement, the conflicting/missing plan
meaning and the practical consequence, within the existing 800-character bound.
Collect all material findings in the existing audit rather than reserving issues
for later rounds. Do not require quotations or identifiers for every plan field,
and do not implement an application regex that tries to prove this explanation.
Retain the explanation in the existing private diagnostics.

For a structural defect, the same message may name the relevant existing field
and the required semantic change: for example, a conditional fallback belongs in
`alternatives`, and adding a sentence to `requirements` does not expand its time
domain. Replace the blanket instruction forbidding field paths with this narrow
permission for actionable structural feedback. No new verdict fields, JSON patch,
per-field proof list or application parser for the message is needed. Do not demand
field paths for ordinary meaning corrections or expose internal repair text as a
user clarification.

The canonical plan remains in the selected call language throughout, including
purposes, conditions and appendix prose. Genuine language errors still require
correction. Proper names, codes and harmless grammatical variation are not such
errors. UI review translation never repairs or grants execution authority.

## 4. Generation and correction rules

Keep shared interpretation rules short and aligned between generator and auditor:

1. Preserve every authorized conditional branch in both task meaning and the
   authority that governs its action. Asking the recipient for missing availability
   is not missing user permission. Preserve successful no-action branches too.
   Distinguish authorization to agree on another offered time from permission only
   to collect suggestions and report back; never create fallback booking authority
   from a question or background reference alone.
2. Distinguish the assistant's conversational acts from the principal's real-world
   acts. “I am calling” can be correct; assigning the principal's attendance,
   purchase, treatment or obligations to the assistant is not. Judge actual roles,
   not a banned-word list for pronouns or language-specific verb endings.
3. Preserve qualifiers such as hypothetical/test-only where they change the task.
   Do not require their repetition in every example or add unsupported conditions.
4. In recovery, change only what resolves the auditor's findings and necessary
   consistency dependencies. Preserve unrelated fields and wording. Return a
   complete candidate in the same schema, without a general stylistic rewrite.
5. Keep criteria tied to the user's requested outcome and conditional scope.
   Do not turn optional questions or inactive branches into mandatory success
   requirements, and do not relax criteria merely to make a call pass evaluation.

Implementation probes added general clarifications within the same scope:
read authorization from the complete requested outcome and conditions, distinguish
nonbinding enquiries from appointment actions in the existing `taskType`, and
describe `required` explicitly for essential versus optional questions. Corrections
must actually change the defective flags/metadata as well as prose; feedback language
must not replace the original source-language metadata. Natural nonbinding follow-ups
remain allowed unless explicitly restricted. Risk categories and blocking questions
are enforced publication decisions; false flags must be corrected rather than
accepted as harmless labels. These are preparation instructions and
schema descriptions, not new runtime behavior or relaxations of validation.

### Existing authority semantics, shared by writer and reviewer

Supply one concise preparation-only explanation through shared instructions and
appropriate schema field descriptions. It must describe the current validator,
not introduce a new task representation or modify the voice/tool contract.

| Existing field | Executable meaning |
| --- | --- |
| `operation` and established parties | Which action is authorized and for whom; explanatory prose cannot substitute another operation or principal |
| `alternatives[].rules` | Allowed dates/times for that branch; a candidate time must belong to a rule in the selected alternative |
| Ordered `alternatives` | A later fallback requires the existing evidence that earlier alternatives were unavailable; use this ordering only when the source actually imposes it |
| Common `requirements` | Additional conditions/evidence required for every selected branch; they cannot widen date/time rules or introduce an alternative |
| Alternative `requirements` | Conditions specific to that branch, such as using a time suggested by the recipient; they cannot expand that branch's rules either |
| `limits` | Existing numeric restrictions; prose cannot replace or override them |
| Objective, facts and service description | Task meaning for the conversation; not a replacement for executable permissions |

Equally permitted initial slots can share one alternative's rules. A source-authorized
conditional fallback needs its own alternative, with its condition in the proper
scope. Do not promote a fallback-only condition to a common requirement, impose an
unrequested ordering between equivalent options, or put ordinary conversational
readback instructions into new evidence obligations merely to preserve their text.

For a source-authorized flexible future fallback, use the existing date-rule
representation and trusted calendar conventions. Preserve any actual source bounds;
do not invent a one-week/month cutoff, preference or unavailable-date restriction.
The current not-in-the-past validation remains. A flexible permission is not a claim
that a slot is available or confirmed. If the existing schema genuinely cannot
express a task, expose that limitation rather than silently narrowing its meaning.

Continue passing the actual previous candidate and current audit feedback. Keep
full assembly/schema validation and a complete second semantic audit after repair.
Minimal correction is an instruction and evaluated behavior, not a claim that a
model cannot change another field. Do not merge an unreviewed patch into a plan or
mechanically freeze fields that require a legitimate related correction.

In particular, permission to make a minimal correction includes adding or adjusting
the affected authority alternative and its scoped conditions. A changed explanation
or acknowledgment of the audit is not a successful repair if the same executable
mismatch remains. The existing second audit checks the original task and the actual
assembled authority again; do not add a third reviewer or skip that check because
the first finding was mentioned in the correction.

An invalid audit response uses the existing shared recovery to review the same
candidate. Keep absolute deadlines, request accounting, leases and transport retry
semantics. A second material rejection still stops publication as ready. A failure
to prepare must not be relabelled as misconduct by the user.

## 5. Compatibility boundaries

The accepted baseline is `stable-2026-11-12`, commit
`56ca2fcfb5cfba2d5800eb14903f3fffba36e932`.

| Boundary | Required invariant |
| --- | --- |
| Voice | `live-plan-only-2026-11-12.2`; prompts, opening/pronunciation, turn handling, closing, recording/refusal behavior and hangup logic unchanged |
| Execution format | Plan schema 11, approval 10, terminal decision 3; existing compiler-17 format compatibility remains |
| Admission and actions | Same snapshot hashes/binding, tool schemas, principal, operation, calendar/price limits, branch evidence and recipient confirmation checks |
| Task context | Exact approved canonical projection; display translations and raw sources are not newly injected into Live or its backend |
| Post-call processing | `summary-v8`, `native-summary-v3`, summary source context 3, evaluator instructions and evidence validators unchanged |
| Evidence | Original transcript and attempt-bound source context remain authoritative; task text, audit acceptance and assistant claims are not proof of recipient confirmation |
| Outcomes and credits | Preserve substantive conversation versus task success, uncertainty/partial coverage and existing reserve/charge/refund rules |
| History | No rewriting/regrading of saved plans, approvals, transcripts, assessments, receipts or ledger entries |

File isolation is necessary but insufficient. Preparation changes the data consumed
by voice and assessment, so verify both boundaries with newly generated plans too.
For the same historical snapshot, compare serialized voice context/tools and
post-call request/validation behavior against the baseline. For newly generated
plans, assess semantic task/authority/outcome equivalence rather than demanding
identical model wording or identical numbers of criteria.

In particular, retain the original objective, context, facts, clarification answers
and delivery instruction in post-call `nativeTaskSources`. Bind them to the actual
executed compilation/attempt and transcript revision. Never substitute the newest
draft, current settings or review translation. Keep canonical assessment reuse and
the rule that another display language must not independently regrade or settle
the call. See [summary source](../../apps/api/src/text-processing/summary-source.ts),
[summary input](../../apps/api/src/text-processing/summary-input.ts) and
[assessment selection](../../apps/api/src/text-processing/text-artifact-service.ts).

## 6. Separate review-translation track

The user subsequently clarified that translation is a reading convenience and
explicitly requested simpler validation after another translation-only failure.
This replaces revision 3's requirement to retain literal-equivalence checks for
review text; it does not relax the original task's safety or execution checks.

- For new `plan_review` and `clarification_review` artifacts, trust the translator
  to preserve meaning under the existing faithful-translation instructions. Validate
  only the JSON shape, exact field IDs/order/count, nonempty bounded text, and binding
  to the correct source compilation/hash. Do not attempt semantic verification with
  numeric-token or opaque-identifier regexes. No additional model stage is needed.
- This deliberately removes deterministic rejection of changed literals in these
  display translations. It cannot guarantee model translation accuracy. The source
  plan remains authoritative and available; translation grants no execution authority.
  Do not describe a structurally valid translation as a verified semantic equivalent.
- Keep approval receipts and canonical plan/action hashes unchanged. Voice and
  post-call assessment continue to consume their original canonical sources.
- Keep `call_summary`, transcript translation, global grounding helpers and all
  effective model instructions unchanged. Existing adversarial evidence tests remain.
- Version only reviews as `review-translation-v1:<existing-generator>`. Reuse ready
  historical translations without mutation. Queued historical work retains its
  pinned validation contract. Retry a failed historical review as a new artifact
  for the same current source, preserving its failed evidence and deduplicating retries.
- Verify natural duration/time/date/amount formats, malformed output rejection,
  historical compatibility, source/approval binding, unchanged summary/transcript
  identities, and the saved incident through a bounded live API request.

## 7. Versioning and implementation scope

Introduce a distinct preparation prompt-policy version for the candidate, proposed
as `preparation-live-holistic-2026-11-13`. Preserve the previous version's
instructions/behavior for pinned work; do not overwrite their meaning in place.
Audit every exact policy-name dispatch, mock path and profile-readiness check.
Retain compiler-17 schema compatibility because the generated wire format stays 11.

Expected primary implementation surface:

- [Holistic instructions and contract](../../apps/api/src/brief-compiler/holistic-contract.ts).
- [Preparation/recovery](../../apps/api/src/brief-compiler/holistic-preparation.ts),
  only as needed for versioned instruction selection and correction context.
- [Compiler dispatch](../../apps/api/src/brief-compiler/brief-compiler.ts),
  [preparation policy](../../packages/contracts/src/preparation-policy.ts) and
  [runtime profile](../../apps/api/src/config/runtime-profile.ts) for version
  selection, without changing voice mode/version or model/capacity settings.
- Focused fixtures, evaluation harness and documentation.

No database migration or new execution schema is expected. If implementation needs
one, record that scope change before treating it as part of this small proposal.
Existing validated policy activation must preserve model, tier, capacity and pricing
settings. Capture release, pinned policy and effective prompt/schema hashes.

## 8. Verification and acceptance gates

### A. Recorded incident and deterministic boundaries

Use sanitized first/final candidates and recorded audit messages. Verify that the
missing fallback is rejected, a neutral faithful correction is accepted, and an
isolated equivalent example does not justify blocking when the complete roles are
clear. Explicitly wrong participants, missing alternatives and widened permissions
remain negative controls. Mocked verdict tests prove orchestration only, not the
quality of the changed auditor.

Add both duration and “short meeting” incident variants. Assert that a prose-only
fallback repair is still rejected. Exercise source-authorized branches through the
actual existing action validator with synthetic recipient proposals and evidence,
not only through mocked `accept` verdicts or valid JSON parsing. This is an offline
test/evaluation technique, not a new production model stage or a general natural-
language-to-test compiler.

Include differential controls: “agree on another time if neither works” versus
“collect another time and report back; do not agree”; alternative-only versus common
conditions; equivalent unranked options versus explicitly ordered fallbacks; flexible
bounds versus explicit date/price restrictions. These controls must detect both
accidental narrowing and invented permission. A source-authorized original branch
must not acquire evidence obligations that only apply to the fallback.

Run focused preparation, profile, approval/projection, voice admission/action,
summary-source/calendar/assessment, translation and credit tests. Use disposable
databases for integration tests, never the user's working or production database.
Complete repository-required checks before release.

### B. Repeated real-model comparison

Freeze the corpus and expected material outcomes before comparing variants. Use at
least 24 fixtures across all seven supported interface/call-language families,
including cross-language tasks, with three repetitions per variant (at least 72
baseline and 72 candidate preparations). Run at least ten repetitions of the
incident family per variant, including paraphrases and different party names.
Interleave variants; pin reference time, model, tier, input and schema. Set an
explicit provider-spend cap before execution and stop when it is reached.

Cover general enquiries, message delivery, booking/confirmation/rescheduling/
cancellation, optional/fallback branches, no-action outcomes, prices/dates,
corrections, ambiguous versus explicit roles, reference codes, hypothetical tasks,
quoted instructions and real product-policy violations. Include valid alternative
wordings as positive controls and at least two material mutations per fixture as
negative controls. Adjudicate disputed labels against the task and complete
execution context; do not use the candidate auditor as its own ground truth.

Report first-pass acceptance, final acceptance, false blocks, accepted material
mutations, unresolved findings after repair, repair-introduced defects, provider
calls/cost and latency. Count all
failures and incomplete runs; no best-of selection or silent replacement retries.
Release requires:

- Zero accepted critical mutations in the evaluated safety/authority/identity set.
- Zero observed losses of the incident's fallback, qualifiers or actual participants
  after correction, and no incident-family block caused solely by equivalent wording.
- Zero accepted prose-only fixes for missing executable branches. In incident
  fixtures, initial and evidenced fallback proposals must pass the unchanged action
  validator, while fallback use without required evidence and source-forbidden
  commitments must still fail. Do not count a correct audit block of a defective
  generated plan as an auditor false positive.
- Fewer adjudicated false blocks on the targeted corpus and no newly systematic
  failure in another supported family. If baseline has no such failures, repeated
  comparison must still establish the incident and negative-control gates.
- No extra orchestration stage or enlarged retry/request/deadline budgets. Report
  p50/p95 latency and cost against baseline; investigate regressions rather than
  claiming that an unchanged number of stages guarantees equal cost.

These are finite-sample release gates, not a claim of universal accuracy.

### C. Voice and post-call evidence matrix

Replay fixed conversations/action journals against both historical and newly
prepared plans. For model-evaluated outcomes, use predeclared expected verdicts
and repeated trials, not byte equality of newly generated prose.

| Fixture | Required preserved result |
| --- | --- |
| Recipient rejects both slots, offers an authorized fallback and confirms it | Fallback action remains possible; evidence supports the reported result |
| Recipient accepts an initial slot; a conditional fallback is unused | No fallback-only requirement on the initial action or artificial unmet criterion in assessment |
| Source permits collecting alternatives but forbids agreeing to them | No invented fallback booking authority or successful-booking assessment |
| Availability or an offer without final confirmation | No invented confirmed booking or successful action |
| Conditional action correctly not taken because its prerequisite is false | No penalty for an inactive branch; unrelated requirements still evaluated |
| Genuine negative task answer | Substantive conversation can be recognized independently of task achievement |
| Greeting/consent/readiness only | No invented substantive answer or task success |
| Wrong party, price, date, reference or unsupported commitment | Existing authority/evidence rejection remains effective |
| Correction, contradictory/noisy evidence, missing or partial transcript | Existing uncertainty/partial-coverage handling; no upgraded verdict |
| Another summary language, retry, duplicate callback or old saved result | No independent regrading, double settlement or historical mutation |

Check unchanged grounded citations, original transcript IDs, source/context hashes,
calendar evaluation, canonical credit evidence and result reuse. Protect every
criterion's actual branch; do not drop checks to make an evaluation pass.

After offline and model gates, run a small controlled local telephone acceptance
covering a normal enquiry and a conditional appointment, including closing and
post-call assessment. This is a future acceptance step, not a call authorized or
performed by recording this plan.

## 9. Delivery sequence and recovery

1. Capture both incident families, effective prompt hashes and compatibility
   assertions, including execution tests for initial/fallback branches.
2. Implement the shared existing-authority explanation, narrow audit threshold and
   effective minimal correction under the new preparation version.
3. Pass offline, repeated-model and voice/assessment gates; record all results.
4. Activate locally through the existing audited profile mechanism after draining
   work. Confirm API/worker parity, new-plan behavior and historical readability.
5. Evaluate the separate review-translation fix against its own positive/negative
   and unchanged-summary gates; do not couple an unproven fix to preparation rollout.
6. Build the reviewed immutable release and use the established deployment procedure:
   drain in-flight work, preserve a verified backup, align policy and process versions,
   check readiness, then reopen admission. Keep host-specific commands/evidence in
   ignored operational records, not this plan.

Do not hot-swap instructions under an in-flight pinned preparation. Historical
approved plans and saved assessments retain their original data. If a candidate
causes a critical regression, stop admitting new affected preparations, preserve
diagnostics and restore the previous preparation policy on a compatible build after
draining work. A binary rollback also needs compatible policy readers; never blindly
restart an old binary against an unknown new policy. Do not reset call history,
action journals, assessment evidence or credits. Translation rollback is separate.

Monitor material mutation escapes, false-block reasons, changed model responses,
repair regressions, call action failures and post-call outcome drift. Successful
readiness or a higher preparation pass rate alone is not release acceptance.

## 10. Completion record

- [x] Compare source, local incident and owner-provided production audit evidence.
- [x] Record the proposed design, compatibility boundaries and acceptance gates.
- [x] Incorporate the “short meeting” incident and verify its executable defect
  with the unchanged validator; require structural, correctly scoped repairs.
- [x] Implement versioned preparation changes and incident regressions.
- [x] Complete the authorized USD 5 local API evaluation, retain all intermediate
  failures and budget stops, and activate the final preparation instructions locally.
- [ ] Complete paired model evaluation and negative controls.
  The narrower USD 4 follow-up includes two paired 48-case replays, three targeted
  final preparations and 11 real audit controls/rechecks. Six planned controls were
  not dispatched within the conservative allowance; the full release gate is open.
- [x] Verify unchanged voice, approval, assessment and credit code/contracts through
  the complete offline suite and fixed-snapshot comparisons. Real telephone acceptance
  remains a separate gate.
- [x] Resolve and validate the isolated review-translation fix under the user's
  revised display-only validation requirement; activate it locally.
- [ ] Complete local telephone acceptance and reviewed production rollout.

Historical pre-implementation baseline verification on 13 November: 86 tests passed across holistic
preparation, text processing and native appointment authorization. These tests ran
against unchanged code. They are investigation evidence, not validation of the
proposed simplification. No paid model experiment, telephone call, runtime restart,
policy activation or deployment was performed during that initial planning stage.
The follow-up investigation also ran eight offline validator probes: four against
the two exported authorities and four against an in-memory corrective example.
These establish the field-semantics defect and existing runtime support, not the
future generator's reliability. Application source and stored plans were unchanged.
