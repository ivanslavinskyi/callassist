# Public content draft staging

The reviewed release candidate and local dry-run recorded matching published
source revisions and five available targets: Privacy, Terms, FAQ page,
Imprint and FAQ collection. Existing AUP and Landing drafts are preserved. They require
editorial reconciliation in the normal admin workflow.

At the user's request, generated manifests and results containing account and CMS
identifiers were removed from the repository. The completed checks are recorded
below; new candidate and result files must remain local under the ignored
`.tools/public-content/` directory.

After the user identified the editorial account and authorized draft creation,
the exact account was resolved through the auth repository and verified as active
superadmin. The five nonconflicting drafts were created on 2026-09-09 at 10:19 UTC
and checked with a read-only before/after comparison.

| Target | New draft revision |
| --- | --- |
| Privacy EN/DE | 4 |
| Terms EN/DE | 4 |
| FAQ page EN/DE | 4 |
| Imprint EN/DE | 2 |
| FAQ collection EN/DE | 5 |

All eight localized page payloads and the FAQ collection match the candidate exactly.
Page translation source numbers match their new draft revisions. Read-only before/after
hashes confirm all published page revisions/localizations and editorial revisions,
the two preserved drafts, and all eight onboarding acceptance records are unchanged.
No content was published and no account role was modified.

Run from `apps/api`. Prepare a fresh candidate from the current published sources;
the preparation operation only reads the database. Staging defaults to dry-run:

```powershell
node --import tsx scripts/prepare-public-content-release.ts ../../.tools/public-content/release-candidate.json
node --import tsx scripts/stage-public-content-release.ts ../../.tools/public-content/release-candidate.json --output ../../.tools/public-content/dry-run.json
```

An operator may stage only the nonconflicting targets after identifying the actual
active content editor/admin who owns the change:

```powershell
node --import tsx scripts/stage-public-content-release.ts ../../.tools/public-content/release-candidate.json --apply --actor-user-id <actual-editor-uuid> --output ../../.tools/public-content/stage-result.json
```

The tool never chooses an account from the users table or invents an actor. Apply
checks the supplied actor's role/status and pending deletion state. Source ID and
number checks, draft creation and EN/DE updates run under one bounded database
transaction using existing ContentService methods and audit events. Existing drafts
are skipped, changed published sources are skipped, and unexpected failures roll
back all newly staged drafts. A replay preserves all existing drafts instead of
overwriting them. Output files use exclusive creation.

The transaction adapter is scoped to this compound operation; ordinary repository
transactions are unchanged. The isolated integration test covers dry-run, invalid
actor rejection, rollback, published-source preservation, existing AUP preservation
and replay. The CLI has no publish operation. Review previews and separately publish
through the current admin workflow. Terms/AUP material-revision reacceptance remains
the existing publication decision; historic acceptance records are immutable.

Outstanding: reconcile the existing AUP and Landing drafts and capture preview/publication acceptance.
Local copy and staging tests do not close external R06–R14 launch gates.
