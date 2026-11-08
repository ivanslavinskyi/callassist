# Task information and testing implementation record

**Date:** 2026-11-08.\
**Branch:** `codex/live-audit-validation-2026-11-05`.\
**Scope:** current working tree and local native-v2 installation; no production release.

The approved [plan](../plans/task-input-retention-and-test-scenarios-2026-11-08.md)
is implemented. The [maintained reference](../task-input-and-testing.md) describes
the final contracts, limits and compatibility behavior.

## Delivered changes

- A shared Live/backend rule covers relevant information in every task field,
  exact identifiers, subjects, disclosure restrictions and action boundaries.
  Original sources are inspectable during review. Compiler 13 and approval 8 are
  unchanged; the native instruction identity is versioned separately.
- New forms and creation defaults use 30-day audio retention. Existing explicit
  policies, historical defaults, attempts and deletion deadlines remain stable.
  The selector is replaced with retention information. All seven public-copy
  locales receive an exact, immutable revision upgrade.
- Objective projections use the existing data keyring. A resumable, verified
  backfill, compatible reads, deletion guard, rotation inventory and export mapping
  cover historical records.
- Persistent tester grants, automatic superadmin access, encrypted versioned
  scenarios, audit events, protected routes and admin controls are available.
  Objective buttons support explicit replacement and undo. Catalog operations
  never invoke models or dial a number.
- Preparation provenance records template revision, edit status and effective
  tester classification outside approval hashes. Telemetry exports and expense
  records preserve it. Cohort grouping leaves pricing and credits unchanged.
  Memory and PostgreSQL adapters share the same classification behavior.
- Transcript PDFs have a separate first-page AI task assessment before dialogue,
  using matching saved evidence and explicit pending/unavailable/partial states.

## Verification

| Check | Result |
| --- | --- |
| Contracts | 26 suites, 290 tests passed; fresh 30-day default, historical 7-day default and explicit 0/7/30 policies covered |
| Web application | 78 suites, 449 tests passed; targeted review tests re-run after adding source labels |
| Targeted API/regressions | 16 suites, 120 tests passed, including real PostgreSQL fixtures |
| Memory-store follow-up | 3 targeted suites, 6 tests passed after connecting ephemeral attribution to expense reads |
| Types | API, web and contracts TypeScript checks passed |
| Build and lint | API production bundle and migration packaging passed; ESLint passed on the affected form, review, scenario and PDF-assessment modules |
| Public copy | Consistency checker passed across 1,206 source files |
| Browser | Synthetic Edge run passed replacement/cancel/undo/manual-edit/busy-state/mobile-fit/admin-editor checks; all API replies mocked and only catalog GETs observed |
| PDF | Eight synthetic PDFs generated and checked for text, layout bounds, links, page breaks and footers; Russian assessment block visually inspected on page one |
| Whitespace | `git diff --check` passed; existing line-ending notices are not whitespace failures |

Database coverage includes concurrent scenario edits, revision conflicts,
superadmin access without a grant, revocation, deleted-user grant removal,
encrypted payloads, compatible objective reads, idempotent backfill, call-data
redaction, attempt-pinned retention, duplicate recording callbacks and unchanged
expense totals after attribution. The existing telemetry archive and account
export integration suites also passed.

The initial sandbox blocked local sockets and a headless Edge launch. The same
checks were rerun with local execution approval. A mixed API run made before the
test database wrapper was applied failed on sandbox connections; it is not counted
as successful evidence. A backfill test initially used a legacy-only test key to
read a keyring-format value; the fixture now exercises the configured keyring.
The web regression run also caught absent optional fields in historical review
fixtures; the source display now handles those records.

Reproducible commands use the installed tools directly when Corepack cannot reach
the registry:

```text
# From the matching package directory
node node_modules/vitest/vitest.mjs run --reporter=dot

# From the repository root
node node_modules/typescript/bin/tsc --noEmit -p apps/api/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p packages/contracts/tsconfig.json
node scripts/check-public-copy.mjs

# From apps/api; synthetic PDF generation only
node --import tsx ../web/scripts/verify-transcript-pdf.ts
```

PostgreSQL suites require a local `TEST_DATABASE_URL` ending in `_test` and a role
that can create isolated temporary databases. They must never point at the working
call database. Browser/PDF render evidence and local process details remain under
ignored `.tools/`, not customer fixtures or committed credentials.

## Local activation and remaining acceptance

After verifying zero active calls, preparations, due jobs and notification work,
migrations 0113–0115 were applied locally. The objective backfill updated **147**
historical rows; verification found **zero** active plaintext-only projections.
API and worker were restarted with native v2 still enabled locally. API readiness,
web availability, the compiled admin route and anonymous catalog denial (401)
were checked again after the final restart at 13:54 UTC. A second backfill updated
zero rows, confirming idempotency. The local catalog contains no scenarios until an administrator
creates them; superadmin access requires no grant.

No paid model probe, telephone call, production deployment, credit policy change
or model selection change was performed for this implementation. Existing working
history was read and migrated, not regenerated with a model. Human telephone
acceptance remains necessary for spontaneous wording, interruptions and complex
appointment dialogue; use the plan's representative input placements and
conditional-action scenarios. Romansh wording should receive normal human
editorial review before public release.

## Subsequent documentation synchronization

Later on 8 November 2026, maintained English documentation was synchronized with
the same working-tree implementation: native instruction identity
`live-native-context-2026-11-08`, migrations through `0115`, original input sources,
tester capability/catalog, attribution boundaries, retention and first-page PDF
assessment. The original planning investigation is explicitly marked as the
pre-implementation baseline; dated test evidence above is preserved.

Documentation checks matched all **155** documented HTTP registrations to the
TypeScript source, with no missing or extra routes. All **407** local links and
anchors across **13** maintained Markdown documents resolved. The public-copy
checker passed across **1,207** source files, and `git diff --check` passed.
File hashes captured before this documentation pass confirmed no changes outside
Markdown documentation. No application test suite, migration, backfill, restart,
paid provider probe or telephone call was run for this documentation update.
