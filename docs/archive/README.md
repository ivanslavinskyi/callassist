# Documentation archive

**Archive review:** 2026-11-08.

These records preserve earlier plans, audits, incidents and verification evidence.
They may describe retired implementations, previous models, old schemas, historical
test counts or failed candidates. They are not current specifications or deployment
evidence. Original languages and dates are retained intentionally.

Use the [documentation index](../README.md), [native runtime](../native-live-runtime.md),
[preparation reference](../preparation-runtime.md) and [validation guide](../native-live-validation.md)
for maintained English documentation. The [native integrity record](../reports/native-live-integrity-2026-11-08.md)
and subsequent [task information and testing record](../reports/task-input-testing-implementation-2026-11-08.md)
retain their separate verification scopes.

## Archival decisions

The November review moved 29 dated Markdown records out of the active documentation:
10 into `2026-10/` and 19 into `2026-11/`. Their bodies are preserved, with an English
archive notice and relocated links. No evidence was deleted or translated in place.

| Material | Reason for archiving | Current reference |
| --- | --- | --- |
| Completed platform, call review and email plans | Implementation is now described in maintained references | [Engineer guide](../engineer-guide.md) |
| Preparation audits, diagnostics and scaling proposal | Dated measurements/proposals are not current capacity guarantees | [Preparation runtime](../preparation-runtime.md) |
| Managed consent, stability and A0–A3 investigations | Retained compatibility behavior and earlier acceptance outcomes must not be confused with native v2 | [Runtime reference](../runtime-reference.md) |
| Native v1, initial v2, actions, closing and integrity plans | Superseded stages; current integrated behavior and remaining acceptance are consolidated | [Native runtime](../native-live-runtime.md), [validation](../native-live-validation.md) |
| Real-call reviews and no-phone probes | Evidence applies to a dated runtime, scenario and budget | [Native integrity record](../reports/native-live-integrity-2026-11-08.md) |
| Earlier voice acceptance protocol | Retains historical actor scripts and worksheet procedure; current native acceptance is maintained separately | [Native validation](../native-live-validation.md) |

The [scenario JSON fixture](../voice-acceptance-scenarios-2026-11-02.json) stays in
`docs/` because executable scripts use that path. The archive move does not rename
or change those scripts. Local deployment/runbook material remains ignored under
`docs/local-operations/`; it is not published as archival evidence.

The [task input and testing plan](../plans/task-input-retention-and-test-scenarios-2026-11-08.md)
remains under `plans/` because controlled telephone acceptance is outstanding. Its
implementation checkpoint and the dated records under `reports/` remain available
from the maintained index. No additional archival move is needed for this update;
current behavior belongs in [task information and testing](../task-input-and-testing.md).

## October 2026 records

- [Call review and owner email implementation](2026-10/call-review-and-user-email-plan-2026-10-07.md) — 2026-10-07.
- [Hybrid consent feasibility](2026-10/hybrid-consent-feasibility-plan-2026-10-04.md) — 2026-10-04.
- [Hybrid consent implementation](2026-10/hybrid-consent-implementation-2026-10-04.md) — 2026-10-04.
- [Managed Live stability investigation](2026-10/live-runtime-stability-plan-2026-10-04.md) — 2026-10-04.
- [Pre-production audit and plan](2026-10/pre-production-audit-and-implementation-plan-2026-10-01.md) — 2026-10-01.
- [Pre-production implementation evidence](2026-10/pre-production-implementation-2026-10-01.md) — 2026-10-01.
- [Preparation implementation re-audit](2026-10/preparation-implementation-audit-2026-10-05.md) — 2026-10-05.
- [Preparation latency diagnostics](2026-10/preparation-latency-diagnostics-2026-10-04.md) — 2026-10-04.
- [Preparation performance and scaling plan](2026-10/preparation-performance-and-scaling-plan-2026-10-05.md) — 2026-10-05.
- [Preparation performance implementation](2026-10/preparation-performance-implementation-2026-10-05.md) — 2026-10-05.

## November 2026 records

- [Native appointment actions implementation](2026-11/live-native-actions-implementation-2026-11-06.md) — 2026-11-06.
- [Native automatic answers and retry](2026-11/live-native-answering-retry-2026-11-07.md) — 2026-11-07.
- [Native closing recovery implementation](2026-11/live-native-completion-implementation-2026-11-07.md) — 2026-11-07.
- [Native consistency audit baseline](2026-11/live-native-consistency-audit-2026-11-06.md) — 2026-11-06.
- [Native v1 experiment plan](2026-11/live-native-experiment-plan-2026-11-05.md) — 2026-11-05.
- [General-profile hangup investigation](2026-11/live-native-general-hangup-audit-2026-11-07.md) — 2026-11-07.
- [Native integrity audit and plan baseline](2026-11/live-native-integrity-audit-plan-2026-11-08.md) — 2026-11-08.
- [Original native integrity implementation evidence](2026-11/live-native-integrity-implementation-2026-11-08.md) — 2026-11-08.
- [Native profile stabilization evidence](2026-11/live-native-profiles-stabilization-2026-11-06.md) — 2026-11-06.
- [Native real-call review](2026-11/live-native-real-call-review-2026-11-07.md) — 2026-11-07.
- [Native v2 initial implementation evidence](2026-11/live-native-v2-implementation-2026-11-06.md) — 2026-11-06.
- [Native v2 implementation plan](2026-11/live-native-v2-implementation-plan-2026-11-06.md) — 2026-11-06.
- [Managed A0–A3 candidate and failed acceptance](2026-11/live-runtime-a-implementation-2026-11-05.md) — 2026-11-05.
- [External GPT-Live audit validation](2026-11/live-runtime-audit-validation-plan-2026-11-05.md) — 2026-11-05.
- [Managed real-call hardening implementation](2026-11/real-call-hardening-implementation-2026-11-02.md) — 2026-11-02.
- [Managed real-call hardening plan](2026-11/real-call-hardening-plan-2026-11-02.md) — 2026-11-02.
- [User-information disclosure plan](2026-11/user-information-disclosure-plan-2026-11-04.md) — 2026-11-04.
- [Earlier controlled voice acceptance protocol](2026-11/voice-acceptance-protocol-2026-11-02.md) — 2026-11-02.
- [Historical no-phone model probe results](2026-11/voice-no-call-results-2026-11-02.md) — 2026-11-02.

## Earlier archive

Earlier records remain in this directory at their existing paths. Browse the
[archive directory](.) for older implementation, migration, pricing, privacy and
incident records. They retain the same historical-only status. A record's original
open checklist is not automatically the current backlog; consult the maintained
specification and latest verification scope before acting on it.
