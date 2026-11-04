# Documentation

Current source reference, updated 2026-10-07 for call review and owner result emails
(schema 0001–0109; implementation verification is recorded below):

- [Engineer guide](engineer-guide.md): architecture, domain rules, runtime, API map,
  languages, storage, costs, telemetry, permissions and development workflow.
- [Architecture entry point](architecture.md) and [API/configuration reference](runtime-reference.md).
- [Preparation runtime](preparation-runtime.md): current model selection, role workers,
  shared admission, deadlines, streaming protection and verification tools.

Dated design and verification records (their tests and observations retain their original dates):

- [Universal user-information disclosure plan, 4 November](user-information-disclosure-plan-2026-11-04.md):
  minimal shared compiler/Live/backend instruction, existing translated snapshots,
  482 regression checks and manual conversation acceptance pending.
- [No-phone model probe results, 2 November](voice-no-call-results-2026-11-02.md):
  authorized $5 smoke, 16 backend requests and 6 synthetic Live sessions; findings,
  budget accounting and harness limits. Release held; no telephone calls.
- [Controlled voice acceptance, 2 November](voice-acceptance-protocol-2026-11-02.md):
  synthetic actor scripts, baseline/candidate matrix, offline worksheet generator,
  evidence and stop criteria. No external calls or release approval.
- [Real-call hardening plan, 2 November](real-call-hardening-plan-2026-11-02.md):
  evidence from a successful appointment call, independent fixes, runtime invariants,
  regression checks and rollback criteria.
- [Real-call implementation and verification, 2 November](real-call-hardening-implementation-2026-11-02.md):
  stages A–H: baseline, summary selection, spoken timezone copy, service speech,
  continuation recovery, closing investigation, playback diagnostics and optional
  clinic preparation; 4 November precommit fixes cover archive-compatible admin
  reads, baseline loading and the test runner, with regression results and rollout
  constraints. Local verification; no production rollout or new telephone call.

- [Call review and user result email implementation](call-review-and-user-email-plan-2026-10-07.md):
  approved behavior, completed implementation and local verification of demo contrast,
  responsive approval, creation-language snapshots and durable owner emails.

- [Hybrid consent implementation](hybrid-consent-implementation-2026-10-04.md):
  pinned admin policy, deterministic recognition and consent/recording audit.
- [Live v9 stability and call evidence](live-runtime-stability-plan-2026-10-04.md):
  historical opening/closing investigation. The engineer guide describes the later
  opening-audio and browser transcript fixes included in `879dec5`.
- [Preparation latency diagnostics](preparation-latency-diagnostics-2026-10-04.md):
  provider/transport measurements, interpretation and verification.
- [Preparation implementation re-audit](preparation-implementation-audit-2026-10-05.md):
  reproduced HTTP/retry/deadline defects, incident evidence and a smaller first change.
- [Preparation performance and scaling plan](preparation-performance-and-scaling-plan-2026-10-05.md):
  proposed streaming telemetry, admin model and Fast mode policy, worker roles,
  multiuser concurrency and capacity validation. Not an implementation record.
- [Preparation implementation evidence](preparation-performance-implementation-2026-10-05.md).
- [Approved audit and implementation plan](pre-production-audit-and-implementation-plan-2026-10-01.md).
- [Implementation and verification record](pre-production-implementation-2026-10-01.md).

The [archive](archive/README.md) preserves dated investigations, intermediate
designs and previous acceptance evidence. It is not a current specification.
Historical files may describe removed components or old limits.

Deployment procedures, backup/recovery runbooks and VPS topology are kept only
in the ignored local docs/local-operations/ directory. Obtain those operational
materials directly from the maintainer; they are intentionally absent from a clone.
No tracked document is evidence of the current production configuration.
