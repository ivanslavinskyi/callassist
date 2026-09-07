# SHPROHLI release roadmap

Updated 2026-09-07 for the remediation working tree based on `96229ea`.
See the original [audit](project-audit-2026-09-07.md) and current [fix evidence](remediation-2026-09-07.md).
This is the single current backlog and release checklist. Earlier checkpoint numbers
(5A–5D, 6A–6F6) in policy documents identify delivery history, not pending milestones.
Git history retains the previous chronological roadmap and its historical test counts.

## Current state

The supervised MVP and much of the beta foundation are implemented. The repository
does not establish an approved public deployment. **Current recommendation: NO-GO
for unrestricted public beta** until the P0 release gates below are closed.

R01-R05 and R18/R19 are implemented and verified locally. R06 tooling is repaired
and covered by a non-billable harness; a recipient-authorized live drill remains.
The next work is R07 disclosure/copy approval and R08 enforceable voice safety,
followed by deployment and provider evidence. Former 6F7 step-up remains R15.
Existing identity, CMS, durable workers and account features should not be rebuilt.

## Status and priority

- **Implemented:** source and automated coverage exist; this does not mean deployed.
- **Partial:** the implemented boundary is stated separately from unfinished work.
- **Open:** acceptance has not been met or evidence is absent.
- **P0:** must close before public beta; no implicit waiver.
- **P1:** required for broad beta; a controlled invite-alpha waiver must name a human
  owner, compensating control and expiry.
- **P2:** deferred product/engineering work, outside the initial release gate.

Owners below are accountable roles, not assigned people. Name a primary and backup
before scheduling each release gate. Dates are set after ownership and dependencies
are agreed; no delivery date is implied by this backlog.

## Implemented baseline

| Area | Delivered behavior | Evidence/source |
| --- | --- | --- |
| Identity | Register/Verify/login/logout, active/suspended/deleted roles, hashed opaque sessions, tenant isolation, three signup credits | [auth](../apps/api/src/auth), [contracts](../packages/contracts/src/account.ts) |
| Account | Name editing, password recovery, verified phone and email replacement, bounded session inventory/revocation | [profile checkpoint](account-profile-improvement-plan.md), [account UI](../apps/web/components/account-console.tsx) |
| Data access/lifecycle | Versioned owner export, provider-first terminal-call redaction, durable account deletion with audited retry | [lifecycle policy](data-deletion-policy.md); R05 challenge cleanup implemented |
| Preparation | Async `202` enqueue/status polling, owner idempotency, durable compilation, fenced publication and source-input erasure | [preparation schema](../packages/contracts/src/call-preparation.ts), migration 0046 |
| Compiler | Structured multilingual plans, raw/output moderation, deterministic policy, fixed clarification codes, edit/recompile/review/approval | [compiler](../apps/api/src/brief-compiler/brief-compiler.ts) |
| Identity in calls | Six profiles, explicit represented first/last name, neutral `none` assistance default, two optional disclosures | [brief contract](../packages/contracts/src/call-brief.ts) |
| Telephony | CH-only Twilio, signatures, scoped stream tokens, isolated listener, provider status callbacks, maximum duration | [telephony](../apps/api/src/telephony), [bridge](../apps/api/src/realtime/openai-realtime-bridge.ts) |
| Consent | Isolated recognition of pre-consent speech, one clarification, DTMF fallback, negative precedence, recording and opening playback gates | [consent decision](outbound-voice-consent-implementation-plan.md); disclosure review is R07 |
| Transcripts | SSE draft; channel-derived utterance ASR; whole-file plain-text fallback; playback, clipboard/PDF, retry, 0/7/30-day retention | [transcription decision](post-call-transcription-plan.md) |
| Credits/safety | Atomic reserve/connection-charge/pre-connection-refund, quotas, one active call, promos/grants, suppression/opt-out, suspension and kill switch | [storage tests](../apps/api/src/storage), [rate limits](rate-limit-policy.md) |
| Public app | EN/DE Landing/auth/onboarding/account/history/detail, recipient suggestions from own history, responsive forms | [web components](../apps/web/components) |
| Onboarding | One required legal checkbox, exact Terms/AUP revision acceptance, re-acceptance; four legacy booleans sent for compatibility | [onboarding form](../apps/web/components/onboarding-form.tsx) |
| CMS/SEO | Pages including Impressum, Landing/FAQ/Navigation, bilingual content, private drafts, immutable publication/history, preview/rollback, metadata/sitemap/robots | [content](../apps/api/src/content), [SEO](../apps/web/lib/seo-audit.ts) |
| Admin | English-only shell/RBAC, call list/Inspector, separately audited superadmin text access, users/status/sessions/grants, content/SEO, safety/credits forms | [admin architecture](admin-interface-architecture.md) |
| Operations | Durable events distinct from action audit, outcomes/feedback, cohorts/cost estimates, jobs/leases/retries/fencing, reconciliation, invalidation/SSE, heartbeats, local alerts | [operations](operations-readiness.md) |
| Storage/tooling | 49 checksummed migrations/51 tables, memory/PostgreSQL repositories, versioned encryption, nine-family rotation verifier, backup/restore tool, CI source and Dependabot | [architecture](architecture.md), [audit](project-audit-2026-09-07.md) |

## Milestone 1 — repository release blockers

Complete R18/R19 and R01–R08 before using test results as a public-beta release decision. Work
can be split by subsystem, but R02 must precede the final verification of every fix.

| ID / priority | State / owner | Required work | Acceptance |
| --- | --- | --- | --- |
| R18 / P0 | Implemented — voice/safety | Make consent recognition reject conditional/qualified affirmations instead of accepting any allowed affirmative prefix | The reproduced EN/DE/RU refusal phrases cannot grant consent or start recording; multilingual negation/conditions/quoted speech route to refusal or clarification; bridge-level recording assertions pass |
| R19 / P0 | Implemented — backend/security | Revoke authorization of already-open SSE streams after session revocation/expiry or account suspension | Existing HTTP streams stop sending private deltas within a defined bounded interval; logout/revoke-all/reset/suspension and cross-instance revocation tests pass; fresh unauthorized connections remain rejected |
| R01 / P0 | Implemented — backend/security | Update vulnerable production dependency chains and lockfile; triage qs as well as fast-uri | Fresh frozen install; high/critical audit clear; remaining findings have recorded disposition; full regression/build gate passes |
| R02 / P0 | Implemented — platform/backend | Declare Turbo runtime/test/build env and cache inputs; prevent silent DB-suite skipping in CI | On a clean checkout without `.env`, injected DB URL reaches tests; all eight PostgreSQL suites execute; unavailable DB fails the gate; API/worker/web receive intended env; changes to build origins invalidate cache |
| R03 / P0 | Implemented — backend/data | Include preparation ciphertext in rotation and recovery verification; remove “all clear” false assurance | Seed a queued preparation with an old key, rotate, remove old runtime key, successfully decrypt/complete it; full-family restore and second-run no-op verified |
| R04 / P0 | Implemented — backend | Require OpenAI compiler in production worker validation | Production worker rejects explicit `mock`; missing/default behavior documented; API and worker compiler/model parity covered |
| R05 / P0 | Implemented — backend/privacy | Erase temporary email/phone challenge PII during account deletion; schedule bounded cleanup without relying on new traffic | Pending/completed/expired challenges seeded before deletion lose contact data; user/session references cannot bypass cleanup; immutable minimal security events remain; idle retention test passes |
| R06 / P0 | Partial — backend/QA | Repair the real-call drill for async preparation and split worker ordering; use existing verified accounts only | Runner uses UUID enqueue/poll/read rather than removed POST; prepares with worker running, permits controlled stop before dialling, never registers an account or sends Verify SMS; non-billable harness passes before a recipient-authorized drill |
| R07 / P0 | Open — product/privacy/backend | Align live notice, UI and versioned public copy with isolated pre-consent recognition, actual spoken retention information and Resend email processing | Approved EN/DE copy and all call-language scripts describe actual processing; new immutable revisions/migration where needed; acceptance booleans are not presented as four independent choices; evidence captured on the released commit |
| R08 / P0 | Partial — backend/safety | Complete deterministic sensitive-disclosure/action controls for Realtime or formally restrict release scope to an enforceable boundary | Model tool/action path cannot disclose protected facts without an authorized, unexpired decision; reject/expiry/stop and adversarial recipient cases proven with bridge tests and approved live drills |

R01-R05/R18/R19 are closed at the repository implementation boundary; their
acceptance evidence is in the [remediation record](remediation-2026-09-07.md).
R06 has a tested prepare/poll/read stage and a separate authorized start stage.
R06 live-provider acceptance, R07 and R08 remain mandatory before release.

## Milestone 2 — deployable, observable invite alpha

Depends on milestone 1. Repository configuration is not proof of external setup.

| ID / priority | State / owner | Acceptance required |
| --- | --- | --- |
| R09 / P0 | Open — platform | Stable domain/TLS and reproducible web/API/worker deployment; web and browser API share the cookie hostname; private SSR origin works; reverse proxy reaches loopback Twilio listener; public Twilio surface excludes application routes; reviewed proxy IP/WAF policy; local public-copy/build-origin values do not leak into production |
| R10 / P0 | Partial — platform/security | Managed PostgreSQL, least-privilege credentials, secret store, encryption keys, accepted RPO/RTO, encrypted PITR/backups, isolated production restore, independent deletion/suppression journal and replay, backup expiry and exercised key rotation after R03 |
| R11 / P0 | Partial — operations | Named primary/backup responders; protected logs and tested PII canary; routed/deduplicated alerts; liveness/readiness/worker/queue/retention monitoring; upstream probes and provider budgets; rollback/provider-outage/abuse/complaint/support drills; monitored contact channels and response targets |
| R12 / P0 | Open — release/security/privacy | Hosted CI evidence and protected main branch; Twilio CH geographic/range restrictions; focused security assessment; independent Swiss privacy/legal review including pre-consent recognition and provider arrangements; current policy publication approval; exercised data requests/deletion; signed release decision |

Before inviting users, set a tester cap, observation window, call/cost limits and
clear rollback thresholds. Provisional recovery targets in the
[recovery runbook](database-recovery-and-secrets.md) require owner acceptance.

## Milestone 3 — broad-beta quality and support

These remain P1 unless a release owner escalates a specific acceptance item to P0.

| ID | State / owner | Remaining delivery and acceptance |
| --- | --- | --- |
| R13 | Partial — frontend/QA | Browser E2E for register/Verify/onboarding/preparation/review/live/reconnect/account/admin RBAC; verify EN/DE, keyboard, screen reader, 200% zoom/reflow, reduced motion and light/dark; complete 320/390/768/1280 account matrix plus broader UI matrix; real password-manager checks in Chrome/Edge/Firefox/Safari. Existing static/SSR unit tests do not prove autofill or full accessibility |
| R14 | Open — product/voice/QA | Versioned multilingual safety/quality corpus and thresholds for semantic preservation, hallucinations, false blocks/refusals, task success, consent false positives/negatives, latency, live/final ASR and unresolved answers; accents/Swiss German/code-switching/noise/short answers/wrong recipient/voicemail/adversarial cases; repeated approved calls and audio-grounded names/numbers validation |
| R15 | Partial — backend/security | Former 6F7: assurance matrix for sensitive owner/admin operations, bounded recent-auth/OTP grants, invalidation/replay/session tests, suspicious-session signals, durable security-change notification and provider outage/retry behavior. Email-change start sends an old-address notice and invalidates the challenge on delivery failure; there is no durable outbox or completion notice. Support-assisted identity recovery requires a separate reviewed policy |
| R16 | Partial — admin/support | Users: calls/feedback/promos/safety context. Safety: list/search, complaint intake/ownership/escalation, anomaly review. Credits: redemption/ledger browsing, campaign deactivation/management and audited adjustments. Add `/admin/audit` search. Preserve current role/owner isolation and minimized default DTOs |
| R17 | Partial — backend/operations | Outcome-specific no-consent/decline/failure/policy thresholds; privacy-reviewed mass-account correlation; cleanup schedule for recovery/session/operational retention; archive/backfill legacy nullable owners before NOT NULL; prove no revival of removed content after restore |

Do not fold provider/model reconnect into “already done” recovery: durable job recovery
and SSE resubscription exist; a broken Realtime model session currently ends the call.
Separate call-duration cost estimates from ASR utterance, compilation, consent-recognition,
SMS/email usage and provider invoices when extending cost monitoring.

## P2 — explicitly deferred

- Transcript click-to-seek, immutable operator corrections, evaluated new diarization,
  and bounded overlapping chunks for recordings above the input size limit. Keep the
  current channel-utterance path; a single full-file request is only the fallback.
- Media CMS, articles/blog and richer editorial roles only when a real workflow needs
  them. Existing structured page and Landing publication is complete.
- Visible editable suggestions of the account name for represented-person fields,
  a persisted account-language settings UI, and an optional manual theme toggle.
- Realtime reconnect design with proven conversation/consent/credit continuity.
- Spoken in-call opt-out and external side-effect integrations with server-owned controls.
- Teams/organizations, paid credits/subscriptions/payments, native apps/softphone,
  CRM/calendar/RAG, FR/IT website locales and larger analytics infrastructure.

Unrestricted identity, automatic language switching, international expansion and
bulk/high-risk calling are not implicit next releases. Emergencies, deception,
harassment, political persuasion and high-stakes medical/legal/financial negotiation
remain outside the current permitted product boundary.

## Public Beta GO / NO-GO checklist

- [x] Core implementation inventory and source-aligned documentation recorded.
- [x] Fresh local unit/integration suite, lint/typecheck/build and disposable recovery
  evidence recorded on 2026-09-07; this result expires after relevant code changes.
- [x] R01-R05/R18/R19 implementation and local regression evidence; dependency gate passes.
- [ ] R06 authorized live drill, R07 notice/copy approval and R08 voice safety acceptance.
- [ ] R02 verified on hosted CI without local `.env` and with no skipped DB suites.
- [ ] R09 topology exercised in the target deployment, including session SSR and SSE.
- [ ] R10 production backup/restore/rotation/deletion replay evidence accepted.
- [ ] R11 monitored operations and named support/incident ownership active.
- [ ] R12 security/privacy/provider/geographic/release approvals recorded.
- [ ] R13–R17 complete for broad beta; invite-alpha exceptions individually documented.
- [ ] Tester cap, observation window, metric thresholds and rollback conditions agreed.
- [ ] Current-commit supervised voice/consent/transcription/outage drill approved.

Release decision record:

| Field | Required value |
| --- | --- |
| Decision / date / approvers | GO or NO-GO, timestamp, named people |
| Application, worker, schema | Commit/artifact IDs and migration head |
| Scope | Invite cap, destinations, duration/quota/cost limits |
| Verification | Hosted CI, dependency report, live drill, security/privacy and restore evidence |
| P1 exceptions | Each ID, owner, compensating control and expiry |
| Operations | Primary/backup, monitored contact, kill-switch/rollback owner |
| Expansion | Observation window and success/failure thresholds |
