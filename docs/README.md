# Documentation index

Reviewed 2026-09-07 against the integration of `51a61da` and `14abd28`. Public brand: SHPROHLI; internal package
names, cookies, database names and legacy migration identifiers still use callassist.

## Current sources of truth

| Document | Purpose |
| --- | --- |
| [Merge verification](merge-verification-2026-09-07.md) | Current mainline integration, checks and schema |
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
| [Database recovery and secrets](database-recovery-and-secrets.md) | Restore/rotation procedure, thirteen-family verification and external evidence |
| [Data deletion](data-deletion-policy.md) | Provider-first deletion, anonymization, retained evidence and scheduled contact-challenge erasure |
| [Password recovery](password-recovery-policy.md) | Verified-phone recovery, capability limits and session invalidation |
| [Phone change](phone-change-policy.md) | Session-bound replacement, OTP and temporary challenge lifecycle |
| [Rate limiting](rate-limit-policy.md) | Shared atomic application limits and operational boundaries |
| [Real-provider drills](real-provider-drills.md) | Manual current-flow procedure, two-stage runner and historical evidence |

## Design decisions and delivery records

| Document | Status |
| --- | --- |
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
