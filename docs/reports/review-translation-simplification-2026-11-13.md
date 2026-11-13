# Display translation simplification

13 November 2026. Implements the user's explicit request to treat plan translation
as a reading convenience. Local verification only; no production deployment or call.

## Diagnosis

Both latest saved tasks were `ready_for_review` with the same source objective.
One used English as its call language and needed no English review translation.
The other used Russian as its call language and requested an English display copy.
Its three translation requests returned HTTP 200 but were rejected locally as
`TEXT_INVALID_SCHEMA`; this was separate from preparation's semantic/safety audit.
The old raw rejected responses were not retained, so their exact offending tokens
cannot be reconstructed. Independent fixtures reproduce the false positive.

The new live retry makes the defect concrete: it returned all 26 fields, preserving
the fictional 15-minute meeting, both dates/times, conditional alternative and final
confirmation. Running that same response through the old validator rejects five
fields containing naturally translated `15-минутной` / `15-minute`. The identifier
heuristic requires literal token equality across languages. It cannot reliably
distinguish a numerical compound from an opaque code.

## Change and boundaries

New `plan_review` and `clarification_review` artifacts validate only JSON structure,
exact field count/order/IDs, nonempty bounded text and source compilation/hash
binding. Meaning, names, numbers, codes, negations and conditions remain obligations
of the existing translation prompt. There is no new auditor, repair stage or retry
budget. Removing literal comparisons intentionally gives up their rejection of
changed literals in display text; structural checks do not prove translation accuracy.

Only these artifact identities gain `review-translation-v1:`. Ready historical
translations and their approval receipts remain reusable. Queued old reviews retain
their pinned validator. A failed old review gets a new deduplicated artifact on retry
only for its still-current source, preserving failed evidence. Review generation and
retry use the compilation's pinned review model.

`TEXT_PROCESSOR_VERSION`, transcript validation, `summary-v8` identity, summary model
instructions, grounding helpers, original transcripts, assessment and credit logic
are unchanged. The shared provider module only forwards the validation options.
No voice source changed: the runtime remains `live-plan-only-2026-11-12.2` and still
receives the canonical approved plan. The display translation is not injected into
voice execution or post-call assessment. Approval/source binding is unchanged.

## Verification

- Text processing: 186 tests passed, including multilingual numerical compounds,
  formatted dates/times/amounts, malformed output, historical migration/deduplication,
  stale source rejection, pinned models and approval/voice source isolation.
- API boundary suite in a disposable database: 42 files, 875 tests passed, covering
  text processing, voice, credit/assessment and text storage. This includes the
  186 text tests; the totals are not additive.
- Web projection/language/capabilities: 18 tests passed.
- API TypeScript check, production bundle and migration copy passed.
- Live API retry: one request, 26 fields, `ready`. The complete saved canonical
  compilation and prior failed artifact remained equal before/after the retry.
  Manual inspection retained duration, dates, fallback condition and confirmation.
- Local API and worker restarted after an idle check. UI, API readiness, worker
  health and public gateway route protection passed. Preparation policy stayed at
  revision 22; voice and consent configuration were unchanged.

## Budget

This continues the original USD 5 authorization, rather than starting a new budget.
The complete prior-run conservative bound was USD 3.573924 after reconciling only
fully matched completed request/usage records. Unknown earlier requests retained
their full reservations. The follow-up allowed one request with an additional
USD 0.60 hard cap, reserved before network dispatch.

The request reserved USD 0.434380. The cumulative conservative bound is therefore
USD 4.008304, below USD 5 even without releasing this reservation. Its recorded
usage estimate is USD 0.016335; this is an estimate, not an invoice. Per-request
accounting and private source/translation evidence remain in ignored local runtime
records. No additional call or production action was performed.
