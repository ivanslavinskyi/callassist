# Documentation

**Source reviewed:** 2026-11-08, current working tree; schema catalog `0001`–`0115`.

The maintained documents describe implemented behavior. Native GPT-Live v2 was
accepted as the stable implementation on 2026-11-08 after local telephone testing.
Its current configuration supports explicit activation in development and production.
The environment example selects the stable native profile; managed Live remains the
default without a profile and the named rollback option. Deployment remains separate. Source availability and local verification
do not establish what is deployed. See the [release decision](reports/native-v2-stable-acceptance-2026-11-08.md)
and [production preparation](reports/native-v2-production-readiness-2026-11-08.md).

## Maintained references

| Document | Purpose |
| --- | --- |
| [Architecture](architecture.md) | Components, ownership and evidence boundaries |
| [Engineer guide](engineer-guide.md) | Repository map, shared domain rules, development and operations interfaces |
| [Preparation runtime](preparation-runtime.md) | Policy/compiler versions, input limits, user-facing failures, admission and diagnostics |
| [Native GPT-Live runtime](native-live-runtime.md) | Startup context, prompts, action profiles, recording, closing, assessment, telemetry and costs |
| [Runtime profiles](runtime-profiles.md) | One environment selector, audited activation, startup alignment and managed rollback |
| [Runtime and API reference](runtime-reference.md) | Environment settings, API inventory and managed/legacy compatibility behavior |
| [Native validation](native-live-validation.md) | Reproducible checks, paid-probe boundaries, telephone scenarios and troubleshooting |
| [Task information and testing](task-input-and-testing.md) | Information sources, 30-day audio default, tester grants, scenario catalog, expense attribution and PDF assessment |

## Verification records

[Task information, testing and PDF assessment, 8 November 2026](reports/task-input-testing-implementation-2026-11-08.md)
records the subsequent feature implementation, migration/backfill, automated checks
and local restart.

[Native integrity implementation, 8 November 2026](reports/native-live-integrity-2026-11-08.md)
records the earlier native integrity checkpoint, dated test evidence, local activation
and outstanding acceptance. It does not claim fresh telephone validation.

## Implementation plans

[Task input, audio retention and test scenarios](plans/task-input-retention-and-test-scenarios-2026-11-08.md)
records the approved design and implementation decisions for facts in any task field,
context semantics, a 30-day audio default, scenario buttons and first-page PDF
assessment. The [implementation record](reports/task-input-testing-implementation-2026-11-08.md)
separates completed checks from remaining telephone acceptance.
The plan remains active as a delivery and acceptance record; its original investigation
describes the pre-change baseline. Maintained references describe current behavior.

## Historical material

The [archive index](archive/README.md) explains which audits, plans and intermediate
implementation records were retired from the active documentation and why. Original
dates, language and test evidence are preserved. An archived proposal is not an
unimplemented requirement merely because its original checklist remains open.

The reusable [voice acceptance scenario fixture](voice-acceptance-scenarios-2026-11-02.json)
remains here because executable validation scripts reference it. Its historical
origin does not make it a substitute for current native acceptance.
Host topology and deployment runbooks remain local under ignored `local-operations/`.

## Maintenance conventions

- Write maintained documentation in English; retain historical originals as evidence.
- State scope, status and source-review date. Separate defaults, local selections,
  supported compatibility behavior and future work.
- Link to implementation or contracts for normative behavior. Use relative repository
  links; avoid fragile source line numbers in maintained references.
- Keep one detailed specification per topic and cross-link it. Update affected
  references when changing contracts, settings, privacy or externally visible behavior.
- Record verification with its date and limits. Distinguish offline tests, paid model
  probes, telephone acceptance and deployment evidence.
- Archive superseded records with an English notice and update inbound links.
  Do not archive a still-used fixture or a unique current requirement without moving
  that requirement into a maintained reference.
