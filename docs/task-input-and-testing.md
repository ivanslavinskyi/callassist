# Task information, recordings and testing scenarios

**Implemented:** 2026-11-08; source reviewed 2026-11-09 at `2342741`. This document describes
code behavior, not a production deployment. Native v2 supports explicit selection
in development and production.

## Task information

Relevant facts can be entered in the objective, optional context, facts list or
clarification answers. The frozen native startup bundle retains all four sources;
the `approvedFacts` array is not the entire disclosure boundary. Live and its
backend receive the same instructions to disclose information only when useful,
honor restrictions, preserve exact values and subjects, and clarify contradictions.
Personal details do not independently authorize payments, callbacks or new actions.
Contact numbers in task text never replace the destination phone field.

The objective and clarification answers establish appointment action authority.
Context can supply background, prerequisites and factual values, but cannot add an
otherwise unauthorized action. Required destination and identity fields remain
separate form inputs; writing a phone number or name in task text does not fill
those fields automatically. Explicit withholding instructions still govern sensitive
details, and the conversation should not recite them in its opening or closing.

Original sources are available in an expandable section during plan review. Input
limits remain 4,000 JavaScript string units per trimmed objective/context and 8,000
normalized Unicode code points in aggregate, with a warning at 6,000. The aggregate
also includes facts, clarification answers and delivery instruction; individual
maxima are not additive allowances. Historical stored context remains readable up
to 12,000 characters. See the [limits table](native-live-runtime.md#input-and-allocation-limits).
Scenario insertion does not bypass these limits or any
moderation, compilation, review, approval, credit or destination checks.

Existing compiler prompt versions were preserved. The native runtime instruction
identity is `live-native-task-2026-11-09`; no extra model stage or ordinary-turn
lookup was added. See [native runtime](native-live-runtime.md) for tool boundaries.

### Objective storage and backfill

The database objective projection is now encrypted with the existing data keyring.
New writes store `Encrypted task` in the old plaintext column; compatible reads use
legacy plaintext when ciphertext is absent. With the intended `DATABASE_URL` and
existing encryption keyring configured, run from the repository root:

```text
corepack pnpm --filter @callassist/api db:backfill:objectives
corepack pnpm --filter @callassist/api db:backfill:objectives --execute
```

The first command is a count-only dry run. The second explicitly migrates historical
projections in transactions of 100, verifying encryption round trips before replacing
plaintext. The command reports counts only, is idempotent and does not rewrite
approval hashes. Built deployments expose the equivalent `db:backfill:objectives:prod`
script. Startup does not run this backfill automatically. Migration 0113 clears
the ciphertext on call-data deletion. Rotation and telemetry exports use the new
column; exports retain the same logical objective field.

## Audio retention

Fresh forms and omitted creation-API settings default to **30 days**. The form
shows the applicable retention period instead of a selector. Explicit API values
0, 7 and 30 remain supported; existing drafts, repeats and stored policies retain
their values. Historical omitted-field readers continue to use 7 days.

The completed-recording callback uses the attempt's frozen policy, falling back
to the brief only for historical attempts without a snapshot. The first deadline
is retained on later callbacks. Retention starts when the recording becomes
available; 0 means deletion as soon as available. Transcript/summary retries do
not extend that deadline. Users can still delete earlier.

Migration 0115 updates exact known retention-copy leaves in all seven languages,
creates new immutable publications and preserves unrelated content. Unknown edits
in required published fields abort the transaction for editorial review. It does
not modify historical acceptances or activate native recording policy publicly.

## Tester capability and catalog

Tester is an independent capability, not a new account role. Active superadmins
have it automatically. A superadmin can grant or revoke it for an active eligible
account from **Admin → Users → Tester access**. Content editors are ineligible.
It does not grant admin access, credits or additional calling authority.
Suspension disables effective access. Revoking a separate grant cannot remove a
superadmin's role-derived access.

**Admin → Test scenarios** manages up to 100 scenarios, including archived ones.
Each scenario has a title (1–80 characters), objective (10–4,000), content language,
sort order (0–10,000), and draft/active/archived status. Saving creates a new
immutable encrypted revision. Revision checks reject concurrent overwrites. The
catalog initially contains no scenarios; administrators author the
demonstration scenarios described in the [implementation plan](plans/task-input-retention-and-test-scenarios-2026-11-08.md#7-suggested-initial-scenario-set).

Authorized accounts see active title buttons above the objective. Clicking one
inserts only the objective. A populated field requires explicit replacement;
undo restores its previous text and origin until the inserted text is edited.
Other fields are untouched. Buttons are disabled during preparation. Insertion
does not prepare a plan, start a call or contact a model. Draft content stays in
the existing account-scoped memory store, not persistent browser storage.
The scenario's content language is metadata; insertion does not change call or UI
language. No catalog lookup is required during an ordinary Live turn.

Catalog edits do not change already inserted text. At preparation, the API checks
the exact retained revision and access and records whether the objective was edited.
Archiving hides a scenario from the button list; it does not invalidate a previously
selected retained revision while the account still has access. The admin list returns
current revisions, including drafts and archived entries. Revision-history browsing,
hard deletion and history restoration are not exposed by this API.
If access was revoked, the form keeps the task text, removes the obsolete origin
and asks the user to review and resubmit. Catalog failures leave manual entry
available. Responses are private/no-store; the API enforces access independently
of the UI. Account deletion removes the grant.

| Method | Endpoint | Access |
| --- | --- | --- |
| GET | `/api/testing/access` | Authenticated eligible call account; effective capability |
| GET | `/api/testing/scenarios` | Tester or superadmin; active current revisions |
| GET | `/api/admin/users/:id/testing-access` | Superadmin |
| PUT | `/api/admin/users/:id/testing-access` | Superadmin; `enabled`, `expectedRevision` |
| GET / POST | `/api/admin/testing/scenarios` | Superadmin; list/create |
| PUT | `/api/admin/testing/scenarios/:id` | Superadmin; complete content and `expectedRevision` |

Successful reads and writes return **200**, including scenario creation. Access
responses are `{ enabled, byRole, revision }`; catalog responses are arrays of
`{ id, revision, title, objective, locale, status, sortOrder, updatedAt }`. A save
returns that scenario object. Mutation schemas are strict. Create uses
`expectedRevision: 0`; updates send the last observed revision. A grant with no
stored revision also starts at 0. Refresh after a conflict before saving again.

| Code | HTTP status | Meaning |
| --- | --- | --- |
| `INVALID_SCENARIO` | 400 | Invalid complete scenario payload or update ID |
| `INVALID_USER_ID`, `INVALID_TESTING_ACCESS` | 400 | Invalid access-read ID or access mutation |
| `TESTING_FORBIDDEN` | 403 | Capability or superadmin check failed |
| `SCENARIO_SELECTION_UNAVAILABLE` | 403 | Preparation origin is unavailable or account access was revoked |
| `SCENARIO_NOT_FOUND` | 404 | Scenario update target does not exist |
| `TESTING_REVISION_CONFLICT` | 409 | Expected revision differs from current state |
| `TESTING_TARGET_UNAVAILABLE` | 422 | Grant target is absent, inactive or ineligible |
| `TESTING_INCLUDED_BY_ROLE` | 422 | Attempt to mutate a superadmin's implicit access |
| `SCENARIO_CATALOG_LIMIT` | 422 | Creation would exceed 100 scenario heads, including archived ones |
| `TESTING_UNAVAILABLE` | 503 | Testing subsystem was not supplied to the API |

Mutation routes enforce the existing origin checks. Audit rows contain actor,
target/scenario ID, revision and action, not task text. Current access is included
in account exports. Global catalog content and operator history are excluded from
call-scoped telemetry archives by explicit inventory decisions.
The API's PostgreSQL testing store uses a separate pool capped at three connections;
role workers do not instantiate this store. Include it in API connection budgets.

## Attribution and expenses

The optional `testScenario: { id, revision }` belongs to the v2 preparation request
envelope, outside the approved brief and its hashes. The server records an immutable
preparation attribution: effective tester access, access by role, scenario revision
and objective-modified flag. Neither the role nor a client-supplied cost label is
trusted as historical classification.

Manual preparations also capture effective tester access; scenario selection is
optional. `scenario` and `objectiveModified` are null without a selection. A new
request resolves attribution before preparation, then saves it after the durable
preparation is created and before returning 202. These are separate writes, not one
atomic transaction. Idempotent replays do not backfill absent attribution, so missing
evidence can remain unclassified even for a recent preparation.

Telemetry exports include `testing_preparation_attribution`. Provider request
records join direct preparation IDs, or the latest applicable preparation before
the attempt/operation started. Later role or catalog edits do not reclassify prior
requests. Old unattributed requests remain **unclassified**, never guessed ordinary.
The expense explorer shows cohort totals with estimates and provider charges
separated and a cohort filter over its bounded recent-request list. Aggregate
cohort totals are computed before that list's truncation. Main totals, credit
rules, model settings and provider-project reconciliation remain unchanged.
The aggregation contract is `testingCohorts`, with operation count, `amountMicros`
and incomplete-operation count grouped by cohort and `usage_estimate` or
`provider_reported` amount kind. The recent-list filter is not an invoice-wide filter.

## Transcript PDF assessment

Both PDF export paths reserve a separate assessment block on the first page before
conversation turns. The versioned export uses a validated summary assessment first,
then a ready saved lifecycle assessment only when its transcript revision matches.
Without a result, an in-progress summary or matching pending lifecycle assessment
shows pending; otherwise it shows unavailable. It does not invoke a model or infer
success from a booked appointment alone.

The block includes the task status, the first saved overview item when available,
and a partial-analysis notice when the summary reports partial coverage. An overview
over 500 Unicode code points is shortened from a 480-code-point prefix at a word
boundary with an ellipsis. All seven UI languages have status labels. The legacy
final-transcript exporter does not pass assessment evidence and explicitly shows
unavailable. Translations retain the original evidence revision.

## Implementation ownership

| Boundary | Source |
| --- | --- |
| Input limits and creation defaults | [Call brief contract](../packages/contracts/src/call-brief.ts) |
| Native disclosure instructions | [Supplied information](../apps/api/src/voice/supplied-information.ts) |
| Access and catalog API | [Contracts](../packages/contracts/src/testing.ts), [routes](../apps/api/src/testing/routes.ts), [PostgreSQL store](../apps/api/src/testing/postgres-store.ts) |
| Scenario insertion | [Scenario buttons](../apps/web/components/test-scenario-buttons.tsx) |
| Catalog and grant administration | [Catalog console](../apps/web/components/admin-testing-console.tsx), [access control](../apps/web/components/admin-testing-access.tsx) |
| Objective encryption backfill | [Backfill command](../apps/api/src/db/backfill-objectives.ts), [encrypted column inventory](../apps/api/src/db/encrypted-columns.ts) |
| PDF evidence and layout | [Assessment selection](../apps/web/lib/transcript-assessment.ts), [PDF layout](../apps/web/lib/transcript-pdf-layout.ts) |

## Verification and rollout

See the [implementation record](reports/task-input-testing-implementation-2026-11-08.md)
for completed checks and local activation. Offline checks establish transport,
storage, authorization and presentation behavior. They do not guarantee the
model's wording in a future phone conversation. Production deployment, paid model
probes and telephone acceptance remain separate actions.
