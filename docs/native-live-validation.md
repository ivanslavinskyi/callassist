# Native GPT-Live validation

**Status:** maintained engineering procedure.\
**Source reviewed:** 2026-11-09.\
**Scope:** `live_native_v2` verification; commands do not imply a production deployment.

Use the [runtime specification](native-live-runtime.md) for behavior and the
[dated implementation record](reports/native-live-integrity-2026-11-08.md) for
native integrity results already obtained. The subsequent
[feature record](reports/task-input-testing-implementation-2026-11-08.md) covers task
information, retention, tester access, expenses and PDF assessment. Commands below
are procedures, not claims that they
were executed during a documentation update.

## Establish a reproducible baseline

Record the branch, commit, dirty-tree diff or source digest, migration catalog,
runtime descriptor, preparation policy revision, selected models and rate-card
version. A commit ID alone cannot identify an uncommitted experiment. Use synthetic
fixtures in version control; keep recordings, decrypted exports and local credentials
outside it. Preserve the working call database when running database tests.

From the repository root, after installing the locked dependencies:

```text
corepack pnpm --filter @callassist/contracts test
corepack pnpm --filter @callassist/web test
corepack pnpm --filter @callassist/api typecheck
corepack pnpm --filter @callassist/web typecheck
corepack pnpm --filter @callassist/api test:isolated --reporter=dot
git diff --check
```

The API wrapper creates a randomly named disposable database using the test
database connection configuration, then drops only that database. It needs a
PostgreSQL role with database-creation rights. Read
[isolated-test-database.ts](../apps/api/src/db/isolated-test-database.ts) before
configuring it; do not run fixtures against a working or production database.
Mock-provider tests do not establish real model or telephone performance.

## Runtime prerequisites

Use the normal local setup in the [README](../README.md) and
[engineer guide](engineer-guide.md#development-and-verification), then check:

| Requirement | Expected state |
| --- | --- |
| Database | Catalog through `0115`; API and workers use the same intended database |
| Profile | `CALL_RUNTIME_PROFILE=native_v2` on API and every worker |
| Configuration | `runtime:configure --apply` completed; `runtime:check` passes |
| Environment | Development and production supported; obsolete `VOICE_RUNTIME_NATIVE_V2_LOCAL` ignored |
| Completion | Enabled by the profile; conflicting low-level overrides are rejected |
| Preparation | Verify the saved policy revision, not just the selected model |
| Latest integrity plan | Policy `preparation-live-native-task-2026-11-09`, compiler 15, schema 10, approval 9 |
| Native instructions | Newly described attempts use `live-native-task-2026-11-09`; Live delegates silently and the backend alone extracts closing quotes |
| Workers | `/health/ready` and `/health/workers` pass for the selected worker mode |
| Telephone transport | Signed Twilio callbacks and Media Stream reach the same admitted attempt |

The public admin preparation API cannot set `promptVersion`. The
[runtime profile command](runtime-profiles.md) applies the policy with revision/audit
provenance. Selecting a generation model alone does not activate compiler 15.
An existing approved plan retains its version. Create and approve a new plan to
exercise new preparation instructions.

Provider session admission precedes dialing and can accrue usage before a human
answers. Health checks do not start calls. Restart processes only after confirming
that no active call or relevant job would be interrupted; configuration is read at
startup. The [9 November release record](reports/native-task-boundary-2026-11-09.md)
records the completed owner-reported production rollout; a new controlled production
call remains a separate acceptance step. Use the current local runbook for host
operations. The 8 November preparation record describes the earlier schema transition.

For the new feature checks, verify objective encryption/backfill separately from
migration application. The [backfill command](task-input-and-testing.md#objective-storage-and-backfill)
defaults to a dry run. The catalog starts empty: an active superadmin can create
synthetic active scenarios without a tester grant. Catalog creation and button
insertion do not call a provider or start preparation automatically.

## Offline coverage map

| Boundary | Representative source tests |
| --- | --- |
| Preparation, conditional order, typed failures | `brief-compiler/native-preparation.test.ts`, `compiler-instructions.test.ts`, `preparation-issues.test.ts` |
| Roles, source fidelity, bounded audit repair | `brief-compiler/execution-fidelity.test.ts`, `preparation-role-evaluation.test.ts`, `voice/live-native-profiles.test.ts` |
| Task-only constraints, source coverage, conditional criteria and request accounting | `brief-compiler/task-only-preparation.test.ts` |
| Current format persistence, admin timeline and exported evidence | `db/configure-runtime-profile.integration.test.ts`, `telemetry-export/telemetry-export.integration.test.ts` |
| Empty sections and explicit restrictions in seven UI locales | Web `lib/task-only-plan.test.tsx` |
| Historical contracts and approvals | `brief-compiler/archived-native-compatibility.test.ts`, contract `live-task.test.ts` |
| Startup and conversational profiles | `voice/native-live-admission.test.ts`, `live-native-prompts.test.ts`, `live-native-profiles.test.ts` |
| Numeric evidence and action lifecycle | `appointments/native-terms-evidence.test.ts`, `native-appointment-authorization.test.ts`, `voice/native-appointment-call.test.ts` |
| Interruptions, closing and recovery | `voice/live-native-closing.test.ts`, `native-live-stability.test.ts`, `native-live-v2.test.ts` |
| Grounded result and partial coverage | `text-processing/native-summary.test.ts`, `native-summary-source.test.ts`, `summary-workflow.test.ts` |
| Privacy, retry and durable history | `storage/native-live-privacy.integration.test.ts`, `call-retry.integration.test.ts`, `history-read-model.test.ts` |
| Export, cost and provenance | `telemetry-export/coverage.test.ts`, `timing.test.ts`, `telemetry-export.integration.test.ts`, `billing/expense-accounting.integration.test.ts` |
| UI and notifications | Web `components/preparation-issues.test.tsx`, `native-appointment-details.test.tsx`; API `notifications/user-call-email.test.ts`, `superadmin-notifications.integration.test.ts` |
| Native supplied information | API `voice/supplied-information.test.ts`; source-review UI and field-placement browser checks |
| Retention defaults and compatibility | Contract `call-brief.test.ts`; API `testing/postgres-store.integration.test.ts` for attempt policy and repeated callbacks |
| Tester access, revisions, encryption and backfill | API `testing/store.test.ts`, `routes.test.ts`, `postgres-store.integration.test.ts` |
| Attribution and expense cohorts | API `admin-operations.test.ts`, `storage/admin-operations.test.ts`; contract `admin-operations.test.ts` |
| First-page PDF assessment | Web `lib/transcript-assessment.test.ts`, `transcript-pdf-layout.test.ts`; synthetic PDF render inspection |

API paths in the table are relative to `apps/api/src`; web paths to `apps/web` and
contract paths to `packages/contracts/src`. Short filenames in a row share its
preceding directory. Use focused suites during development, then the
appropriate full suites after changes cross preparation, runtime and result boundaries.

For the role-fidelity revision, test that the correct subject survives preparation,
question purposes, criteria and the final spoken recap. Include identical first
names, distinct names, third parties, a result genuinely about the principal and a
later correction. The optional preparation `--suite=roles` corpus is documented in
[preparation runtime](preparation-runtime.md#reproducible-verification-tools). Model-output
fixtures verify audit handling and request bounds, not the accuracy of the remote
auditor. Compare repeated live runs with only the plan fixed, only the closing prompt
fixed and both fixed. Do not infer speech accuracy from passing mock tests or a
post-call `goal=achieved` alone.

For compiler 15, include a simple task with no restrictions, an explicit restriction
that resembles an internal rule, an omitted restriction and a conditional branch
that does not apply. Verify that only user task content appears in the reviewed
plan. On a real call, check that one natural farewell is followed by silence and
disconnection, while a substantive correction still receives an answer. The offline
probe acceptance helper `apps/api/scripts/native-closing-evidence.ts` rejects the
captured duplicate-farewell/tool-narration pattern; its unit test does not generate
speech. The existing paid probe requires its diagnostic credentials and budget;
the helper is not a production speech filter or a universal semantic detector.

Generate the eight synthetic PDF fixtures from `apps/api`:

```text
node --import tsx ../web/scripts/verify-transcript-pdf.ts
```

Inspect rendered first pages, including Russian and unavailable/partial states,
plus long text, page breaks, links and footers. Text extraction alone does not
establish visual layout. This script uses synthetic data and makes no model call.

Before telephone acceptance, check the following UI and persistence boundaries:

- Place the same factual values in objective, context, facts and clarification
  answers; inspect all original sources in review. Exercise aggregate limits,
  explicit withholding, conflicting values and unsupported action authority.
- Confirm a fresh 30-day default, retained explicit 0/7/30 values and historical
  7-day readers. Duplicate recording callbacks and result retries must not extend
  an established deadline; refusal/deletion must still fence late writes.
- Exercise automatic superadmin access, a granted account, an ordinary account,
  revocation, suspension and server-side denial. Check scenario replacement,
  cancel, undo, edited text, busy state, mobile layout and an unavailable catalog.
- Check concurrent catalog/grant edits, archive visibility and a previously
  selected revision. Account and telemetry exports must honor their inventories.
- Reconcile tester/ordinary/unclassified expenses without changing overall pricing
  or credit totals; verify missing attribution and recent-row filter scope.
- Check PDF achieved/partial/not-achieved/uncertain, pending and unavailable states,
  revision mismatch, partial analysis and the historical exporter.

## Provider probes

[probe-native-profiles.mjs](../apps/api/scripts/probe-native-profiles.mjs) runs real
OpenAI sessions with a synthetic actor and an in-memory telephone transport. It
does not place a telephone call. It is **paid**, unlike the offline suites above.

The script requires a unique `NATIVE_PROBE_RUN`, a distinct diagnostic
`OPENAI_DIAGNOSTIC_PROJECT_ID` / `OPENAI_DIAGNOSTIC_API_KEY`, and explicit
`NATIVE_PROBE_MAX_USD` and `NATIVE_PROBE_MAX_REQUESTS`. The project must differ from
`OPENAI_PROJECT_ID` when that application project is configured; the diagnostic
key must differ from the application key. Limits are positive, at most USD 100 and
100 requests. Reusing a run ID is rejected.

After explicitly selecting a diagnostic budget and credentials, run from `apps/api`:

```text
node --use-system-ca --import tsx scripts/probe-native-profiles.mjs general book
```

The local ledger is `.tools/native-profiles-provider-results/experiment-ledger.jsonl`.
Admission reserves USD 1 for speech, USD 1 for a Live session and USD 5 for a backend
request. Those fixed reserves limit dispatch; they are not a guaranteed provider
invoice ceiling. Reconcile actual usage with the diagnostic project's billing.
Do not assign unregistered historical probe costs to user calls.

## Telephone acceptance matrix

Use the same approved task, model/settings and controlled acoustic conditions for
baseline and candidate. Record attempt IDs and changes between runs. A model probe
cannot test real carrier buffering, background sound or the person's perception.

| Scenario | Required observation |
| --- | --- |
| General question, including a substantive negative answer | Concise introduction/notice/readiness; correct represented identity; useful answer and appropriate result |
| Price first, then conditional booking | Ask the unknown prerequisite first; do not recite the budget or future branches; proceed only on the permitted branch |
| High price or unresolved prerequisite | Correct no-action completion when the approved condition resolves; uncertainty when it does not |
| Free service, ranges, hourly prices, supplements | No fabricated currency or numeric authorization from ambiguous wording |
| Numeric correction before/after confirmation | Revalidate evidence, preserve uncertainty and avoid duplicate commitments |
| Confirm, reschedule, cancel, alternatives | Correct operation/person/slot; preserve the configured selection policy; verify old-slot disposition for rescheduling |
| Interruption and reciprocal goodbye | No clipped speech, repeated commitment or unnecessary second farewell; hang up after verified playback |
| Recipient hangs up first | Telephone ends promptly; transcript/result jobs complete independently |
| Machine/fax/voicemail and repeat | Accurate lifecycle label; repeat is offered only when the source attempt is eligible |
| Refusal | Stop and discard; late callbacks cannot restore conversation data |
| Preparation rejection | Clear localized reason and actionable next step; no invented safety category |
| Facts in objective, context or facts list | Use exact relevant identifiers and represented person; ask only for missing information; honor withholding |
| Scenario-created task | Same approval, authority and conversational behavior as equivalent manual input |
| Long conversation | Either full evaluation or visible partial coverage in card, copy, PDF and email |
| Cost/export reconciliation | Same operation cohort, finality, missing evidence and diagnostic separation across views |

Stop acceptance after lost audio, unauthorized action, duplicate commitment,
privacy failure, unsupported success, or hangup failure. Save evidence before
changing configuration. Do not switch an active attempt's frozen runtime descriptor.
A successful sample does not establish p95 latency or all-profile model quality.

## Interpret telemetry

Export v4 carries raw retained records and per-attempt `coverage.json`. Check
completeness before comparing timings. The following names are emitted by
[timing.ts](../apps/api/src/telemetry-export/timing.ts):

| Metric | Interpretation |
| --- | --- |
| `traceStartToSessionStartedMs` | Trace initialization to observed session start; not pure network handshake time |
| `admissionToFirstSpeechForwardMs` | Host media admission to first forwarded speech |
| `inputStopToNextSpeechForwardMs` | Input-activity stop to next forwarded speech; not measured audible response latency |
| `backendResponseMs` | Backend response creation to terminal event |
| `toolReadyToOutputMs` | Tool readiness to returned tool output |
| `closingMarkRoundTripMs` | Closing playback mark to acknowledgement |
| `lastSpeechForwardToHangupRequestMs` | Last forwarded speech to hangup request |
| `playbackDrainedToHangupRequestMs` | Verified drain to hangup request |
| `hangupRequestMs` | Host hangup request duration |

Samples are capped at 256 per metric with `omittedSamples`. Trace loss, missing
closure or incomplete final usage must remain visible. Do not treat missing samples
as zero latency. Compare closing/action recovery and backend-busy counters, startup
context sizes, grounding-repair counts and dropped-event fractions alongside timings.
Human listening and synchronized playback evidence are needed for acoustic claims.

## Troubleshooting by symptom

| Symptom | First evidence to inspect |
| --- | --- |
| Opening absent or cut off | Admission, media readiness, audio forwarding, interruption/clear events and actual recording |
| Goodbye spoken but call remains connected | Closing delegation, `end_call` validation, fresh recipient revision, pending backend, mark acknowledgement and hangup request |
| Booking appears partial | Executed source context, conditional applicability, action journal state, exact recipient evidence and selected display assessment revision |
| Result unavailable | Text artifact status, generator version, request budget, validation diagnostics and retry eligibility; page reads must not trigger ASR |
| Owner email missing without a ready assessment | Recording basis and fallback evidence; declarative native transcripts lack the affirmative-consent timestamp used by the current fallback |
| Cost unexpectedly high or incomplete | Active Live duration, backend requests, preparation stages, summary repairs, usage finality and separate diagnostic-project billing |
| Trace absent | Distinguish legacy absence, privacy deletion, missing manifest, payload loss and pending drain |

Never repair the appearance of a call by inventing final usage, rewriting canonical
billing evidence, promoting an uncertain action, or reconstructing deleted content.
