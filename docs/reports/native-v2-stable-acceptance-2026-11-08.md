# Native v2 stable acceptance

**Decision date:** 2026-11-08, Europe/Zurich.\
**Scope:** accepted implementation for integration into `main`; production rollout is a separate step.

The product owner accepted Native v2 as the stable runtime after successful local
telephone testing, including a conditional appointment task with substantially
impaired speech. This records product acceptance of the implemented behavior, not
a statistical quality or latency guarantee across every speaker and scenario.

## Accepted implementation

The accepted conversation identity is `live-native-context-2026-11-08`, with
`gpt-live-1` and Responses delegation to `gpt-6-luna`. The tested preparation policy
is `preparation-live-native-integrity-2026-11-08`, compiler 13, plan schema 9 and
approval 8. Results use summary-v8. The merge includes native action validation,
recording/privacy handling, telemetry, historical readers, tester scenarios,
expense attribution and first-page PDF assessment.

The latest reviewed call used the current source descriptor. The saved task result
and action journal agreed on a confirmed appointment within the approved price and
time constraints. Result generation succeeded on its first request. Native capture
and protocol trace completed without reported loss. The application disconnected
after the closing playback check.

## Known limits retained in the baseline

- Some recipient captions were inaccurate. Backend clarification recovered the
  required price and date before the concrete appointment was authorized.
- The closing recovery mechanism supplied the final delegation. The measured
  interval from last forwarded speech to hangup request was approximately 5.6 seconds;
  this is an application-side measurement, not an acoustic measurement at the phone.
- General, refusal, voicemail and other appointment profiles retain the software
  coverage recorded in the earlier implementation reports. This particular call does
  not establish fresh telephone acceptance for every profile.

## Integration and rollout boundary

The pre-merge full API run exposed a missing translation lookup for the updated
retention copy. Locale completion now uses the same reviewed translations as the
retention migration. Historical-copy fixtures, the encryption inventory count and
the compatible history-reader expectation were aligned with the implemented
schema and reader behavior. No conversational prompt was changed by these fixes.

The integration preserves the tested prompts and runtime identity. It does not
silently change the managed default or remove the current Native v2 production
guard. The retained managed runtime remains a rollback option; new plans should be
prepared and approved under the selected preparation policy when comparing modes.

Production activation must explicitly align runtime selection, preparation policy,
migrations through `0115`, encryption/backfill, public recording disclosure and
operational rollback. That is the next release step after the merged commit passes
CI. No production deployment is claimed by this acceptance record.

See [runtime contracts](../native-live-runtime.md), [validation procedures](../native-live-validation.md)
and [the feature implementation record](task-input-testing-implementation-2026-11-08.md)
for implementation details and prior verification evidence.

Subsequent change: [production preparation](native-v2-production-readiness-2026-11-08.md)
removes the environment restriction and records the migration rehearsal. The guard
statements above describe the original integration checkpoint, not the later code.
