# Production activation list — stable-2026-11-13

Prepared 13 November 2026. This is the activation contract for the accepted source
checkpoint, not evidence of a production deployment. The exact commit and successful
CI run are recorded in the annotated `stable-2026-11-13` tag. Verify the actual
production baseline before rollout; matching voice identities alone do not prove
matching preparation or result versions.

## New versions

| Component | Required identity | Activation |
| --- | --- | --- |
| Native profile release | `native-v2-holistic-2026-11-13-v2` | Supplied by the new build with `CALL_RUNTIME_PROFILE=native_v2` on API and every worker |
| Saved preparation policy | `preparation-live-holistic-2026-11-13-v2` | Explicit audited `runtime:configure --apply` from the candidate build |
| Plan/clarification display review | `review-translation-v1:text-processing-v2:<driver>:<model>` | Selected automatically for new reviews by the new code; no database switch |
| Post-call summary and assessment | `summary-v9:grounded-v3:text-processing-v2:<driver>:<model>` | Selected automatically for new summaries by the new API/worker code; no database switch |

Activate the final `2026-11-13-v2` policy directly. The intermediate
`preparation-live-holistic-2026-11-13` is retained for historical compatibility and
does not need a separate rollout. The integer saved-policy revision is local to
each database: let the configurator increment it; never copy a local revision number.
Model suffixes reflect the existing configured models, not a requested model change.

## Preserved versions and settings

| Component | Expected value |
| --- | --- |
| Profile selector | `CALL_RUNTIME_PROFILE=native_v2` |
| Voice implementation | `live-plan-only-2026-11-12.2` |
| Compiler / plan schema / approval | `brief-compiler-17` / 11 / 10 |
| Summary extraction / schema-11 source context | `native-summary-v3` / 3 |
| Text processor base | `text-processing-v2` |
| SQL catalog | Through `0116_preparation_validation_events.sql`; no new migration in this checkpoint |
| Models / voices / tiers / budgets / capacity / pricing | Preserve existing production settings |

## Activation order and acceptance

1. Build the exact CI-passed tag and verify applied migration names/checksums through
   0116. Use the candidate build and production environment to preview the profile
   configuration. Keep the current profile/models/voice settings for comparison.
2. Use the host's existing supervised deployment procedure to pause admission and
   writes, drain active calls/preparations/relevant jobs, stop API and workers,
   and verify a current backup. Keep all new components on the same commit.
3. From the built candidate, run the audited policy command and read-only check:

   ```sh
   corepack pnpm --filter @callassist/api runtime:configure:prod --apply
   corepack pnpm --filter @callassist/api runtime:check:prod
   ```

   Preview without `--apply`. These commands do not apply migrations, change models
   or start calls. Avoid direct SQL updates to the policy or its revision.
4. Start the matching API, worker and web builds. Verify `/health/ready`,
   `/health/workers`, the selected release and saved policy in Admin System.
5. After rollout authorization, prepare a new plan to verify the final preparation
   policy. Exercise a new translated review and inspect its version prefix.
   A controlled completed call should produce `summary-v9`; confirm conversation
   assessment and the appointment card for an explicit appointment task. General
   information calls must not gain a booking card. Observe normal credit settlement.
   Health checks alone do not verify model output or telephone behavior.

Existing ready reviews/results and queued jobs remain pinned. New preparation and
approval are needed to exercise the new policy. Historical reports are not bulk
regraded; the one local regression replay is not a production migration. A future
explicit display reassessment must preserve canonical billing evidence and credits.

## Rollback constraint

The current `scripts/shprohli-vps-release.sh` does not activate the saved policy and
can restart old binaries during automatic recovery. Do not use that automatic path
for this transition without the supervised profile step. Once the new policy or v9
artifacts exist, SQL catalog equality does not make the previous binary compatible.
Prefer a compatible forward fix; retain readers for the new artifacts. A managed
profile fallback on the new build is described in [runtime profiles](../runtime-profiles.md).
Host-specific commands, paths and credentials belong in the ignored operational runbook.
