# Documentation

Current source reference, updated 2026-10-04:

- [Engineer guide](engineer-guide.md): architecture, domain rules, runtime, API map,
  languages, storage, costs, telemetry, permissions and development workflow.
- [Architecture entry point](architecture.md) and [API/configuration reference](runtime-reference.md).
- [Hybrid consent implementation](hybrid-consent-implementation-2026-10-04.md):
  pinned admin policy, deterministic recognition and consent/recording audit.
- [Live v9 stability and call evidence](live-runtime-stability-plan-2026-10-04.md):
  opening/closing transitions and the pending quiet-room comparison after a
  delayed opening with background speech.
- [Preparation latency diagnostics](preparation-latency-diagnostics-2026-10-04.md):
  provider/transport measurements, interpretation and verification.
- [Approved audit and implementation plan](pre-production-audit-and-implementation-plan-2026-10-01.md).
- [Implementation and verification record](pre-production-implementation-2026-10-01.md).

The [archive](archive/README.md) preserves dated investigations, intermediate
 designs and previous acceptance evidence. It is not a current specification.
Historical files may describe removed components or old limits.

Deployment procedures, backup/recovery runbooks and VPS topology are kept only
in the ignored local docs/local-operations/ directory. Obtain those operational
materials directly from the maintainer; they are intentionally absent from a clone.
No tracked document is evidence of the current production configuration.
