# Preparation reliability follow-up, 13 November 2026

Scope: preparation only, using the remainder of the existing USD 4 evaluation
allocation. No telephone call or production deployment. Implementation and the
budgeted preparation evaluation are complete; broader release acceptance remains open.

## Implementation

The named native profile selects `preparation-live-holistic-2026-11-13-v2`.
Both earlier holistic policies keep their exact prompts and provider schemas for
pinned jobs. The new version keeps one generator, one semantic auditor and the
existing single recovery, models, service tiers, deadlines and request limits.

- Generation and audit name the selected call language explicitly, including
  `localizedObjective` and all other canonical prose. Schema descriptions reinforce
  this; accepted fields and execution schemas are unchanged.
- `sourceLanguage` stays stored, structurally validated and available to existing
  display-language selection. It is omitted from the new semantic audit request;
  uncertainty about this advisory label does not consume semantic recovery.
- Generator and auditor share the actual immutable-authority boundary: cancellation,
  rescheduling and attendance confirmation require the exact existing date/time
  before approval. A needed clarification must remain; conversation cannot fill
  that missing authority during a call.
- Conditional questions remain conditional. An identical price cap duplicated in
  requirements and a typed limit is not alone a rejection reason. Lost permissions,
  changed bounds, missing typed limits and incorrect language still require repair.
- The final instructions distinguish delegated agreement from separate renewed
  principal approval, resolve ordinary recipient references from trusted parties,
  use the trusted clock for an unambiguous upcoming month/day, and preserve ordinary
  nonbinding clarification. Mandatory question topics remain mandatory; irrelevant
  omissions in an already blocked clarification stub are not independent defects.
- General information requests retain their general scope instead of demanding a
  narrower subject from the user. Faithful name transliteration/inflection is allowed.
  The auditor is explicitly told that alternative order already enforces earlier
  unavailability, and that a readback instruction elsewhere in the complete plan
  need not be repeated literally in every question example.

The implementation is in
[the preparation contract](../../apps/api/src/brief-compiler/reliable-preparation-contract.ts)
and [audit request assembly](../../apps/api/src/brief-compiler/holistic-preparation.ts).
No new semantic regex, intermediary execution format, translation stage or runtime
instruction was introduced.

## Protected behavior and offline verification

SHA-256 comparison against the start of this implementation found no changes in
103 production files covering voice, appointment actions, text processing, credit
handling, execution contracts and call service. The preparation policy registry is
the deliberate contract exception: it adds a supported version, not execution fields.
This baseline includes the already completed independent display-translation fix.

Identical candidate fixtures across all three holistic policies produce identical
compiled execution data, approval snapshots, voice projections and post-call summary
inputs. Earlier material-policy prompt/schema hashes are pinned by regression tests.
API TypeScript checking, 1,479 API tests and 290 contract tests passed. After the final
instruction adjustment, the 115 affected preparation/budget tests passed again.
The final API production build and migration-file copy completed successfully.
These are offline compatibility checks, not real telephone or paid post-call trials.

## Paid evaluation design

The unchanged corpus contains 30 scenarios, seven authored languages plus mixed
input, and all seven supported call locales. The paired set is the same 48 keys:
38 original runs plus the ten targeted rechecks from the baseline. Models remain
`gpt-6-luna` / `fast` and `gpt-5.6` / `default`, with the same frozen reference time.
The paired corpus hash is
`4a5fdbf3fc10b2a41a020f90714261d50b65bf74081445e3a7c79646ffe3dfc1`.

The [baseline](preparation-multilingual-validation-2026-11-13.md) had 41 ready,
four blocked and three technical errors; three ready plans still had Polish
objectives in Italian execution. Twenty-six runs used recovery.

The first development iteration completed all 48: 43 ready, four clarifications
(one unnecessary), one blocked, no technical errors; 14 recoveries. All three
Polish-to-Italian final objectives were translated, including one repaired language
defect. All three missing-appointment cases requested clarification. This iteration
also exposed an accepted additional principal-approval prerequisite, an invented
recipient-identity clarification and an unnecessary year question. Those findings
motivated the final general instruction corrections and another full replay.
The intermediate candidates and failures are retained; they are not final-version
validation. No v2 policy was activated while its instructions were being refined.

## Results and limits

| Same 48 cases | Baseline | First iteration | Second full replay |
| --- | ---: | ---: | ---: |
| Ready | 41 | 43 | 44 |
| Correct missing-appointment clarification | 0 | 3 | 3 |
| Unnecessary clarification | 0 | 1 | 1 |
| Blocked | 4 | 1 | 0 |
| Technical error | 3 | 0 | 0 |
| Recovery used | 26 | 14 | 13 |
| Expected status | 41 | 46 | 47 |
| Latency p50 / p95, seconds | 12.494 / 20.187 | 9.090 / 23.090 | 9.345 / 21.448 |

The second replay had no hard block or technical error. All final objectives were
in the call language; none of the previous three accepted Polish objectives escaped.
However, the last Polish information trial introduced a question about the type of
application after its language repair. That unnecessary clarification is a retained
failure, not counted as a successful full replay. The subsequent general-enquiry
instruction corrected this family in **three further real preparations out of three**,
all ready in Italian on the first candidate, without clarification.

Six second-replay records retain two strict harness failures: it assumed an initial
appointment should need no common requirement evidence. Their common requirements
were the source's own 15-minute duration (sometimes also its AI topic), not an
invented prerequisite. Supplementary probes against the unchanged validator accepted
all six initial appointments with supporting recipient evidence and rejected them
without that evidence. Four price probes accepted CHF 120 and rejected CHF 121.
The original failure flags and expectations were not edited away. These probes test
the authority/evidence interface, not the voice model's ability to extract evidence.

### Audit controls and final narrow corrections

Nine of 15 planned controls reached the provider before the reservation guard stopped
the next dispatch. Five defective controls were correctly revised: unnecessary year
clarification, missing fallback, wrong time, wrong participant and foreign objective.
The conditional `required:true` positive control was accepted. Three positive controls
were falsely revised because the auditor wanted earlier-unavailability text repeated
in fallback requirements; two also objected to a compact readback example despite
the complete plan already requesting date/time/purpose readback.

The unchanged runtime already requires evidence for every earlier alternative by
position. This was made explicit in the preparation instructions, together with
whole-plan readback interpretation. Two final real audit probes then **both passed**:
the same valid plan was accepted and the plan with the wrong time was revised for
the actual wrong time. These two short diagnostic verdicts used a 512-output-token
cap so the entire pre-request reservation fit the remaining allowance. Production
audit limits remain 2,048; the corpus runs used unchanged production limits.

The six unexecuted controls concern additional/observed principal approval, an
existing-appointment clarification, an unnecessary information clarification and
duplicated/missing typed price caps. They are not reported as passed. The full 48-case
replay preceded the last narrow clarification/name/implicit-runtime explanations;
the final revision has the three targeted preparations, two final audits and repeated
offline tests, not a fresh complete 48-case replay. Remaining coverage is explicit.

The auditor remains probabilistic. Excessive wording/name objections and inconsistent
treatment of equivalent representations occurred during development. This work
reduces the observed failures; it does not prove zero false rejections or universal
semantic correctness. In particular, p95 latency did not improve in this sample even
though median latency and recovery frequency decreased. No production rollout or
new model/voice/post-call behavior is justified merely by readiness percentages.

### Shared USD 4 accounting

| Phase | Provider requests | Usage estimate, USD | Cumulative conservative bound, USD |
| --- | ---: | ---: | ---: |
| Previous baseline plus rechecks | 238 | 0.696105 | 1.356877 |
| First 48-case iteration | 220 | 0.681525 | 2.484445 |
| Second 48-case replay | 217 | 0.654535 | 3.648745 |
| Three clarification rechecks | 12 | 0.031630 | 3.701776 |
| Nine dispatched audit controls | 9 | 0.106526 | 3.864921 |
| Two final contract checks | 2 | 0.028041 | **3.900401** |

Total token-based estimate: **USD 2.198362**; retained conservative bound:
**USD 3.900401 / 4.00**. The earlier, separate USD 5 allocation is excluded.
The refused tenth control made no provider request. The final small checks carried
every earlier ledger, including the budget-stopped phase; they did not reset the
allocation. No additional paid request is planned under this grant.

### Local activation

Activated locally after confirming zero active calls, preparations and running jobs.
The existing audited configuration command changed preparation policy revision
22 → 23, from `preparation-live-holistic-2026-11-13` to
`preparation-live-holistic-2026-11-13-v2`. Only the local API and worker were restarted.
Voice identity remains `live-plan-only-2026-11-12.2`; models, tiers and consent
settings are unchanged. Existing plans were not rewritten.

At 10:54 UTC, API liveness/readiness, worker readiness and the local web UI all
returned 200. The tunnel's private API stayed inaccessible; unsigned and empty
signed webhook requests were rejected as expected. These checks placed zero calls.
The local UI is available at `http://localhost:3000/ru`. Production is unchanged.

## Reproduction and evidence

- [Unchanged corpus](../../apps/api/scripts/preparation-multilingual-corpus.mjs).
- [Compiler harness](../../apps/api/scripts/evaluate-multilingual-preparation.mjs):
  `--candidate` carries the baseline and recheck ledgers; `--followup` also carries
  the first candidate ledger and replays the identical 48 keys. Add `--live` for
  actual requests; otherwise these are no-spend checks.
  `--clarification-recheck` carries all earlier phases and repeats the information
  case three times.
- [Audit controls](../../apps/api/scripts/evaluate-reliable-preparation-controls.mjs)
  carry all five compiler phases before dispatching any request. `--verify-contract`
  additionally carries the stopped control ledger and uses the diagnostic 512-token cap.
- [Budget accounting](../../apps/api/scripts/preparation-evaluation-budget.mjs)
  reserves the worst-case cost before dispatch. Unknown or incomplete usage keeps
  its reservation; only matched completed operations permit reconciliation.

All output directories refuse overwrite. Complete candidates, provider operations,
prompt hashes and budget ledgers remain in ignored `.tools/runtime/` under
`preparation-multilingual-v2-2026-11-13/`,
`preparation-multilingual-v2-followup-2026-11-13/` and
`preparation-multilingual-v2-clarification-2026-11-13/`,
`preparation-reliable-controls-2026-11-13/` and
`preparation-reliable-contract-recheck-2026-11-13/`. Tariff-based usage estimates and
conservative bounds are not a provider invoice. No new USD 4 allocation is created.
