# Native task boundaries, roles and silent closing — 9 November 2026

Historical report for the previous runtime. Its raw-source context and approval
contract are superseded by [the plan-only runtime](../native-live-runtime.md)
implemented on 10 November 2026; they are not current execution requirements.

**Status:** implemented and pushed; exact-commit CI passed; the owner reported a
completed production rollout. Production telephone acceptance of this release is
not yet recorded. Host details, backup identifiers and configuration snapshots
remain in the ignored local operational journal.

## Release identity

Application commit: `23427414cdcf697914041e272c145b97867e041c`, including the preceding
participant-role correction `449919f5ae3b94715fa780ed9f5c92797bdf5809`.
[CI run 42633985782](https://github.com/ivanslavinskyi/callassist/actions/runs/42633985782)
completed successfully for that exact commit.

| Boundary | Version |
| --- | --- |
| Named profile / release | `native_v2` / `native-v2-task-2026-11-09` |
| Runtime and prompt identity | `live-native-task-2026-11-09` |
| Preparation policy | `preparation-live-native-task-2026-11-09` |
| Compiler / compiled plan / execution snapshot | 15 / 10 / 9 |
| SQL catalog | 115 migrations through `0115_default_audio_retention_copy.sql`; unchanged |

## Implemented behavior

- Principal, recipient and third-party subjects remain distinct even when names
  overlap. Preparation compares meaning as well as identity spelling.
- User restrictions and criteria remain grounded in task sources. Optional sections
  may be empty. Internal model instructions are not manufactured as user constraints.
- Audit-only `taskEvidence` is hashed and stored with the compilation. Exact source
  validation and the existing combined semantic/language audit check provenance,
  omitted restrictions, corrections and conditional branches. The same request and
  repair budget applies; no ordinary-turn Live gate or additional audit stage is added.
- Review hides empty sections and preserves explicit restrictions. Execution plans
  and Live prompts omit audit provenance. Existing policy prompts, schemas, hashes
  and approved artifacts retain their compatibility paths.
- Live gives one natural farewell, then delegates silently. Backend alone extracts
  closing evidence. General `end_call` requires `noActionRequired=null`; appointment
  profiles keep their conditional evidence. Substantive corrections remain answerable.
- Admin diagnostics, provider expense accounting and telemetry export support the
  new formats through existing paths. Their regression coverage includes semantic
  repair costs, immutable approvals, retained evidence and minimized admin timelines.

Normative details: [preparation](../preparation-runtime.md),
[native runtime](../native-live-runtime.md), [profiles](../runtime-profiles.md).

## Verification and limits

CI passed license/catalog checks, dependency audit, public-copy checks, lint,
typechecks, tests, resumable re-encryption, backup/restore, builds and built runtime
profile activation/managed rollback. Local contract and web suites passed 290 and
463 tests respectively. Added regressions cover source support, explicit restrictions,
conditional outcomes, bounded repair, request accounting, PostgreSQL persistence,
all five native profiles on snapshot versions 8/9, UI locales and telemetry export.

The owner reported that the local call looked good. This is qualitative acceptance
of that call, not proof of stable behavior for every scenario. No separate paid
model-evaluation run was performed: diagnostic project credentials were absent.
Mocked auditor verdicts prove repair/control handling, not remote-model accuracy.

## Owner-reported production rollout

The owner executed supervised commands and supplied their output; the agent had
no direct production connection. The candidate checked the existing ledger without
SQL changes. After admission/write pause and drain, all six application services
stopped and a fresh dump was fully decoded for verification. That particular dump
was not separately restored during this rollout.

Policy activation changed integrity revision 6 to task revision 7 and preserved
model/capacity settings. Compilation/approval, recording and credit fingerprints
were unchanged; accounting and trace row counts were unchanged during activation.
All six processes ran the target release without restarts. Readiness, public sites,
registration policy and voice-host isolation checks passed. The owner confirmed
API writes open and call admission enabled. No test call was started by deployment.

New preparation and approval are required to exercise compiler 15. Older binaries
must not be restarted blindly after new JSON formats are stored, even though the
SQL catalog is unchanged. Recovery uses a compatible build and explicit policy
alignment; the maintained [profile procedure](../runtime-profiles.md#rollback)
describes this boundary.
