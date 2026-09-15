# Documentation index

Release status refreshed 2026-09-15, including `4147ded` and workflow feedback. Public brand: SHPROHLI;
internal package names, cookies and database identifiers still use callassist.

Start with the references below. Dated plans, audits and test reports record what was
proposed or verified at that time; they are not parallel backlogs or proof of today's
deployment. [Reconciliation report](documentation-sync-2026-09-12.md) records the
mismatches corrected and the source checks behind that update. The fresh
[public-testing audit](public-testing-audit-2026-09-13.md) supersedes older readiness
claims. Subsequent [B01/B02 remediation](b01-b02-remediation-2026-09-13.md) closes the dependency
and Admin System defects locally; **NO-GO** remains for the other release gates.
The [email/SMS checkpoint](email-sms-implementation-2026-09-14.md) records implemented
verification and notices, CH/UA policy, Gmail/CH SMS user acceptance, revised email
design, current automated checks and the remaining B03/B04/B12 boundaries.
Use [mvp-plan.md](mvp-plan.md) for the minimum B01–B12 backlog; old R/W/C IDs are
mapped there and are not separate work queues.

## Current references

The latest local landing is **r8 EN/DE** with an interactive demo; see the
[implementation and verification record](interactive-landing-2026-09-14.md).
This closes the four product review changes locally, not the external release gates.

| Document | Purpose |
| --- | --- |
| [Project README](../README.md) | Product scope, setup, commands and repository status |
| [Architecture](architecture.md) | Current languages, appointments, consent, call control, summary schema, live state, privacy and limits |
| [Runtime/API reference](runtime-reference.md) | Actual configuration defaults, process topology and all 107 registered method/path pairs |
| [Deployment preflight](deployment-preflight.md) | Proxy/env preparation and first release on shprohli.ch after landing completion; actual VPS deployment remains open |
| [Landing checkpoint, 2026-09-14](landing-checkpoint-2026-09-14.md) | Before/after screenshots, six EN/DE task groups and local publication results |
| [Conversation credits, 2026-09-14](conversation-credit-2026-09-14.md) | Substantive-answer policy, atomic settlement, classification limits, migration 0071 and verification |
| [Beta controls and stability, 2026-09-14](beta-controls-2026-09-14.md) | Admin cap/invitations, 7-minute calls, concurrency, conservative USD budget and recompile deadlock fix |
| [Budget accounting, 2026-09-15](budget-accounting-2026-09-15.md) | Current usage/charge reconciliation, pending costs, migration 0072 and local revision 3 calibration |
| [Plan preparation quality, 2026-09-15](plan-preparation-quality-2026-09-15.md) | Latency incident, compact generation, real review translations, 20,000-token ceiling and dated timing evidence |
| [Workflow feedback, 2026-09-15](workflow-feedback-2026-09-15.md) | Persistent preparation status, review spacing, call-state animation, 216 web tests and browser-check boundaries |
| [Email/SMS implementation, 2026-09-14](email-sms-implementation-2026-09-14.md) | Verification/notifications, seven-language capability matrix, provider configuration and remaining B03/B04 acceptance |
| [Release roadmap](mvp-plan.md) | Delivered scope, next work and open acceptance/deployment gates; the single current backlog |
| [Public-testing audit, 2026-09-13](public-testing-audit-2026-09-13.md) | Fresh code/test/browser/local-CMS evidence; email/SMS/admin findings, scenario pool and minimum release boundaries |

## Policies and operations

| Document | Purpose |
| --- | --- |
| [Operations](operations-readiness.md) | Health, minimized logs, worker/result/live-state diagnosis, recovery and deployment gaps |
| [Database recovery and secrets](database-recovery-and-secrets.md) | Rotation/restore procedures, seventeen ciphertext columns and dated evidence |
| [Data deletion](data-deletion-policy.md) | Provider-first deletion, artifact fencing/redaction, account anonymization and contact cleanup |
| [Password recovery](password-recovery-policy.md) | Verified-phone recovery, bounded capabilities and session invalidation |
| [Phone change](phone-change-policy.md) | Session-bound replacement, OTP and temporary challenge lifecycle |
| [Rate limiting](rate-limit-policy.md) | Shared atomic endpoint limits, artifact budgets and operational boundaries |
| [Real-provider drills](real-provider-drills.md) | Current UI procedure, CLI review-receipt limitation and dated supervised evidence |
| [Admin architecture](admin-interface-architecture.md) | English-only admin surface, route/layout boundaries and roles |
| [Public content staging](public-content-staging-2026-09-09.md) | Candidate/dry-run/staging procedure and dated unpublished drafts; source copy is not publication evidence |

## Latest delivery and verification records

| Record | What it establishes |
| --- | --- |
| [Workflow feedback, 2026-09-15](workflow-feedback-2026-09-15.md) | Latest web checkpoint: 216 tests, lint/types/build; EN/DE desktop/mobile fixture checks. Real-provider and full assistive-technology acceptance remain open |
| [Budget accounting, 2026-09-15](budget-accounting-2026-09-15.md) | 47 targeted accounting/admin/migration checks; recorded local migration 0072 and revision 3; no new paid calls |
| [Plan preparation quality, 2026-09-15](plan-preparation-quality-2026-09-15.md) | 281 targeted API and 77 web tests, four real text probes at the former 5,000-token ceiling; final configured ceiling is 20,000 |
| [Beta controls and stability, 2026-09-14](beta-controls-2026-09-14.md) | Current admission/spend implementation and closure of the local recompile defect; external configuration/drills still required |
| [Email/SMS checkpoint, 2026-09-14](email-sms-implementation-2026-09-14.md) | Historical automated results and original recompile defect; real EN Gmail/CH SMS user evidence; remaining UA, email-client and provider-flow acceptance |
| [B01/B02 remediation, 2026-09-13](b01-b02-remediation-2026-09-13.md) | Historical checkpoint: 1,102 tests / 139 files on isolated DB; lint/types/build pass; dependency audit clean; System regressions, independent control and browser-check boundary |
| [Original readiness verification, 2026-09-13](audits/2026-09-13/evidence.json) | Pre-fix snapshot: 1,098 tests / 138 files; dependency audit failed; sanitized HTTP checks and fictional browser captures. B01/B02 superseded by remediation above |
| [General result/live fixes, 2026-09-11](call-result-live-fixes-2026-09-11.md) | Retry/status/request-budget fixes across task types, live transcript identity/following, six fictional real-text scenarios, browser fixture, authorized local result recovery and remaining voice acceptance |
| [Live call audit, 2026-09-11](call-result-live-audit-2026-09-11.md) | Findings before those fixes; confirmed personal meeting, failed result generation and following problems |
| [Conversation/result stabilization, 2026-09-10](call-conversation-result-stabilization-plan-2026-09-10.md) | C01–C06 implementation, interrupted farewell, silent controls, compact schema-2 summaries, 0068 telemetry and local cutover |
| [Unified delivery plan, 2026-09-09](unified-implementation-plan-2026-09-09.md) | W00–W10 decisions/delivery and subsequent bounded appointment extension; remaining work belongs to the roadmap |
| [Language implementation verification](verification-language-implementation-2026-09-09.md) | Dated checks of migrations 0063–0067, review receipts, language separation and text fixtures |
| [Language UI verification](verification-language-ui-2026-09-09.md) | Initial browser states, superseded in part by the simplified language workflow |
| [Text-data verification](verification-text-data-2026-09-09.md) | Local rotation, restore and deletion checks for encrypted text artifacts |
| [Language UI simplification](ui-language-simplification-2026-09-09.md) | Detection-first task language, compact correction, removed independent result selectors and browser checks |
| [PDF export restoration](pdf-export-redesign-2026-09-09.md) | Shared branded transcript renderer, pagination and synthetic PDF checks |
| [Hangup runtime restoration](hangup-runtime-restoration-2026-09-09.md) | Local feature-flag diagnosis and restart evidence; repository default stays false |

The 2026-09-13 total belongs to one full-suite run, not a sum of historical reports.
Older records can contain a full run followed by narrower checks; the 2026-09-11
record states that boundary explicitly. Release acceptance requires fresh evidence
after remediation on its candidate commit.

## Earlier decisions and historical evidence

| Record | How to use it |
| --- | --- |
| [Roadmap snapshot through 2026-09-12](release-roadmap-history-2026-09-12.md) | Preserved pre-consolidation working-copy text; R01 closed status is historical and superseded by B01 |
| [Language architecture rationale](language-workflow-architecture-2026-09-09.md) | Independent language domains and extensibility decisions; current fields and workflow are in architecture/contracts |
| [Promise/implementation gap plan](promise-implementation-gap-plan-2026-09-08.md) | Original feasibility map; translation, result and appointment gaps have since been addressed in code |
| [Landing audit](landing-audit-2026-09-08.md) | Dated UX/positioning findings, not a fresh audit of the changed landing |
| [Immutable plans and cost delivery](approved-call-plan-cost-security-roadmap.md) | Historical increments and the still-relevant staged migration procedure through 0061 |
| [R21 small improvements](small-improvements-implementation-plan-2026-09-08.md) / [verification](r21-verification-2026-09-08.md) | Favicon, editable profile defaults and initial playback-aware hangup, including one Russian live drill |
| [Merge verification](merge-verification-2026-09-07.md) | Mainline integration checks at that date |
| [Remediation](remediation-2026-09-07.md) / [project audit](project-audit-2026-09-07.md) | Original defects, fixes and dated dependency/test/recovery evidence |
| [Account improvements](account-profile-improvement-plan.md) | Delivered profile/contact workflows, current operational limits and outstanding browser/notification work |
| [Voice consent](outbound-voice-consent-implementation-plan.md) | Implemented recognition/playback boundary and short spoken notice decision |
| [Post-call transcription](post-call-transcription-plan.md) / [channel-aware decision](channel-aware-final-transcription-plan.md) | Recording-derived utterance ASR and full-file fallback; dated experiments are not current quality guarantees |
| [UI stabilization](ui-ux-stabilization-plan.md) | Earlier design checklist; remaining accessibility work is R13 |

## Design baseline

[Emerald Paper guidelines](../Design/system-2026-09-07/GUIDELINES.md),
[design package](../Design/system-2026-09-07/README.md),
[implementation coverage](../Design/implementation-2026-09-07/COVERAGE.md) and
[application design QA](../design-qa.md) preserve the accepted 2026-09-07 visual
baseline. Screens and fixtures in those dated directories predate later language,
appointment and result changes. They are not a current route/feature specification.
Private runtime captures and local account data are not release evidence stored in Git.
The [2026-09-13 audit captures](audits/2026-09-13/README.md) are a separate, sanitized
set from an isolated mock fixture with fictional users; they do not show production.

## Keeping documentation aligned

- Update architecture/policy and the roadmap when behavior changes; link to the
  source contract rather than maintaining another independent feature checklist.
- Mark proposed work, implemented code, dated verification and published/deployed
  state separately. Keep historical test results and failure evidence dated.
- Regenerate the route inventory from registrations, including dynamic route loops;
  verify configuration against `.env.example`, runtime factories and package scripts.
- Adding a UI language requires the registry/dictionary and display checks; it does
  not require another call-domain schema or imply a new enabled provider direction.
- Do not rewrite applied migrations, approved snapshots or CMS publications to repair
  documentation. CMS changes use the normal candidate/review/publication workflow.
