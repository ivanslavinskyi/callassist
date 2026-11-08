# Native GPT-Live integrity implementation record

**Implementation checkpoint:** 2026-11-08.\
**Status:** implemented and checked locally; latest acoustic acceptance pending.\
**Branch:** `codex/live-audit-validation-2026-11-05`, with accumulated uncommitted changes.

This English record consolidates the [original implementation evidence](../archive/2026-11/live-native-integrity-implementation-2026-11-08.md)
and distinguishes it from the maintained [runtime specification](../native-live-runtime.md).
Test results and local activation below were recorded during implementation; they
were not rerun as part of the subsequent documentation update. A commit ID alone
does not identify the tested working tree. No public deployment was performed.

## Implemented scope

| Area | Result |
| --- | --- |
| Preparation | Integrity policy selects compiler 13 / plan schema 9 / approval 8; original task sources and progressive conversation order are preserved |
| Failure presentation | Optional typed issue carries reason, provenance, affected fields, retryability and next action; seven UI locales explain known causes without inventing a policy category |
| Numeric action evidence | Host-created receipts bind amounts/currency/free-service and required duration to literal recipient evidence; subsequent corrections are checked before confirmation and completion |
| Conditional completion | `end_call.noActionRequired` carries the approved condition and recipient quote for a resolved branch without an attempted action |
| Result evaluation | Summary-v8 / native-summary-v3 evaluates full original sources for schema-9 general and appointment profiles; goal achievement and action disposition remain distinct |
| Grounding repair | At most one targeted repair per eligible input, retaining the strict validator and shared request budget; every physical request is accounted separately |
| Long results | Bounded consolidation falls back to cited extraction with explicit partial coverage; a new overall assessment remains uncertain |
| History and presentation | Ready artifacts and canonical credit evidence remain immutable; failed v6/v7 native artifacts can create a new v8 revision; UI and notifications select the display assessment |
| Telemetry | Export v4 adds coverage and bounded host timing metrics; distinguishes loss, pending drain, legacy absence, privacy deletion and incomplete final usage |
| Expenses | Full-cohort breakdown by type/stage/model, usage provenance/finality and cost basis; Live duration and backend tokens remain separate |
| Diagnostics | Native paid probes require a distinct project/key, unique run ID and explicit admission budget with a local ledger |

The default preparation policy was not changed to the integrity policy. The verified
local database selected it with revision/audit provenance and used
`gpt-6-luna:default` for generation. Audit/review stayed `gpt-5.6:default`. The public
admin settings API changes generation/capacity, not `promptVersion`.
Native v2 still requires explicit local configuration and rejects production.

## Action and result boundaries

The numeric parser is conservative for supported EN/DE/FR/IT/RU/UK forms. It separates
fixed price from ranges, starting prices, hourly charges, supplements and waived
deposits. Free assessment is not free service; a genuinely free service does not
require a fabricated currency. Evidence receipts include literal quote, positions,
observed-text hash and validated values. Later contradictory numeric evidence can
make an action uncertain. Idempotent result delivery does not duplicate commitments.

Conditional no-action completion requires source and recipient evidence with no
attempted/unresolved action. An unknown condition or failed required booking does
not become success. The backend interprets semantic applicability; the application
validates authority, evidence origin and action state. No independent recipient
calendar integration was added.

Reports preserve operation, represented person, slot and original evidence. An
inactive conditional branch does not automatically lower achievement. Native
summary context v2 covers schema-9 general tasks as well as appointment tasks.
One repair is a per-input bound, not a whole-long-call guarantee. Partial coverage
is visible in the card, copied report, PDF and notifications in all seven locales.

## Verification recorded during implementation

No paid model probes or telephone calls were run during this implementation pass.

| Check | Recorded result |
| --- | --- |
| Contracts | 289 tests, 26 files |
| Web | 446 tests, 77 files |
| API full suite | 2,054 tests, 145 files |
| API checks after final boundary changes | Targeted sets of 84 and 71 tests; sets overlap and must not be added to the full count |
| PostgreSQL | 158 tests, 17 files, disposable isolated databases |
| API and web TypeScript | Passed |
| Local historical reads | 147 of 147, no read failures |
| Patch whitespace | `git diff --check` passed |

Database coverage included preparation admission/runtime, native privacy/transcripts,
retry, final assessment v3–v8, credits, telemetry/audio/expenses, runtime descriptors,
answer detection, historical result cutover, text storage, notifications and account
export. Display reassessment was checked separately from canonical billing evidence;
generating another report did not charge another user credit.

Local evidence files are ignored workspace artifacts, not portable repository
fixtures: `.tools/native-integrity-{api,web,contracts,pg}-final.log`,
`.tools/native-integrity-{api,web}-tsc.log`, `.tools/native-integrity-history-final.log`,
`.tools/native-integrity-boundary-final.log` and `.tools/native-integrity-final-boundaries.log`.
The source inventory was retained under `.tools/native-integrity-audit-20261108/`.

## Recorded local activation

The existing local database was preserved. API, worker, Next development server
and webhook tunnel were started; API/worker were restarted after the final source
changes. Startup was preceded by checks for active calls, preparations, paid queued
work and pending notifications. Future retention jobs were retained. Existing
preparation snapshots and approvals were not rewritten.

At `2026-11-08T10:00:54Z`, the recorded checks were:

| Check | Result |
| --- | --- |
| `/health/ready` | 200 |
| `/health/workers` | 200 |
| Local web `/ru` | 200 |
| Private API path through public webhook tunnel | 404 |
| Unsigned webhook | 403 |
| Signed empty webhook | 400 |

These checks did not create real calls. New processes, startup logs and readiness
responses established loading at that time; a state-file edit alone would not.
The API/contracts source digest was
`ac8200e421a8c2be31b957d2c1e0226e11a5156f0a971ce42aaec9c7880b8076`.
Details were saved in `.tools/native-integrity-local-final.log`. These are dated
observations, not a claim that the same processes are running now.

## Remaining acceptance and known limits

The [validation matrix](../native-live-validation.md#telephone-acceptance-matrix)
carries the outstanding real-call checks: concise opening and identity, prerequisite
first, permitted/no-action/unknown branches, numeric corrections, all appointment
operations, interruptions, reciprocal goodbye, recipient hangup, automatic answers,
retry, refusal cleanup, preparation explanations, full/partial reports and costs.

- Audible p95 latency and model quality were not measured on a fresh series for this
  checkpoint. Paid paired probes were not performed.
- Long-call consolidation remains bounded; partial review is exposed rather than
  represented as complete cross-part evaluation.
- Numeric evidence recognizes known forms conservatively and still relies on the
  backend for semantic interpretation.
- Probe reservations limit local dispatch, not the final provider invoice. Actual
  diagnostic cost requires project-level reconciliation.
- Source review during documentation synchronization found that owner-email fallback
  without a ready assessment still uses affirmative-consent timestamps to filter
  native turns. Declarative-only native captures have no such timestamp. The ready
  assessment path accepts the declared basis; see [email rules](../engineer-guide.md#owner-result-emails).
- Native v2 remains blocked in production. Stable local samples do not authorize or
  prove public-beta readiness.

## Documentation verification

The subsequent documentation pass on 2026-11-08 verified:

| Check | Result |
| --- | --- |
| Maintained reference links and Markdown anchors | No broken targets or anchors |
| API route inventory | All 148 documented registrations match the source syntax tree, including expanded dynamic families |
| Archive relocation | 29 records moved; original bodies preserved apart from relocated links and added archive notices |
| Application/source files | SHA-256 comparison against the start of the documentation pass found no changes |
| Environment example | Comment changes only; configuration values preserved |
| Patch whitespace | `git diff --check` passed |

The active references are English. Historical originals retain their language and
dates. The scenario JSON stays at its executable consumers' existing path. This
documentation pass did not rerun providers, application suites or deployments
described in the implementation evidence above.
