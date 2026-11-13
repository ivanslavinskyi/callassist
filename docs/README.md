# Documentation

**Source reviewed:** 2026-11-13, stable checkpoint `stable-2026-11-13`; schema catalog `0001`–`0116`.

The maintained documents describe implemented behavior. Native GPT-Live v2 was
accepted as the stable implementation on 2026-11-08 after local telephone testing.
Its current configuration supports explicit activation in development and production.
The environment example selects the stable native profile; managed Live remains the
default without a profile and a recovery option on a compatible build. The current
native profile uses compiler 17 / plan schema 11 / approval 10, with the approved
localized plan as the sole conversation task context. Post-call assessment retains
the original source. The [10 November stabilization record](plans/native-runtime-plan-boundary-stabilization-2026-11-10.md)
distinguishes automated checks and the owner-reported successful local test from
production rollout, which remains separate. The
[11 November preparation and appointment record](reports/preparation-holistic-validation-2026-11-11.md)
documents that release's diagnostics, verification and user-reported local acceptance.
The [12 November stable checkpoint](reports/native-brand-stable-2026-11-12.md)
records the current runtime `live-plan-only-2026-11-12.2`, accepted pronunciation,
German greeting and transcript spelling. Host-specific evidence stays in local operational records.
The [13 November stable checkpoint](reports/preparation-results-stable-2026-11-13.md)
adds preparation reliability, display translation and conversation-based results,
retaining that voice runtime. The separate
[production activation list](plans/production-activation-stable-2026-11-13.md)
identifies the saved policy and code versions required on production.

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

[Conversation-based assessment and appointment card, 13 November 2026](reports/conversation-assessment-2026-11-13.md)
records summary v9, retained runtime and billing boundaries, regression tests and
the offline replay of the last local call. Internal registration no longer gates
an agreement evidenced by the conversation.

[Brand pronunciation, German greeting and stable checkpoint, 12 November 2026](reports/native-brand-stable-2026-11-12.md)
records the accepted instruction-only change, display spelling, regression coverage
and the Git/CI checkpoint. It preserves the prior preparation and action contracts.

[Task boundaries, participant roles and silent closing, 9 November 2026](reports/native-task-boundary-2026-11-09.md)
records that release, its unchanged SQL catalog, regression coverage, CI and
deployment evidence, with production telephone acceptance still pending.

[Task information, testing and PDF assessment, 8 November 2026](reports/task-input-testing-implementation-2026-11-08.md)
records the subsequent feature implementation, migration/backfill, automated checks
and local restart.

[Native integrity implementation, 8 November 2026](reports/native-live-integrity-2026-11-08.md)
records the earlier native integrity checkpoint, dated test evidence, local activation
and outstanding acceptance. It does not claim fresh telephone validation.

## Implementation plans

[Preparation audit reliability and simplification, 13 November 2026](plans/preparation-audit-reliability-2026-11-13.md)
implements a follow-up: narrow blocking to material task/authority differences,
clarify existing executable authority semantics, repair the affected permissions
while preserving unrelated content, and isolate review-translation validation.
The second incident confirms that a prose-only fallback repair must still fail
review. The plan records voice, post-call assessment and credit compatibility gates.
The [implementation report](reports/preparation-material-validation-2026-11-13.md)
distinguishes offline checks, the bounded paid evaluation, local activation and
outstanding telephone/production gates. The separate
[review-translation report](reports/review-translation-simplification-2026-11-13.md)
records simplified display validation and the successful local incident retry.
The subsequent [multilingual USD 4 evaluation](reports/preparation-multilingual-validation-2026-11-13.md)
records 48 real preparations and remaining reproducible audit/canonical-language
defects. Ready status alone is not the acceptance criterion for these results.
The [preparation v2 follow-up](reports/preparation-reliability-v2-2026-11-13.md)
records fixes, paired replays within the same allocation, audit controls and the
unchanged voice/assessment boundaries.

[Simplifying plan preparation and failure diagnostics](plans/preparation-audit-simplification-2026-11-11.md)
records the smaller compiler contract, holistic audit, one shared recovery,
compatibility with the current voice runtime and detailed failure diagnostics,
including evaluation and rollout. It is implemented and activated locally;
[validation evidence](reports/preparation-holistic-validation-2026-11-11.md) records
regressions, repeated model evaluation and the limits of local verification.

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
