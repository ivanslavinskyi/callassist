# Runtime profiles

**Status:** implemented; production deployment is a separate operation.\
**Source reviewed:** 2026-11-09.

`CALL_RUNTIME_PROFILE` selects a reviewed pair of voice runtime and preparation
instructions. The checked-in environment example selects `native_v2`. Existing
installations without this variable retain their previous low-level behavior.

| Profile | Voice | Preparation policy | Compiler / plan schema |
| --- | --- | --- | --- |
| `native_v2` | Native v2, `live-native-context-2026-11-09` | `preparation-live-native-roles-2026-11-09` | 14 / 9 |
| `managed` | Managed Live, `live-managed-v9` | `preparation-2026-10-05` | 6 / 4 |

Both profiles select the Live driver, disable automatic Realtime fallback and enable
agent hangup. Models, service tiers, provider budgets, capacity limits, pricing and
approved model profiles retain their existing settings. The 9 November native
release adds role-preserving prompts, a combined preparation audit and a general
closing tool contract without appointment-only evidence.

## Configuration

Set the same value for API and every worker:

```dotenv
CALL_RUNTIME_PROFILE=native_v2
```

Remove the old `VOICE_RUNTIME_DRIVER`, `VOICE_RUNTIME_LIVE_FALLBACK`,
`VOICE_RUNTIME_LIVE_EXPERIMENT` and `REALTIME_AGENT_HANGUP_ENABLED` assignments, or
keep only values matching the selected profile. Conflicting overrides fail validation
with the variable name and required value; they are never silently ignored.
`VOICE_RUNTIME_NATIVE_V2_LOCAL` remains obsolete and ignored.

## Applying the saved policy

The profile defines the desired configuration. PostgreSQL retains the audited
preparation policy used to pin new requests. Startup checks alignment without
silently changing that policy.

The role-fidelity release requires an explicit transition from the 8 November
integrity policy using the existing command below. It needs no new database
migration. Previously approved plans, completed artifacts and pinned preparation
jobs are not rewritten; prepare and approve a new revision to receive compiler 14
semantic validation. Startup rejects a saved policy that does not match the selected
release rather than silently running new calls with the previous preparation policy.

After normal schema migrations, with calls/preparations drained and API/workers
stopped, use the same deployment environment for these commands:

```sh
corepack pnpm runtime:configure          # Preview; no persistent changes
corepack pnpm runtime:configure --apply  # Apply the selected policy with audit
corepack pnpm runtime:check              # Read-only; nonzero exit on mismatch
```

For an installation using built artifacts, the equivalent API-package commands are:

```sh
corepack pnpm --filter @callassist/api runtime:configure:prod --apply
corepack pnpm --filter @callassist/api runtime:check:prod
```

The operation requires PostgreSQL and the current migration catalog, at least
through `0115`. It validates applied migration names and checksums before changing
settings. No new SQL migration is needed for profiles.

Application takes a transaction lock, checks for active calls and unfinished
preparations, changes only `policy.promptVersion` and its revision, and writes
previous/next settings plus the selected release to `preparation_settings_audit`.
It preserves generation/audit/review models, capacity and approved model profiles.
An already aligned policy is a no-op. Concurrent identical applications produce
one revision and one audit entry. The command does not stop services, drain work,
start calls, contact model providers, apply migrations or run objective backfill.

Existing requests retain their pinned policy and deadlines. Existing compilations,
approvals, recordings, results and accounting are not rewritten. New requests use
the applied policy. Memory storage initializes directly from the selected profile;
it has no persistent policy to migrate.

## Startup and diagnostics

- API and every worker validate the saved policy before starting work. A mismatch
  stops startup with `RUNTIME_PROFILE_MISMATCH` and the configuration command.
- `/health/ready` includes `checks.runtimeProfile` for a selected profile. It returns
  503 on policy drift, while distinguishing a reachable database from a mismatch.
- Admin System → Call plan preparation shows the profile, release, compiler, saved
  policy and alignment status. Required policy is also shown on mismatch.
- The admin settings API exposes this status as read-only `runtimeProfile` metadata.
  It cannot change the deployment profile or the preparation prompt version.
- `deployment:check` reports the selected profile but remains environment-only.
  Use `runtime:check` for the database/policy check. Neither proves deployment parity,
  provider availability or the quality of a real call.

The configuration is read at process startup. Health checks expose drift; they do
not rewrite policy or terminate active calls. Policy changes are deployment operations
with all instances stopped, not a hot switch in the admin UI.

## Rollback

Drain work and stop API/workers. Set `CALL_RUNTIME_PROFILE=managed`, remove conflicting
legacy overrides, run the same configuration/check commands and restart the matching
builds. Prepare and approve new plans for managed calls. Keep the upgraded database
and history readers: changing a runtime profile does not downgrade the schema or
make an old binary compatible with newly stored data.

Leaving `CALL_RUNTIME_PROFILE` unset keeps legacy mode selection available, including
native v1 and Realtime. That compatibility path does not enforce a runtime/preparation
pair and is not the recommended deployment configuration. Changing only the old
experiment flag does not activate the named-profile checks.

## Sources and verification

The [profile registry](../apps/api/src/config/runtime-profile.ts) is the single mapping
of profile names to releases and preparation policies. See the
[configuration command](../apps/api/src/db/configure-runtime-profile.ts),
[startup check](../apps/api/src/runtime/runtime-profile-readiness.ts),
[profile tests](../apps/api/src/config/runtime-profile.test.ts) and
[PostgreSQL transition tests](../apps/api/src/db/configure-runtime-profile.integration.test.ts).
Tests cover compiler/schema selection, conflicting flags, preview, concurrent/repeated
application, immutable requests, active-work refusal, checksums, rollback, startup
mismatch, authenticated admin diagnostics and seven-language status rendering.
After the build, CI runs `runtime:test:build` against another disposable database.
It checks the actual production CLI, including the guarantee that preview, check
and apply do not run migrations themselves, and exercises native activation and
managed rollback. The migrator's entrypoint is explicitly restricted to its own
filename so importing catalog helpers in a bundled command cannot execute it.
