# Preparation reliability: implementation and bounded evaluation

Date: 13 November 2026. Base: `stable-2026-11-12`,
`56ca2fcfb5cfba2d5800eb14903f3fffba36e932`.
Scope: the user authorized implementation, tests and local paid API evaluation with
a total USD 5 ceiling, and explicitly required unchanged voice behavior. No telephone
calls or production deployment are part of this work.

## Implemented boundary

`preparation-live-holistic-2026-11-13` selects new preparation instructions and schema
descriptions. The previous policy remains supported with byte-identical prompt and
provider-schema hashes. Both use compiler 17, plan schema 11, approval 10 and the
same assembly, snapshot hashes and bounded recovery. The new policy is selected by
the native profile's preparation metadata; models, service tiers and voice settings
are not changed by activation.

Writer and reviewer share the meaning of executable alternatives, time membership,
common/branch conditions and limits. Authorization is read from the entire requested
outcome, including conditional agreement versus collecting suggestions. Repairs
must fix the actual structure, flags or metadata while preserving unrelated content.
`taskType` distinguishes nonbinding enquiries from appointment actions. Essential
questions are required; conditional questions retain their branch scope. The auditor
also treats risk categories and blocking questions as enforced publication decisions:
an erroneous flag must be repaired, and audit acceptance does not silently clear it.
It judges material execution differences in the whole context, not editorial choices
or isolated pronouns, and may give actionable structural feedback in its existing
bounded message. Real errors still block after the single recovery is exhausted.

No changes were made to voice prompts, opening/pronunciation, turn handling, hangup,
recording consent, action tools/validators, summary instructions, evidence validators,
canonical assessment reuse, settlement or credit logic. There is no database migration,
historical rewrite, automatic regrading, new model stage or additional recovery.

See [implementation](../../apps/api/src/brief-compiler/material-preparation-contract.ts),
[compatibility tests](../../apps/api/src/brief-compiler/material-preparation.test.ts)
and the [plan](../plans/preparation-audit-reliability-2026-11-13.md).

## Offline verification

- Complete API suite in a disposable PostgreSQL database: **212 files / 2711 tests passed**.
  The first full run exposed one stale expected preparation-policy string in an admin
  readiness test; it was updated and the complete suite rerun successfully.
- Contracts: **26 files / 290 tests passed**. Web: **81 files / 505 tests passed**.
- Targeted preparation and evaluation-budget regressions were rerun after the final
  instruction/schema-description edits: **75 tests passed**, including an added
  regression proving audit acceptance cannot bypass a retained policy category.
- Type checking passed for API, contracts and web; API bundle and migration copying
  passed. No working application database was used for integration tests.

The fixed-candidate comparison proves identical compilation snapshots, voice context
and post-call input across old/new policies. Removing descriptions from the new
provider schema gives the exact old schema, including limits and required fields.
Both policies run the complete existing preparation/recovery tests. Appointment
regressions exercise the unchanged real validator: initial slots, conditional fallback,
missing earlier-option evidence, missing requirement evidence, invented quotes,
wrong parties and unapproved terms. A fallback present only in prose still fails.
The full suite includes voice, approval, post-call source binding, uncertainty,
calendar/action checks, canonical assessment reuse and credit settlement.

## Paid evaluation and limits

The harness invokes the real local compiler and OpenAI endpoint with synthetic tasks;
it creates no calls, app users, approvals or durable jobs. Frozen reference time:
`2026-11-13T08:00:00Z`. Generation: `gpt-6-luna` / fast. Audit: `gpt-5.6` / default.
These remain fixed through the comparison. Each API request is reserved before
dispatch; unknown or interrupted requests retain their complete conservative reserve.
Completed sequential runs are reconciled only when every dispatch has a matching
successful response, using the most expensive input tariff without caching discounts.
The next run carries the complete cumulative bound and also has an explicit additional
ceiling. Provider invoice cost is not claimed from token estimates.

Exploratory failures are retained, not replaced by the later successful outputs:

- The original policy reproduced a prose-only fallback failure and unnecessary common
  evidence obligations. The first candidate instructions still allowed inconsistent
  interpretation of agreeing an alternative versus only collecting a suggestion.
- Initial control fixtures omitted the hackathon participant role; the auditor caught
  that omission. The fixtures were corrected before judging the wording controls.
- A nonbinding availability task was assigned `appointment_coordination` with null
  authority. Preparation rejected the mismatch. Descriptions now explain the existing
  classification contract instead of weakening it.
- A French conditional enquiry marked its indispensable question optional; repair
  retained the wrong flag and changed source-language metadata to French. The single
  recovery correctly stopped. The final instruction explicitly covers flags/metadata
  and preserves the original task's language during repair.
- The early harness displayed local budget refusal through the compiler's generic
  provider error. Those incomplete rows are budget stops, not model-quality verdicts.
  The harness now records the stop distinctly and avoids further requests.
- A correctly ignored third-party quotation still produced a `prompt_injection`
  category, which the auditor accepted and the application correctly enforced as a
  block. Schema descriptions and audit instructions now explain that these are
  publication decisions, not informational tags. No category is cleared in code.

The progressive matrix covered 11 families and all seven supported call locales:
both original meeting wordings, collect-only suggestions, bounded fallback, document
information, conditional opening hours, corrected references, price limits, successful
no-action outcomes, quoted instructions and exact cancellation. Keep iteration
outcomes separate rather than presenting all earlier successes as final-version tests:

| Checkpoint | Completed preparations | Controls | Observation |
| --- | --- | --- | --- |
| Before final flag/metadata clarifications | 10 ready / 11 completed | 2 / 2 expected | Conditional French enquiry blocked; later corrected |
| Required-flag and repair regression | 11 ready / 11 completed | Not run | Includes three French conditional repetitions; remaining matrix stopped at budget reservation |
| Matrix completion / controls | 3 ready / 4 completed | 7 / 7 expected | Quoted-reference task falsely blocked by its category; no critical mutation accepted |
| Final category clarification | **5 ready / 5 completed** | **4 / 4 expected** | Both original meetings, three quoted-reference repetitions; false category and prose-only fallback rejected, valid and wording-only controls accepted |

The wrong-party control was correctly rejected in earlier runs, but its final
repeat did not dispatch because of the conservative budget ceiling. It is not
counted as a final pass. The other earlier negative controls rejected wrong time,
wrong participant, missing fallback and loss of fictional context. Some valid model
outputs still required the existing single recovery; this is not a zero-retry claim.
Checks on the meeting authorities use the real unchanged appointment validator,
including initial/fallback membership and missing-evidence rejection. Generated
objectives, criteria and conditional questions were also inspected; this is bounded
review of examples, not proof of perfect semantics or every branch of a future call.

**Aggregate conservative cost bound: USD 4.918227, below the USD 5 authorization.**
The first interrupted exploratory run retains its full USD 2.428695 reservation;
its exact billed amount is unknown. Later known usage is reconciled conservatively,
and the last run retains its full reservation. Failed, blocked, interrupted and
budget-stopped rows remain in the local evidence. These figures are not an invoice.
No additional paid calls were made after the final stop.

Reproduction: `eval:preparation:material --live` runs the bounded harness. For
continuation, `--previous-run=<evidence-directory>` carries the cumulative bound;
`--additional-budget-usd-micros=<limit> --dry-run` displays the entire calculation
without dispatch. Keep these arguments for a continuation of the same authorization;
starting a new independent run is not an authorization for another USD 5.
Evidence and per-request accounting are under the ignored local runtime directory.

This small USD 5 evaluation does not fulfill the plan's larger paired/repeated corpus
gate and cannot establish reliability over all possible tasks. Telephone acceptance
and production rollout remain separate.

## Local activation

After checking zero active calls, preparations and jobs, the existing audited profile
configuration changed the local preparation revision from 21 to 22. The final code
was loaded by restarting only the local API and worker after another idle check.
The voice version remains `live-plan-only-2026-11-12.2`; generation/audit models,
tiers and consent settings are unchanged. Local UI, API readiness and worker health
passed. The public gateway still rejects private API routes, unsigned webhooks and
signed empty call requests. No telephone call was placed. No production settings,
database or deployed process were changed.

## Separate translation track

At the end of this preparation implementation, the numerical-compound false positive
was still reproducible: `15-minute` and the
partial German `15-min` can be mistaken for opaque identifiers. An identical token
can also be a real reference code, so removing the guard or stripping hyphens would
accept changed codes. The plan explicitly gates this independent track when its
protections cannot be demonstrated. Eleven characterization/adversarial tests retain
both the false positives and checks against altered codes, phones, email, times and
amounts. No shared text processor version, summary instructions or grounding helper
was changed. That preparation implementation did **not** fix review translation.

The user subsequently authorized simpler display-only validation. The separate
[translation follow-up](review-translation-simplification-2026-11-13.md) records the
implemented fix, a successful retry of the saved incident, unchanged voice/assessment
boundaries, and continuation of the same USD 5 budget.
