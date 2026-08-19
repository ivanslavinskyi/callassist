# CallAssist Public Beta Roadmap

## Current state

CallAssist is a working supervised telephony/AI MVP. It already compiles a multilingual brief into a versioned plan, lets the operator review and approve it, places an outbound PSTN call through Twilio, discloses the AI identity, obtains DTMF consent, bridges the conversation to OpenAI Realtime, streams a live transcript, records both channels after consent, and produces a separate whole-recording final transcript. PostgreSQL persistence, encrypted private fields, audit events, recording retention (0/7/30 days), manual recording deletion, and the current EN/DE Dashboard, call-detail, registration, phone-verification, and login experience are also present.

The objective is **not to rebuild the call workflow**. It is to turn the supervised MVP into a safe, observable, supportable, and deliberately limited public beta. Until the **Public Beta Foundation** milestone is complete, do not actively expand the AI agent. The dominant risks are identity, authorization, abuse and cost control, operational visibility, public/legal content, privacy, and production operations.

## Status and priority legend

- **DONE** — verified in the current repository; maintain and regression-test it.
- **PARTIAL** — useful implementation exists, but beta acceptance criteria are not met.
- **P0** — mandatory for limited public beta.
- **P1** — required before broadening beta; waivable only for a controlled invite alpha with a named owner, compensating control, and expiry.
- **P2** — post-beta or future/monetization scope.

Unchecked items are work to do. Completed implementation is recorded once rather than duplicated in later phases.

## Product and release boundaries

1. CallAssist primarily serves people with speech impairments and people facing a local language barrier.
2. Website/UI locale, SEO locale, brief source language, call language, and permitted fallback call language are independent.
3. Free-form input is untrusted. Only an approved, versioned `CompiledCallBrief` may enter the runtime; deterministic policy, not a model, authorizes calls.
4. Preserve `AI disclosure -> DTMF consent -> recording/model processing`.
5. Beta allows Swiss destinations, low-risk tasks, one concurrent call per user, and three signup credits. There are no payments.
6. Expand access only after invite-alpha telemetry, failure, abuse, cost, privacy, and support reviews meet written thresholds.

## Verified implementation baseline — DONE

- [x] Create, compile, edit/recompile, review, approve-and-call, list, search, filter, paginate, start, stop, and monitor call briefs.
- [x] Versioned `RawCallBrief`, `CompiledCallBrief`, `PolicyDecision`, compiler snapshots, fixed clarification codes, moderation, and deterministic policy.
- [x] Supported low-risk task classification, controlled assistance reasons, six server-owned assistant profiles, represented-person disclosure, and approved-fact boundary.
- [x] Twilio outbound PSTN, signed HTTP/WebSocket callbacks, call-scoped stream token, provider status sync, and isolated Twilio ingress listener.
- [x] Same-voice disclosure, DTMF consent before recipient processing, dual-channel recording after consent, and consent/opening/readiness/objective sequencing.
- [x] OpenAI Realtime, SSE live events/transcript, operator stop, and sensitive disclosure approvals.
- [x] Whole-recording post-call transcription, conservative optional role/time alignment, playback proxy, export, and transcription retry.
- [x] PostgreSQL persistence for briefs, attempts, transcripts, approvals, recordings, final transcripts, compilations, and immutable audit events.
- [x] AES-256-GCM protection for private context/facts and encrypted compilation/final transcript data.
- [x] Audio retention choices of 0, 7, or 30 days and manual provider recording deletion.
- [x] Current responsive Dashboard and LiveCall/call-detail, history search/filter/pagination, confirmations, loading/error states, and EN/DE typed UI catalogues.
- [x] Locale negotiation/cookie, localized roots and call details, and routing/i18n tests.
- [x] Represented-person input uses explicit first/last name fields; the personal default has been removed from contracts and the call form.
- [x] Local lint, typecheck, unit/integration tests, builds, and migration commands.

## Known partial implementation and beta gaps

- **PARTIAL — product UI:** Dashboard and call detail are the application foundation, but occupy localized roots rather than an authenticated `/app` area.
- **PARTIAL — localization:** operational UI is EN/DE; localized public content, publishing, metadata, and translation freshness are absent.
- **PARTIAL — observability:** audit/provider/SSE/health data exists, but no durable technical event stream, admin inspector, cost view, or production monitoring.
- **PARTIAL — async work:** transcription recovery and retention work remain substantially coupled to API process lifecycle.
- **PARTIAL — data lifecycle:** recording deletion and transcript export exist; account/session/full-data lifecycle does not.
- **PARTIAL — identity foundation:** user/session tables, repositories, shared contracts, scrypt password handling, register/verify/resend/login/logout/me endpoints, localized register/verify/login screens, Twilio Verify integration, opaque server-side session cookies, credentialed web API requests, and process-local application rate limits exist. Password recovery, distributed rate limits, and authenticated page routing remain.
- **PARTIAL — tenancy rollout:** new call briefs are owned by the authenticated user; all browser list/read/write/action/SSE/media endpoints authenticate, scope by owner, and return the same not-found response for another user's ID. Legacy pre-authentication rows remain nullable and intentionally invisible until an explicit migration/archive policy is chosen; PostgreSQL integration execution still requires the local database container.
- **PARTIAL — destination rollout:** shared `libphonenumber-js/max` metadata parses and canonicalizes Swiss national/international input; contracts, call-start policy, and the Twilio adapter reject invalid or non-CH destinations. Production Twilio Voice Geographic Permissions still need to be restricted and captured as deployment evidence.

# Public Beta Foundation

## 1. Identity & Tenancy

### P0 — users, authentication, and sessions

- [x] Add `users`: `id`, unique normalized `email`, password credential, unique normalized `phone_e164`, `phone_verified_at`, required `first_name` and `last_name`, `role`, `status`, `ui_locale`, `created_at`, `last_login_at`. Build any display label from the two name fields; do not use a single ambiguous `display_name` as the source of identity.
- [x] Support `active`, `suspended`, `deleted` in storage and session authentication; define role values `user`, `admin`, `superadmin`, `content_editor`, `support`. Narrow account-status/session-revocation routes enforce server-side admin/superadmin RBAC; the complete admin permission matrix remains in the admin phase.
- [x] Add revocable server-side `sessions` with hashed opaque token, user, expiry, revocation, creation and last-use data. Issue HttpOnly, SameSite=Lax cookies and add Secure in production.
- [x] Implement backend registration, phone verification/resend, login, logout, and current-user endpoints with email, scrypt password, phone, and Twilio Verify SMS **phone verification/OTP**. Registration OTP is not 2FA.
- [ ] Add password/account recovery after defining its anti-enumeration and step-up verification policy.
- [x] Rate-limit verification sends/attempts, login, and account creation in the application process by IP plus phone/email. Twilio limits are defense-in-depth, not the sole control.
- [ ] Move rate-limit state to a shared durable store before running multiple API instances.
- [ ] Define re-verification for number changes and step-up verification for recovery, suspicious activity, and sensitive operations.

Acceptance: unverified, suspended, deleted, expired-session, and revoked-session users cannot create/start calls; auth, session, OTP, status, and abuse paths have automated tests.

### P0 — ownership and tenant isolation

- [x] Add indexed `user_id` ownership to call briefs; derive attempts, transcripts, recordings, approvals, final transcripts, compilations, and events through their existing call-brief relationships.
- [x] Scope every browser operation by the authenticated owner: list/get/update, compile, approve/start/stop, SSE, playback/delete, client-side export source data, and transcription retry. Mutations also enforce the configured browser origin.
- [x] Keep provider webhooks authorized by signature and provider IDs; never trust a browser-supplied user ID.
- [x] Add an automated cross-user API matrix for every read/write/action/SSE/media endpoint and return indistinguishable `CALL_NOT_FOUND` responses for foreign IDs.
- [ ] Execute the PostgreSQL ownership integration suite in the database-enabled environment, then define the archive/backfill policy for nullable pre-authentication records before validating a final `NOT NULL` constraint.

Acceptance: user A cannot infer, read, stream, mutate, start, stop, export, play, delete, or retry user B's resource.

### P0 — represented identity defect

- [x] Remove `DEFAULT_REPRESENTED_PERSON = "Ivan Slavinskyi"` and all implicit personal defaults. Require separate represented-person first and last names; store their combined value only as a compatible call snapshot.
- [x] Test that call brief validation rejects a missing first or last name and never supplies another person's name.
- [ ] Copy the authenticated user's `first_name` and `last_name` only as visible/editable suggestions; both represented-person fields remain an explicit choice.

### P1 — acceptance and lifecycle

- [ ] Record accepted Terms/AUP revision IDs and timestamps; support required re-acceptance.
- [ ] Provide session listing/revocation, user data export, transcript/data deletion, and account deletion/anonymization with documented audit, suppression, backup, provider, and retention behavior.

## 2. Usage & Abuse Prevention

### P0 — Switzerland-only destinations

- [x] Parse, canonicalize, and validate server-side with `libphonenumber-js/max` metadata and require a valid Swiss destination; do not rely on `startsWith("+41")` or frontend checks.
- [x] Enforce the same CH-only rule in the shared contract, again in deterministic call-start policy before future credit reservation/provider creation, and defensively in the Twilio adapter. Explain: “During the public beta CallAssist can only call Swiss phone numbers.”
- [ ] Restrict production Twilio Voice Geographic Permissions to Switzerland and preferably initial low-risk ranges; record this reviewed console setting in deployment evidence.
- [x] Test Swiss national, `00` and E.164 formatting; invalid, short-service and foreign country-code edges; direct API bypass; legacy stored foreign briefs; and direct provider bypass.

### P0 — append-only credits and concurrency

- [x] Add `credit_transactions`: `id`, `user_id`, signed `amount`, `type`, optional `call_attempt_id`, `promo_redemption_id`, `admin_id`, `reason`, unique `idempotency_key`, `created_at`.
- [x] Support `signup_grant`, `promo_grant`, `admin_grant`, `call_reservation`, `call_charge`, `call_refund`, `adjustment`.
- [x] Grant exactly `+3 signup_grant` once after verification.
- [x] Atomically reserve one credit before dialing with transaction/locking or equivalent serializable invariant and idempotency. Enforce one active outbound call per user.
- [x] Define tested reservation-to-charge/refund transitions. Charge only after a provider-confirmed successful connection; refund busy, no-answer, cancellation, and technical failure before connection. Control repeated free retries through separate abuse quotas.
- [x] Derive balance from the ledger (a cache must be rebuildable); never silently edit `calls_remaining`.

Acceptance: concurrent starts cannot overspend, duplicate callbacks are idempotent, and every balance reconciles to entries.

### P0 — quotas, suppression, and emergency controls

- [ ] Enforce hourly/daily call and duration limits, concurrency, repeat-recipient limits, and thresholds for decline/no-consent/failure/policy blocks. **Partial:** hourly/daily, concurrency, repeat-recipient, and maximum-duration controls are implemented and tested; outcome-specific thresholds remain.
- [x] Add global `recipient_suppressions` with normalized phone, time, source, reason, actor/audit data; check immediately before provider call creation.
- [ ] Add public opt-out and staff suppression workflow. Spoken in-call opt-out is P2.
- [x] Implement audited account suspension and session blocking/revocation policy. Suspension atomically revokes all sessions; unsuspension never restores them; concurrent session creation and PostgreSQL call creation/reservation are blocked; force logout is a separate audited action.
- [x] Add a global kill switch that blocks new calls/reservations without ending active calls unless separately commanded. Changes require a reason and append immutable safety events; an operator CLI is available for PostgreSQL deployments.
- [ ] Rate-limit registration, auth/recovery, compilation, call create/start, exports, playback, and costly endpoints; detect mass accounts without logging unnecessary PII.

### P1 — promo and complaints

- [ ] Add `promo_codes` with hashed code, credits, global/per-user limits, start/expiry, active flag, campaign; add transactional unique `promo_redemptions`.
- [ ] Issue promo/manual grants only through the ledger with actor, reason, time, idempotency.
- [ ] Add complaint/abuse intake, repeat-call/opt-out/policy review, escalation, and response ownership.

## 3. Public Product & User Experience

### P0 — routing and authenticated shell

- [ ] Make `/en` and `/de` public landing pages and redirect `/` through current locale negotiation.
- [ ] Move—not rewrite—the Dashboard to `/en/app` and `/de/app`; move call detail to `/en/app/calls/[id]` and `/de/app/calls/[id]`, preserving current review, LiveCall, transcript, recording, history, search/filter/pagination, and accessibility behavior.
- [x] Add localized EN/DE login, registration, and phone-verification screens with separate required first and last names.
- [ ] Add `/app/account` and optionally separate `/app/usage`; protect all app routes server-side.
- [ ] Add localized How it works, Privacy, Terms, Acceptable Use, Support, and Opt-out. App/admin/auth routes are `noindex` (not a security control).
- [ ] Show credits, New call, History, and account/session actions in the app header.

### P0 — landing and onboarding

- [ ] Publish EN/DE Hero: AI phone assistant acting for the user, focused on speech accessibility/language barriers; CTA “Try the beta”; “Free public beta”, “3 calls included”, “Switzerland only”.
- [ ] Explain: describe -> compile -> review/approve -> call -> result.
- [ ] Explain disclosure, consent-gated processing/recording, retention/deletion control, and beta fallibility.
- [ ] List supported information/appointment/document/status/neutral-message cases and prohibit emergencies, harassment, deception, spam/bulk marketing, political persuasion, and high-stakes legal/medical/financial negotiation.
- [ ] Separate website languages from call languages; FAQ covers disclosure, consent, recording, transcripts, retention/deletion, Swiss numbers, and credits.
- [ ] Add accessible onboarding with current Terms/AUP acceptance and explicit consent/retention/use/credit explanations.

### P1 — outcomes and feedback

- [ ] Persist versioned/provenanced outcomes: `resolved`, `partially_resolved`, `unresolved`, `wrong_recipient`, `voicemail`, `declined`, `technical_failure`.
- [ ] Ask goal result (Yes/Partly/No), final transcript quality (Good/Some errors/Poor), and optional bounded comment.
- [ ] Ownership-scope feedback and make it available as privacy-safe beta metrics.

## 4. Content / CMS / SEO

Keep buttons, forms, validation/errors, call/admin UI, and accessibility labels in typed code catalogues. CMS manages public editorial content only.

### P0 — localized CMS and publishing

- [ ] Add `/admin/content` for Landing, Pages, FAQ, Navigation, Media, and separate `/admin/seo`.
- [ ] Model logical `content_pages` (`key`, `page_type`, status/timestamps) separately from `content_page_localizations` (locale, slug, title/content, SEO/OG, canonical override, robots, timestamps), allowing `/en/privacy` and `/de/datenschutz`.
- [ ] Support `page`, `landing`, future `article`; no blog or universal builder for beta.
- [ ] Store revision snapshots with editor/revision/times; support draft, authenticated or signed short-lived noindex preview, publish, history, rollback. Publish via DB update and cache revalidation, without deployment.
- [ ] Model Landing as ordered/enabled localized Hero, How it works, Use cases, Safety & Privacy, Languages, FAQ, CTA blocks; model reusable localized FAQ items.
- [ ] Prefer navigation references to known internal entities and validate broken links.
- [ ] Add media metadata: file/MIME/dimensions/size, EN/DE alt, uploader/time, usage references.

### P0 — legal/localization/SEO correctness

- [ ] Let Terms/AUP revisions require account re-acceptance.
- [ ] Track source revision and translation-source revision; flag stale legal, FAQ, and claims.
- [ ] Never silently serve English at a German public URL. Unpublished locale means no route, sitemap entry, or hreflang.
- [ ] Generate localized title, description, slug, OG, robots, canonical; validate advanced canonical override.
- [ ] Generate hreflang automatically from published localizations of one logical page.
- [ ] Sitemap only published/public/indexable pages; exclude app/admin/auth/preview. Add matching robots behavior.
- [ ] Add global site/canonical/title/description/OG/verification and structured organization/product settings. Generate JSON-LD from structured fields, not arbitrary JSON.

### P1 — SEO audit

- [ ] Report each public URL's locale, publication/index state, title/description, canonical, hreflang, and OG image with a compact error overview.

## 5. Admin & Observability

### P0 — minimum safe operations

- [ ] Protect `/admin` with server-side RBAC. `content_editor`: CMS/SEO, no calls/recordings. `support`: appropriate support/call metadata, no CMS or recordings by default. Admin/superadmin permissions remain explicit. **Partial:** backend account-status and force-logout routes already enforce admin/superadmin RBAC, privileged-target rules, self-action denial, and origin checks.
- [ ] Audit staff login; user/session/status, credit, suppression, content/legal, kill-switch, export/deletion actions; and every sensitive call-content access. **Partial:** suspend/unsuspend/force-logout events are immutable and include actor, target, transition, reason, and time.
- [ ] Provide user lookup, suspend/unsuspend, revoke sessions, ledger credit grant, suppression, and kill-switch controls before beta. **Partial:** suspend/unsuspend, force logout, suppression storage, and the kill-switch operator command exist; lookup, credit grants, and consolidated admin UI remain.

### P1 — admin areas

- [ ] `/admin`: user, call, outcome/consent/failure, cost, and system-health metrics.
- [ ] `/admin/users` and detail: identity/verification, activity/status, ledger/promos, calls/feedback/safety/complaints, and audited grant/suspend/session/delete actions.
- [ ] `/admin/calls` and detail: user/recipient (controlled), locale, status/outcome, duration, consent, recording/transcription, failure stage, and useful failure/policy/model/language/date filters.
- [ ] `/admin/safety`: blocks, repeat recipients, no-consent/declines, opt-outs, complaints, suspicious registration/credits, anomaly review and actions.
- [ ] `/admin/credits`: ledger, grants/adjustments, promo/redemption/expiry/campaign; no silent balance edits.
- [ ] `/admin/audit`: actor/action/target/time/result filters and immutable evidence.

### P1 — Call Inspector and telemetry

- [ ] Keep human/action `audit_events` separate. Add append-only `call_events`: call/attempt/user, time, source/name/stage/severity, trace/correlation, duration, provider status/error, model/version, bounded metadata, schema version. Add rebuildable `call_metrics` only if needed.
- [ ] Instrument brief/compiler/policy/approval/credit/Twilio/ringing/answer/disclosure/consent/recording/Realtime/first-audio/conversation/completion/transcription/outcome, including latency, retries, reconnects, provider IDs/status, model/version, channels/duration, feedback.
- [ ] Build `/admin/calls/[id]`: summary, timeline, technical metadata, separately permissioned sensitive content. Never show secrets; audit sensitive views.
- [ ] Define metadata allow-lists excluding phone/name/brief/transcript text, credentials, cookies, OTPs, and raw provider payloads from generic logs/events.
- [ ] `/admin/system`: API/DB/Twilio/OpenAI health, active calls, jobs/failures, webhooks, retention, transcription, costs, alerts, and kill switch.

## 6. Production & Compliance

### P0 — deployment and recovery

- [ ] Deploy stable web/API/Twilio ingress on production domain/TLS; Quick Tunnel is development-only. Preserve isolation of main authenticated API/SSE from Twilio ingress.
- [ ] Provision production Postgres, managed secrets, least privilege, repeatable migrations, encrypted backups/retention, and documented successful restore test/recovery targets.
- [ ] Add PII-safe structured logs, error and uptime/health monitoring, provider/cost dashboards and alerts.
- [ ] Enforce request limits, endpoint rate limits, secure headers, session security, CSRF where applicable, dependency scanning, configuration validation, and a focused security review.
- [ ] Document rollback, incident, provider outage, abuse, complaint, kill-switch, and support procedures with owners.

### P0 — privacy and Swiss launch review

- [ ] Publish reviewed EN/DE Privacy, Terms, AUP, Support/contact, Opt-out, retention/deletion, and subprocessors information.
- [ ] Perform formal privacy/security risk assessment for phone numbers, names, recordings, transcripts, possible health/speech-disability data, and provider/AI processing. Obtain Swiss legal/privacy review and separately assess DPIA necessity without predetermining the conclusion.
- [ ] Verify consent evidence, retention/deletion, data requests, provider deletion, backup expiry, sensitive staff access audit, encryption, and key management end to end.
- [ ] Preserve the conservative consent boundary in production.

### P1 — durable jobs and CI

- [ ] Use durable idempotent jobs for final transcription, retries, recording processing, retention deletion, provider reconciliation/status sync, and cleanup. Redis/BullMQ or an equivalent proven approach is acceptable.
- [ ] Test restart, duplicate webhook, concurrent worker, and partial provider failure; expose stuck/dead-letter work.
- [ ] Add CI for clean install, lint, typecheck, tests, build, and safe migration validation; protect `main` with required checks/review.

## Validation retained from the supervised MVP roadmap — P1

- [ ] Define thresholds for semantic preservation, task success, hallucinated facts, correct refusal, false-positive blocking, consent, latency, Realtime understanding, live/final ASR, and unresolved answers.
- [ ] Maintain a versioned corpus across call/source languages, Swiss German, accents, code-switching, noise, interruptions, voicemail/wrong recipient, unclear answers, failures, and adversarial prompts.
- [ ] Validate callback reordering, reconnect/recovery, repeated real calls, recording/transcript failure and uncertainty, and audio verification of critical details.
- [ ] Add overlapping-window transcription only if recordings exceed upload limits; retain one whole-recording request normally.

# Recommended delivery sequence

1. **Identity & isolation:** users, auth, Verify, sessions, RBAC/status, ownership/tests, personal-default removal.
2. **Beta safety & usage:** CH controls, ledger/reservations, quotas/concurrency, promo foundation, suppression, suspension, rate limits, kill switch.
3. **Public shell:** move existing screens under `/app`; add landing, auth, onboarding, account/usage, legal/support/opt-out.
4. **CMS & SEO:** localized content/blocks, revisions/acceptance, FAQ/navigation/media, freshness, metadata/hreflang/sitemap, preview/publish/audit.
5. **Observability:** outcomes/feedback, `call_events`, admin overview/users/calls/Inspector/safety/credits/system, cost and access audit.
6. **Production hardening:** durable jobs, CI, deployment, monitoring, backup/restore, security/privacy/legal/operations reviews.
7. **Invite alpha -> limited beta:** small tester cap; review telemetry, failures, abuse, costs, transcript quality, complaints, privacy operations, and support load before expanding.

# P2 / Future / Monetization

- Payments, subscriptions, Stripe, billing plans, paid credits.
- Organisations/teams, enterprise tenancy, native apps.
- Sophisticated ML fraud, large analytics warehouse, advanced marketing automation.
- Complex blog/editorial platform or universal builder (`article` may exist in the model).
- Broad international/bulk/marketing/high-risk calls, unrestricted identities, automatic language switching.
- Spoken in-call opt-out, external side-effect integrations, and FR/IT website locales after EN/DE stabilizes.

# Public Beta GO / NO-GO Checklist

Every P0 item is mandatory. A P1 waiver is allowed only for tightly controlled invite alpha and must name an owner, compensating control, and expiry.

## P0 — mandatory

- [x] Users/auth/secure server-side sessions/roles/status implemented.
- [x] Phone verified through Twilio Verify with application-level limits.
- [x] Cross-user isolation enforced for all browser APIs/SSE/media/actions and tested; database-backed execution remains an environment verification item above.
- [x] Personal `"Ivan Slavinskyi"` default removed; registration and represented identity use explicit first/last name fields.
- [x] Swiss-only restriction enforced server-side and in policy.
- [ ] Twilio Voice Geographic Permissions restricted to approved CH destinations.
- [x] Exactly three signup credits granted once through ledger.
- [x] Atomic/idempotent/concurrent-safe/reconciliable credit reserve/charge/refund.
- [x] Per-user hourly/daily quotas and one-call concurrency.
- [x] Recipient suppression/opt-out checked before provider call.
- [x] Audited admin suspension and session revocation/blocking.
- [x] Global kill switch blocks new calls without implicitly ending active calls.
- [ ] Localized landing, auth/onboarding, support, opt-out live.
- [ ] Reviewed Privacy, Terms, AUP, retention/deletion, subprocessors live.
- [ ] CMS supports EN/DE revisions, preview, rollback, legal acceptance.
- [ ] Localized metadata, canonical, hreflang, robots, sitemap verified.
- [ ] Production domain/TLS, stable hosting, isolated Twilio ingress, production DB.
- [ ] Secrets/keys managed with least privilege and rotation procedure.
- [ ] Backups configured and restore-tested.
- [ ] PII-safe logs, error/health/uptime monitoring, provider/cost alerts.
- [ ] Sensitive text, credentials, sessions, OTPs, raw provider payloads excluded from generic logs/telemetry.
- [ ] Security/privacy risk and Swiss legal/privacy launch reviews complete.
- [ ] Disclosure and consent precede recording/model processing in production tests.
- [ ] Incident/abuse/complaint/outage/rollback/support procedures and owners ready.

## P1 — broad-beta requirement; invite-alpha waiver only

- [ ] Durable jobs and recovery/dead-letter visibility.
- [ ] Admin Calls and failure-stage filters.
- [ ] Call Inspector timeline and sensitive-access audit.
- [ ] Separate technical telemetry; `audit_events` remains action audit.
- [ ] Structured outcomes and user feedback measurable.
- [ ] Admin Users workflows.
- [ ] Transactional promo codes and ledger grants.
- [ ] Account/data export/delete and session revocation tested.
- [ ] Support/complaint/suppression workflow with owners and targets.
- [ ] CI and `main` branch protection.
- [ ] SEO audit.
- [ ] Quality/safety evaluation meets thresholds.

## Release decision record

- Decision: **GO / NO-GO**
- Release scope and tester cap:
- Date and approvers:
- Metrics observation window:
- P1 waivers, owners, controls, expiry:
- Open incident/legal/security/privacy findings:
- Rollback/kill-switch owner:
