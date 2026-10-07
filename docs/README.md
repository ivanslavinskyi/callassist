# Documentation

Current source reference, checked 2026-10-07 against `879dec5` (schema 0001–0108):

- [Engineer guide](engineer-guide.md): architecture, domain rules, runtime, API map,
  languages, storage, costs, telemetry, permissions and development workflow.
- [Architecture entry point](architecture.md) and [API/configuration reference](runtime-reference.md).
- [Preparation runtime](preparation-runtime.md): current model selection, role workers,
  shared admission, deadlines, streaming protection and verification tools.

Dated design and verification records (their tests and observations retain their original dates):

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
