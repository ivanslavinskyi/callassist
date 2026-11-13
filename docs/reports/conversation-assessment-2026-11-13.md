# Conversation-based post-call assessment — 13 November 2026

Summary v9 evaluates the approved task against the original conversation. A missing
or mismatching internal appointment journal no longer downgrades a confirmed spoken
agreement; a journal also cannot promote missing conversation evidence to success.
This fixes the diagnosed local case described in
[the incident record](local-call-assessment-downgrade-2026-11-13.md).

## Implementation boundary

- The evaluator receives the approved task, conditions, original transcript and
  call timestamps. Internal action journals are removed from its input and retained
  only in frozen server provenance and diagnostics.
- The post-call projection uses the cited conversation outcome for book,
  confirm-existing, reschedule and cancel. It retains approved calendar rules,
  exclusions, time-zone/past-date checks, competing candidates, corrections and
  replacement of the prior appointment. Unmet criteria still prevent full success.
  Semantic restrictions such as price, duration and conditional branches remain
  part of the model's assessment; code does not infer these from a bare “yes”.
- An optional, server-derived `appointmentResult` preserves the existing UI card.
  It requires explicit approved appointment authority and a concrete cited slot.
  It uses the represented person frozen with the original compilation. The model
  cannot supply this card directly. General tasks and inactive conditional branches
  do not acquire a booking card. Cancellation is shown as cancellation, without a
  new-booking calendar projection. The existing recipient-confirmation disclaimer
  and all seven UI locales are retained.
- Version v9 is explicit. Historical ready reports and queued v8 jobs retain their
  old contract. Publication may create a new display assessment revision without
  rewriting the canonical billing assessment or charging again. Copy/PDF do not
  append a contradictory journal warning to a v9 report.
- Voice instructions, live tools, action authorization, turn handling, closing and
  credit settlement code are unchanged. No migration is required.

## Verification

- API: 165 unit-test files, 2460 tests passed, including the voice regression suites.
- PostgreSQL: 34 tests passed for artifact publication and assessment/settlement,
  using an isolated temporary test database.
- Web: 81 files, 514 tests passed. Includes the German appointment-card wording,
  every operation in every UI locale, historical fallback, foreign-attempt hiding,
  general tasks and copy/PDF consistency.
- Contracts: 26 files, 290 tests passed.
- The exact retained transcript, compilation and provider output of the last local
  completed call were replayed without a new model request. The old v8 projection
  reproduces `partial`; v9 produces `achieved` and a confirmed 25 November 2026,
  10:00 Europe/Zurich appointment card. All three criterion decisions are unchanged.
  The internal journal remains absent. Private transcript/evidence files remain
  under the ignored local `.tools/runtime` directory.

These are offline and local database checks, not a new paid evaluation of the
model prompt or a fresh telephone call. Production rollout is separate.

## Local activation

API and worker were restarted only after verifying there were no active calls,
preparations or jobs. The voice implementation remains
`live-plan-only-2026-11-12.2`; SHA-256 comparisons confirmed that all 61 protected
voice/action/billing files are unchanged. API build, API/web/contracts typechecks
and diff checks passed. API liveness/readiness, worker readiness and the local web
page all returned HTTP 200.

The last call received a separate local v9 artifact by recomposing its retained,
validated provider output. The previous artifact, canonical billing evidence and
credit transaction rows were verified unchanged. The frontend's actual artifact
selection and evidence checks select the new `achieved` result. A headless browser
rendered its appointment card using the application component and current styles:
German wording/disclaimer, desktop and mobile widths passed, with no browser errors.
No new model requests or calls were made. The replay's source artifact/chunk and
new artifact IDs are recorded in the ignored local publication report.
