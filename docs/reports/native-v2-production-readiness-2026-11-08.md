# Native v2 production preparation

**Date:** 2026-11-08.\
**Scope:** production configuration support and isolated PostgreSQL migration rehearsal.\
**Deployment:** not performed; planned separately for 2026-11-09.

This follow-up supersedes the production restriction recorded at the
[stable acceptance checkpoint](native-v2-stable-acceptance-2026-11-08.md).
Production credentials, database contents, CMS revisions and provider connections
were not inspected or changed during this work. No calls or paid model tests were run.

Subsequent implementation: [runtime profiles](../runtime-profiles.md) replace the
separate low-level rollout settings below with one explicit profile, an audited
configuration command and startup alignment checks. The verification evidence here
remains the record of the preceding migration rehearsal.

## Runtime configuration

Native v2 can now be selected under `NODE_ENV=production`. The same runtime,
conversation prompts, action validation and refusal cleanup are used in all environments.
No migration or runtime prompt identity changes are required for removing this restriction.

```dotenv
VOICE_RUNTIME_DRIVER=live
VOICE_RUNTIME_LIVE_FALLBACK=false
VOICE_RUNTIME_LIVE_EXPERIMENT=native_v2
REALTIME_AGENT_HANGUP_ENABLED=true
```

`VOICE_RUNTIME_NATIVE_V2_LOCAL` is obsolete and ignored, including when old launchers
still set it. The configuration default remains managed Live (`experiment=off`).
Native v2 still rejects the Realtime driver and automatic fallback. API and worker
startup validation now rejects native configuration without agent hangup enabled,
before an attempted conversation can reach the existing call-initialization guard.
The normal production checks for storage, credentials, workers and ingress remain.

Selection does not update preparation settings. Before preparing new native calls,
the rollout must align the saved policy with
`preparation-live-native-integrity-2026-11-08`: compiler 13, schema 9, approval 8.
The existing settings API does not expose a `promptVersion` setter. The deployment
operation must preserve models, capacity and approved profiles, increment the policy
revision and record previous/next settings with a reason in `preparation_settings_audit`.
Already pinned jobs and approved snapshots must retain their original policy.
Changing a model in the admin UI does not perform this policy transition.

The persisted `recording_basis=declarative_local` value is a historical identifier;
it also identifies native production recordings. Renaming it would break readers
and is not part of this release. No affirmative-consent timestamp is fabricated.

Sources: [runtime selection](../../apps/api/src/config/voice-runtime.ts),
[startup validation](../../apps/api/src/config/runtime-environment.ts),
[deployment preflight](../../apps/api/src/config/deployment-check.ts).

## Migration review

The catalog contains 115 contiguous migrations. Existing migration files were not
modified. The normal runner validates applied names and checksums, holds its advisory
lock and commits each migration with its ledger entry in one transaction.

| Migration | Change | Upgrade consideration |
| --- | --- | --- |
| `0110` | Native privacy, encrypted trace and declarative recording basis | Existing recordings retain affirmative consent; refusal cleanup remains durable |
| `0111` | Attempt-scoped privacy and artifact cleanup | Refusal in one attempt must not erase another attempt's conversation |
| `0112` | Encrypted native appointment action revisions | Existing approved plans are not rewritten |
| `0113` | Encrypted objective projection and 30-day default | Existing retention values/deadlines stay unchanged; objective backfill is separate |
| `0114` | Tester grants, scenario revisions and attribution | No automatic grants to ordinary users or retrospective expense attribution |
| `0115` | Known retention-copy updates in seven languages | New publications preserve earlier revisions; unknown target edits block the migration |

Migration `0115` raises `RETENTION_COPY_PREFLIGHT` when a published target field
does not match a known old/new value, or a privacy publication lacks the required
seven locales. This is intentional protection of authored content. Its transaction
rolls back; earlier committed migrations remain applied. Review the affected content
and rerun the normal migrator rather than modifying an applied SQL file or bypassing
the check. Matching schema versions alone cannot prove that a production CMS will pass.

Objective backfill is resumable, uses the configured encryption keyring and defaults
to a count-only dry run. `--execute` encrypts and verifies each batch, skips deleted
tasks and replaces the plaintext projection with `Encrypted task`. It does not alter
approved snapshots or compilation hashes. Run it after migration `0113` and verify
that no eligible plaintext projections remain. See
[the backfill interface](../task-input-and-testing.md#objective-storage-and-backfill).

## Verification evidence

The isolated checks use randomly named disposable local databases and synthetic
content. Neither the working call database nor production is used as a fixture.

- Fresh schema: all migrations through `0115` apply successfully.
- Populated `0094 → 0115`: existing ledger, approvals, compilations, review receipts
  and completed-call notification boundaries remain valid.
- Populated `0109 → 0115`: explicit `0/7/30` retention values, recording deadlines
  and consent timestamps survive unchanged; new-row SQL default becomes 30 days.
- Approvals, encrypted compilation rows and review receipts are byte-for-byte
  unchanged by the upgrade; approvals also remain unchanged by objective backfill.
- Objective backfill dry run, execution, repeat execution and deletion fence pass.
- Updated privacy and landing publications contain the intended retention text in
  all seven locales; earlier publications survive and replay creates no duplicates.
- Unrecognized published retention copy aborts without committed content changes.
- Native refusal, encrypted action journals, testing attribution and historical
  transcript-copy upgrades pass their existing PostgreSQL regression suites.
- Production mode selection, managed defaults, invalid combinations and API/worker
  hangup prerequisites pass the configuration tests.

All 9 targeted suites and 85 tests passed. API TypeScript, the migration catalog,
public-copy consistency and 426 local documentation links/anchors also passed.
The new upgrade coverage lives in
[native-production-upgrade.integration.test.ts](../../apps/api/src/db/native-production-upgrade.integration.test.ts);
the older upgrade is covered by
[pre-production-upgrade.integration.test.ts](../../apps/api/src/db/pre-production-upgrade.integration.test.ts).

## Remaining deployment work

1. Verify the intended release commit and successful CI. Capture the deployed
   configuration and preparation policy for rollback.
2. Drain active calls and relevant jobs, disable new outgoing calls, and obtain a
   verified backup. Rehearse against a controlled restored production copy to check
   the actual migration ledger and published CMS content without provider dispatch.
3. Apply migrations with the release's normal runner. Complete and verify objective
   backfill with the same keyring used by API/workers. Do not regenerate old results,
   rewrite approvals or change historical audio deadlines as part of this operation.
4. Align runtime flags and the audited preparation policy. Start matching API/worker
   builds and check deployment configuration, readiness, worker health and public
   recording/retention disclosures before restoring outgoing calls.
5. Perform a separately authorized controlled call. Check preparation identity,
   opening, dialogue, action evidence, hangup, assessment, transcript/PDF, telemetry
   and cost attribution. Confirm refusal cleanup with an explicit test scenario.

Managed Live remains available by selecting `experiment=off`. A rollback must drain
active calls, restore the matching preparation policy and use newly prepared/approved
plans. Keep the upgraded schema and compatibility readers: switching modes is not
permission to downgrade migrations or replay an old binary that cannot read new rows.
Host-specific deployment and recovery procedures remain in ignored local operations
documentation; this report contains no production access details.
