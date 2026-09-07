# Mainline merge verification — 2026-09-07

This record covers the integration of audit/remediation commit `51a61da` with
mainline commit `14abd28`. The earlier [audit](project-audit-2026-09-07.md) and
[remediation evidence](remediation-2026-09-07.md) describe their respective source
states; their counts are historical. The [release roadmap](mvp-plan.md) remains the
current backlog.

## Integrated behavior

- Retained the audit fixes for dependency vulnerabilities, test-database isolation,
  Turbo environment handling, encryption inventory, production compiler selection,
  deleted-account verification challenges, consent classification and SSE revocation.
- Preserved mainline immutable compilations/approvals, attempt execution snapshots,
  provider usage/cost ledgers, durable recompilation and resumable transcription.
- Unified rotation and restore verification around all 13 ciphertext columns.
  Rotation retains the transaction flag required by immutable-row guards. The
  regression verifies plan readability and unchanged snapshot hashes after old-key
  removal, attempt snapshot rotation, queued preparation completion and no-op replay.
- Adapted the two-stage real-call runner to explicit reviewed revision/hash inputs.
  A changed compilation is refused before starting a call. Mainline historical live
  drill evidence is retained in [real-provider drills](real-provider-drills.md).
- Updated architecture, configuration, route inventory and roadmap to the merged
  source: 61 migrations, 58 public tables, six durable call-job types, 89 route
  registrations and 13 ciphertext families.

## Local verification

| Check | Result |
| --- | --- |
| Frozen dependency install | Passed |
| Full test suite with isolated PostgreSQL | 609 passed, zero failures/skips: API 425, web 111, contracts 73 |
| Strengthened immutable-plan/key-rotation regression | Passed separately after the full suite |
| Lint, TypeScript checks, production build | Passed |
| Production dependency audit | Zero reported vulnerabilities; 197 dependencies |
| Public-copy consistency | Passed |
| Fresh migration application and replay | Passed through `0061_complete_immutable_call_plan_cutover.sql` |
| Migration catalog validation | Passed, 61 migrations |
| Cutover verifier on a fresh disposable database | Ready, zero blockers |
| PostgreSQL custom-format backup/restore | Passed: 61 migrations, 58 table row-count comparisons, 14 critical tables |
| Restored ciphertext decryption | 12 populated families verified; transcription-chunk ciphertext was empty in this fixture database |

The encrypted-column schema parity regression checks all 13 columns; the restore
result above does not claim a populated transcription-chunk sample. Recovery ran
against PostgreSQL 17.10, completed at `2026-09-07T09:04:28.235Z` in 3,028 ms and
removed its temporary resources. The custom backup contained 493,448 bytes with
SHA-256 `f4e5dda625b118510d1bab29f38e9eec2f4576774a5f7723ce9efde731ab01c8`.

## Scope and rollout

Database checks used disposable databases in the separate audit container. The
user's working database was not migrated. A fresh-database cutover result does not
certify any populated deployment: follow the [staged migration sequence](approved-call-plan-cost-security-roadmap.md#migration-and-rollout-sequence)
before applying migration 0061 to existing data.

No real calls or other paid provider drills ran during this merge. This record does
not establish deployed-provider readiness, current external pricing or successful
hosted CI for the eventual merge commit. R06 and the other open release gates remain
open as specified in the roadmap.
