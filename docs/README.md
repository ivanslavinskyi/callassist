# Documentation index

Reviewed 2026-09-09 against base `7b86d3a` and the language implementation working tree. Public brand: SHPROHLI; internal package
names, cookies, database names and legacy migration identifiers still use callassist.

## Current sources of truth

| Document | Purpose |
| --- | --- |
| [Language implementation verification](verification-language-implementation-2026-09-09.md) | Current working-tree delivery, checks, schema 0067 and remaining release steps |
| [Merge verification](merge-verification-2026-09-07.md) | Historical mainline integration, checks and schema before the language package |
| [Immutable plans and cost delivery](approved-call-plan-cost-security-roadmap.md) | Immutable execution, provider ledgers, resumable ASR and staged cutover |
| [Project README](../README.md) | Product scope, local setup, commands and release status |
| [Architecture](architecture.md) | Implemented runtime, data, security, voice and worker boundaries |
| [Runtime/API reference](runtime-reference.md) | Configuration, process topology and source-derived route inventory |
| [Release roadmap](mvp-plan.md) | The current ordered backlog, acceptance criteria and GO/NO-GO gate |
| [Remediation, 2026-09-07](remediation-2026-09-07.md) | Closed technical blockers and current verification evidence |
| [Audit, 2026-09-07](project-audit-2026-09-07.md) | Dated findings, reproduction evidence, test results and limitations |

## Policies and operations

| Document | Current scope |
| --- | --- |
| [Operations](operations-readiness.md) | Health, logs, snapshot alerts, responders and deployment gaps |
| [Database recovery and secrets](database-recovery-and-secrets.md) | Restore/rotation procedure, seventeen-column text-data inventory and dated external evidence |
| [Data deletion](data-deletion-policy.md) | Provider-first deletion, anonymization, retained evidence and scheduled contact-challenge erasure |
| [Password recovery](password-recovery-policy.md) | Verified-phone recovery, capability limits and session invalidation |
| [Phone change](phone-change-policy.md) | Session-bound replacement, OTP and temporary challenge lifecycle |
| [Rate limiting](rate-limit-policy.md) | Shared atomic application limits and operational boundaries |
| [Real-provider drills](real-provider-drills.md) | Manual current-flow procedure, two-stage runner and historical evidence |

## Design decisions and delivery records

| Document | Status |
| --- | --- |
| [Unified implementation plan](unified-implementation-plan-2026-09-09.md) | W00–W08 implemented in the working tree; W09/W10 local delivery and verification recorded. Independent languages, translated review/results, receipt enforcement, extensible UI/CMS, one British English choice and educational demo. CMS publication, remaining browser/voice acceptance and external release gates stay open. |
| [Language implementation verification](verification-language-implementation-2026-09-09.md) | Tests, migrations 0063–0067, real text-provider fixtures, rollout/rollback and exact remaining checks. [UI evidence](verification-language-ui-2026-09-09.md); [rotation/recovery/deletion](verification-text-data-2026-09-09.md). |
| [Language workflow architecture](language-workflow-architecture-2026-09-09.md) | Design rationale for independent UI, input, task, call and result languages. Consolidated into the unified implementation plan; retained as background, not a second execution backlog. |
| [Promise/implementation gap plan](promise-implementation-gap-plan-2026-09-08.md) | Audit-to-scope mapping and feasibility background. Consolidated into the unified implementation plan, including the decision to use pre-call approval of shareable information and exclude additional live approvals. |
| [Small improvements — R21](small-improvements-implementation-plan-2026-09-08.md) | Implemented locally: brand favicon, editable profile name defaults, and playback-aware agent hangup. [Verification](r21-verification-2026-09-08.md): signed-in form and one Russian live drill passed; broader voice acceptance and rollout remain separate. |
| [Emerald Paper design](../Design/system-2026-09-07/GUIDELINES.md) / [implementation milestone R20](mvp-plan.md#current-product-milestone--r20-approved-design-implementation) | Implemented in the actual app, including admin and revision 02 corrections; [local QA and evidence](../design-qa.md). R13 accessibility and provider/deployment release gates remain separate. |
| [Admin architecture](admin-interface-architecture.md) | Implemented English-only admin separation |
| [Voice consent](outbound-voice-consent-implementation-plan.md) | Implemented recognition/playback boundary; live/privacy acceptance remains open |
| [Post-call transcription](post-call-transcription-plan.md) | Implemented channel-utterance default and full-file fallback |
| [Channel-aware transcription](channel-aware-final-transcription-plan.md) | Implemented decision; historical validation is not current release evidence |
| [Account improvements](account-profile-improvement-plan.md) | Implemented core; browser/device acceptance and lifecycle follow-ups remain |
| [UI stabilization](ui-ux-stabilization-plan.md) | Historical design checklist with current status; not the next milestone |

When changing behavior, update its architecture/policy and the corresponding roadmap
acceptance together. Keep verified implementation, proposed work and deployment
evidence separate. Do not edit applied migrations or immutable published revisions
to repair documentation. Public content corrections need the normal publication or
forward-migration workflow. Historical verification counts must remain explicitly dated.
