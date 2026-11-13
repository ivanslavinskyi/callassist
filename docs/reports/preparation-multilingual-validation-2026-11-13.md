# Multilingual plan preparation: USD 4 evaluation

13 November 2026. Result: the incident family improves, but preparation is not yet
consistently reliable across the tested scenarios. Both avoidable audit blocks and
accepted canonical-language defects remain. This report does not recommend removing
the semantic auditor or changing the stable voice runtime.

## Scope and method

The user authorized a **new, separate USD 4 budget**, specifically for plan
preparation. The production `OpenAIBriefCompiler` was called locally with real API
requests, input/output moderation, generation, deterministic assembly, semantic
audit and the existing single recovery. No mock verdicts, display translations,
telephone calls, database jobs, approvals or post-call assessments were generated.
The queue/UI and live telephone behavior are outside this experiment.

The frozen primary corpus contained 30 scenarios and 38 preparations: one run per
scenario plus two extra trials each of the original meeting, its short-meeting
paraphrase, collect-only fallback, and conditional opening-hours enquiry. Inputs
covered English, Russian, German, French, Italian, Ukrainian, Polish and a mixed
English/Russian task. Call locales covered all seven supported variants: `de-CH`,
`de-DE`, `fr-CH`, `it-CH`, `en-GB`, `en-US`, `ru-RU` (five spoken languages).

Cases covered initial/fallback slots, collection without booking authority, bounded
fallbacks, price/deposit restrictions, discrete versus earliest slots, corrections,
cancel/reschedule/attendance confirmation, status-only enquiries, conditional and
optional questions, message delivery, benign third-party information, quoted
untrusted instructions, and missing existing-appointment details.

Expected statuses and structural constraints were fixed before dispatch. Offline
probes exercised the unchanged native appointment validator on generated authorities,
including initial/fallback authorization, missing evidence and price boundaries.
Final plan text was also inspected manually: automatic status/structure checks alone
missed the Polish objective embedded in an Italian plan.

After the primary run, five problematic cases were selected for two extra trials
each. These 10 **targeted rechecks** are a separate, failure-enriched sample, not a
replacement for failed primary runs. Every outcome and intermediate audit finding
was retained. No production instruction, schema, model, tier or runtime setting
was changed between trials.

Configuration:

- Policy: `preparation-live-holistic-2026-11-13`.
- Generator: `gpt-6-luna`, fast tier; auditor: `gpt-5.6`, default tier.
- Reference time: `2026-11-13T08:00:00.000Z`; default zone Europe/Zurich.
- Existing 120-second preparation / 35-second request limits and one shared recovery.
- In-memory evaluation policy revision 1; local application policy revision 22
  remained unchanged. Effective policy instructions and provider settings match.
- Generation hash: `a7db07eb5c42b38c86b0bfa6eb98d3a9a3e8ad40f629fb56bbeba8cb3f5c2699`.
- Audit hash: `2d2f047ef66e3160d4048f2e43ff536ec0036ddf7f0c40da66d150e4dc046518`.
- Primary corpus hash: `2371943ae9064ccee8565de0092c64d0b283d0b931f566b5f5be5d474d53b629`.
- Recheck corpus hash: `36401e81da02b6399b52282cff0a77303c79eaf1061870eca5ad8501c4cfcb62`.

## Outcomes

| Outcome | Primary, 38 runs | Targeted rechecks, 10 runs | Total |
| --- | ---: | ---: | ---: |
| Ready without recovery | 19 | 3 | 22 |
| Ready after recovery | 15 | 4 | 19 |
| Blocked after recovery | 3 | 1 | 4 |
| Technical preparation error | 1 | 2 | 3 |
| Ready but canonical-language defect found manually (subset of ready) | 1 | 2 | 3 |

Thus 41/48 preparations were marked ready, but three of those retained a known
language defect. Do not report 41/48 as semantically correct. The targeted sampling
does not estimate an overall production error rate.

The original English-to-Russian meeting and short-meeting variants were ready in
all six trials and retained executable initial/fallback branches. Four of those
six required recovery just to correct `sourceLanguage`. Collect-only, restricted
dates, explicit price limits and no-action scenarios retained their tested authority
boundaries. No widening of the probed forbidden booking slots/actions was observed;
this is a finite set of probes, not a general safety proof.

Primary end-to-end compiler latency: p50 **12.311 s**, p95 **22.352 s**, maximum
**24.575 s**. Half of primary preparations used recovery. The primary serial run
took about 449 seconds of measured preparation time. There is no paired old-policy
baseline in this experiment, so these results do not quantify improvement over it.

## Reproduced problems

| Scenario | Three trials including the original | Evidence and interpretation |
| --- | --- | --- |
| French input → Italian meeting | 2 ready, 1 blocked | First rejection correctly removed excluded fallback dates. The next rejected `required:true` although the question itself and follow-up were conditional. A recheck accepted an equivalent conditional question with `required:true`. This is inconsistent audit treatment of representation. |
| French input → English consultation, maximum CHF 120 | 1 ready, 2 blocked | Initial language errors consumed recovery. Both final blocks concerned duplication of the price cap in prose requirements and `limits.maxTotalPrice`; the ready trial contained the same kind of duplication. On all three saved authorities, the unchanged action validator allowed a quoted CHF 120 proposal and rejected CHF 121. The final block did not identify a lost or widened numeric limit. |
| Cancellation without date/time/reference | 3 technical errors | The generator initially requested missing appointment details. The auditor demanded removal of that clarification because details could be obtained during the call. Repair then generated `operation:cancel` with `existingAppointment:null`, rejected as `NATIVE_AUTHORITY_INVALID` / `OPENAI_RESPONSE_INVALID`. The auditor's instruction conflicts with the current immutable execution contract. |
| Mixed English/Russian input → German information enquiry | 2 ready, 1 blocked | First rejection repaired an explicit speaker identity error. The next blocked only because `sourceLanguage` was `mul` instead of `ru`. The two successful rechecks also spent recovery correcting this display-language metadata. No new execution defect was cited in that final block. |
| Polish input → Italian general information for a family member | 3 ready, all with the same defect | `localizedObjective` remained the original Polish paragraph; the surrounding plan was Italian. The raw generated candidate and assembled execution both contained it. The auditor accepted it in all three trials. This is not an artifact introduced by display translation. |

The missing-appointment case expected `needs_clarification` under the existing
contract. It is not counted as a task that should simply be permitted to execute.
The native validator correctly rejected the invalid repaired authority in every
trial. No call was started from any evaluated plan.

The auditor also made useful corrections: wrong execution language, an invented
currency on a fee prohibition, an excluded fallback period, and explicit identity
confusion. Its complete removal would lose these protections. The evidence points
to inconsistent materiality and capability rules, alongside generation errors.

## Next preparation-only changes to evaluate

Subsequently implemented and evaluated under the user's authorization:
[preparation v2 follow-up](preparation-reliability-v2-2026-11-13.md). The baseline
results and recommendations below remain the frozen pre-change evidence.

1. Align the generator and auditor with actual supported authority: cancel,
   reschedule and attendance confirmation require an exact existing appointment in
   the approved snapshot. Missing binding information must lead to clarification,
   not a fictional ability to fill immutable authority during the call.
2. Separate display-language metadata from blocking execution checks. An uncertain
   dominant input-language label should not exhaust the sole repair for an otherwise
   valid plan; preserve language-selection fallback behavior explicitly when changing
   this. The language of the entire canonical execution plan remains mandatory.
3. Resolve the contradiction between materiality and representation rules: scope
   conditional questions clearly during generation, and do not block solely for
   equivalent wording or redundant limits that preserve the authorized behavior.
   Source-required distinct conditions and actual authority/evidence errors still
   need enforcement.
4. Strengthen whole-plan language adherence in the existing generation/audit request,
   including `localizedObjective`. Use the repeated Polish→Italian escape as a fixed
   regression. Do not delegate this to the voice runtime or display translator.

These are follow-up recommendations, **not changes made during this evaluation**.
Keep the same voice schema/prompts, admission/action validator, canonical snapshots
and post-call evidence/assessment contracts. Re-evaluate all retained failures and
the successful controls under a separately versioned preparation policy before
claiming this broader reliability problem is resolved.

## Cost, artifacts and reproduction

238 provider requests were dispatched: 188 primary and 50 targeted. Recorded token
usage gives an estimated total of **USD 0.696105**. The cumulative conservative
bound is **USD 1.356877**, below the independently authorized USD 4. These estimates
use repository tariffs; they are not a provider invoice.

Each request reserved its worst-case bound before dispatch. Only completely matched
completed usage was reconciled between cases; unknown, mismatched or incomplete
requests retained full reservation. The recheck invocation recomputed and carried
the entire primary ledger bound of USD 1.070194. No new allocation was started for
the rechecks. Four offline budget tests passed. Reinvocation refuses to overwrite
an existing run and silently spend another allocation.

Tracked reproducible inputs and harness:

- [Corpus and expectations](../../apps/api/scripts/preparation-multilingual-corpus.mjs).
- [Live compiler evaluation](../../apps/api/scripts/evaluate-multilingual-preparation.mjs).
- [Budget logic](../../apps/api/scripts/preparation-evaluation-budget.mjs).

From `apps/api`, `node --use-system-ca --import tsx scripts/evaluate-multilingual-preparation.mjs`
is a no-spend dry-run. `--live` dispatches paid requests; `--recheck` uses the completed
primary ledger and fixed targeted subset. The existing run directories deliberately
prevent accidental reruns; another allocation requires explicit authorization.

Full inputs, candidates, audit findings, operations and ledgers are retained under
ignored `.tools/runtime/preparation-multilingual-2026-11-13/` and
`.tools/runtime/preparation-multilingual-rechecks-2026-11-13/`. No application source,
production process, working database, voice behavior or post-call evaluator was
modified by this testing work.
