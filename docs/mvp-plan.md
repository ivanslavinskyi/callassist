# CallAssist Public Beta Roadmap

## Current state

CallAssist is a working supervised telephony/AI MVP. It already compiles a multilingual brief into a versioned plan, lets the operator review and approve it, places an outbound PSTN call through Twilio, discloses the AI identity, obtains DTMF consent, bridges the conversation to OpenAI Realtime, streams a live transcript, records both channels after consent, and produces a separate whole-recording final transcript. PostgreSQL persistence, encrypted private fields, audit events, recording retention (0/7/30 days), manual recording deletion, and the current EN/DE Dashboard, call-detail, registration, phone-verification, login, legal/support/FAQ, and onboarding experience are also present.

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
7. During local pre-beta development, prefer the final route architecture over compatibility: the former localized Dashboard and call-detail URLs are removed without redirects. Root `/` locale negotiation remains part of the public routing boundary.

## Verified implementation baseline — DONE

- [x] Create, compile, edit/recompile, review, approve-and-call, list, search, filter, paginate, start, stop, and monitor call briefs.
- [x] Versioned `RawCallBrief`, `CompiledCallBrief`, `PolicyDecision`, compiler snapshots, fixed clarification codes, moderation, and deterministic policy.
- [x] Supported low-risk task classification, controlled assistance reasons, six server-owned assistant profiles, represented-person disclosure, and approved-fact boundary.
- [x] Twilio outbound PSTN, signed HTTP/WebSocket callbacks, call-scoped stream token, provider status sync, and isolated Twilio ingress listener.
- [x] Same-voice disclosure, DTMF consent before recipient processing, dual-channel recording after consent, and consent/opening/readiness/objective sequencing.
- [x] OpenAI Realtime, SSE live events/transcript, operator stop, and sensitive disclosure approvals.
- [x] Whole-recording post-call transcription, conservative optional role/time alignment, playback proxy, export, and transcription retry.
- [x] PostgreSQL persistence for briefs, attempts, transcripts, approvals, recordings, final transcripts, compilations, and immutable audit events.
- [x] Schema-versioned, append-only durable call telemetry with immutable PostgreSQL storage, memory parity, bounded event-specific metadata, and lifecycle/credit idempotency.
- [x] AES-256-GCM protection for private context/facts and encrypted compilation/final transcript data.
- [x] Audio retention choices of 0, 7, or 30 days and manual provider recording deletion.
- [x] Responsive authenticated Dashboard and LiveCall/call-detail under `/en/app` and `/de/app`, with history search/filter/pagination, confirmations, loading/error states, and EN/DE typed UI catalogues.
- [x] Locale negotiation/cookie, public localized roots, authenticated localized call routes, and routing/i18n tests.
- [x] Represented-person input uses explicit first/last name fields; the personal default has been removed from contracts and the call form.
- [x] Local lint, typecheck, unit/integration tests, builds, and migration commands.

## Known partial implementation and beta gaps

- **PARTIAL — product UI:** the localized public landing, authenticated `/app` Dashboard/call detail, account/usage, legal/support/FAQ routes, acceptance-gated onboarding, server route guards, localized CMS Core, and structured Landing/FAQ/navigation administration exist. Media administration, reviewed operator/contact details, and production release work remain.
- **PARTIAL — localization:** operational UI and CMS-managed structured Landing/legal/support/FAQ content are EN/DE with locale-specific slugs and no silent fallback. Route-derived canonical/hreflang/robots/sitemap/OG metadata and translation-freshness reporting exist; structured global/organization settings and additional editorial models remain.
- **PARTIAL — observability:** audit/provider/SSE/health data and a privacy-safe durable technical event stream exist; outcomes, owner feedback, Admin Calls/Inspector, cost views, and production monitoring remain.
- **PARTIAL — async work:** transcription recovery and retention work remain substantially coupled to API process lifecycle.
- **PARTIAL — data lifecycle:** recording deletion, transcript export, current logout, and tested self-service all-session revocation exist; session listing, full-data export/deletion, and account deletion do not.
- **PARTIAL — identity foundation:** user/session tables, repositories, shared contracts, scrypt password handling, register/verify/resend/login/logout/me/all-session-revoke endpoints, localized register/verify/login screens, Twilio Verify integration, opaque server-side session cookies, credentialed web API requests, server-side app/admin route guards, and process-local auth/expensive-endpoint rate limits exist. Password recovery and distributed rate limits remain.
- **PARTIAL — tenancy rollout:** new call briefs are owned by the authenticated user; all browser list/read/write/action/SSE/media endpoints authenticate, scope by owner, and return the same not-found response for another user's ID. The PostgreSQL ownership suite has been executed successfully. Legacy pre-authentication rows remain nullable and intentionally invisible until an explicit migration/archive policy is chosen.
- **PARTIAL — destination rollout:** shared `libphonenumber-js/max` metadata parses and canonicalizes Swiss national/international input; contracts, call-start policy, and the Twilio adapter reject invalid or non-CH destinations. Production Twilio Voice Geographic Permissions still need to be restricted and captured as deployment evidence.

## Completed checkpoint — legal content and onboarding

- [x] Add the minimal final-shape content foundation: logical pages, localized slugs, immutable published revision snapshots, EN/DE publication data, and translation-source revision tracking. Admin editing, preview, rollback, Landing blocks, and navigation management now exist; Media remains deferred.
- [x] Publish local pre-beta EN/DE Privacy, Terms, Acceptable Use, Support, and FAQ routes from structured content. These implementation drafts do not satisfy the separate Swiss legal/privacy review release gate.
- [x] Store append-only user acceptance against the current published Terms and AUP revision IDs with timestamp and explicit onboarding acknowledgements.
- [x] Require current acceptance server-side before rendering `/app` or current `/admin` pages and before authorizing call/credit/admin APIs; redirect authenticated users to localized onboarding when re-acceptance is required.
- [x] Add contract, seed-content, PostgreSQL repository, API, route-boundary, and live-browser coverage; initial acceptance, stale submissions, and forced re-acceptance after a legal revision changes are automated.

## Completed checkpoint — CMS Core

- [x] Add an RBAC-scoped `/admin/content` entry point for `content_editor`, admin, and superadmin. Content editors are redirected away from `/app` and operational admin routes, and backend call/recording operations reject the role.
- [x] Add one-draft-per-page creation/editing, immutable publish snapshots, authenticated localized noindex preview, history, rollback-as-new-draft, and immutable content/legal audit events with actor/reason/time.
- [x] Manage the existing seeded EN/DE pages through the publishing workflow while retaining deterministic bootstrap publication data for clean local environments.
- [x] Preserve public reads on the latest published snapshot while drafts remain private; material Terms/AUP publication invalidates current onboarding acceptance through the existing revision boundary.

## Completed checkpoint — structured SEO boundary

- [x] Expose a public latest-published content index without drafts or audit data and automatically advance source-locale revision markers when source copy is saved.
- [x] Generate and test canonical URLs, published-localization-only hreflang plus `x-default`, index/follow metadata, localized Open Graph/Twitter metadata and 1200×630 images, `robots.txt`, and a database-driven sitemap.
- [x] Add an RBAC-scoped localized `/admin/seo` report for `content_editor`, admin, and superadmin with route/index state, title/description bounds, canonical, hreflang, OG image, and stale-translation warnings.

## Completed checkpoint — reusable FAQ and Navigation

- [x] Add separately revisioned bilingual FAQ and Navigation collections with one private draft, immutable published snapshots, history, rollback-as-new-draft, and append-only actor/reason/time audit events.
- [x] Reuse the published FAQ collection on the standalone FAQ route and expose locale-specific public FAQ data without drafts or audit metadata.
- [x] Restrict navigation destinations to known internal entities, resolve CMS page references to published locale-specific slugs, reject unresolved enabled destinations, and render the published header/footer collection with a safe static availability fallback.
- [x] Add an RBAC-scoped `/admin/content/editorial` editor for order, enable/disable, EN/DE FAQ copy, internal navigation labels/location/destination, publish, history, and rollback.
- [x] Cover contracts, memory/PostgreSQL repositories, immutable storage/audit triggers, public/admin APIs, and the web API client.

## Completed checkpoint — revision-managed Landing

- [x] Model localized Hero, How it works, Use cases, Safety & Privacy, Languages, reusable FAQ, and CTA as a bounded ordered/enabled block union rather than HTML or a universal page builder.
- [x] Publish Landing through the same private-draft, immutable-snapshot, authenticated noindex preview, history, rollback, and append-only audit boundary; `/en` and `/de` read only the latest published revision.
- [x] Reuse the independently published FAQ collection in the Landing FAQ block and remove the former hardcoded public Landing copy from the web application.
- [x] Include Landing publication revision, localized SEO fields, freshness state, sitemap timestamps, metadata, and generated social-image copy in the existing SEO boundary. Media remains deferred until a real asset workflow is required.
- [x] Cover the bounded contract, deterministic seed, memory/PostgreSQL repositories, draft privacy, publication order, public/admin APIs, preview transport, and SEO consumers.

## Completed checkpoint — durable call telemetry (5A)

- [x] Keep the existing `CallEvent` contract as the ephemeral SSE/UI envelope and add a separately named, schema-versioned `DurableCallEvent` contract.
- [x] Store technical events in append-only `call_events` rows correlated to call, attempt, and owner, with immutable database enforcement and deterministic source/stage/severity descriptors.
- [x] Instrument brief/compiler/policy/approval, attempt and credit lifecycle, provider status and confirmed connection, disclosure/consent, recording, Realtime conversation, final transcription, and restart recovery.
- [x] Restrict every event to an explicit metadata schema. Phone/name/objective/facts/transcript text, credentials, raw provider payloads, and arbitrary exception bodies are excluded.
- [x] Make repeated provider/recording callbacks and settlements idempotent. Busy/no-answer/pre-connection terminals refund once; charge occurs only after provider-confirmed connection, and a terminal domain state alone is not connection evidence.
- [x] Cover contracts, memory/PostgreSQL parity, immutable rows, callback replay, credit invariants, Realtime consent/conversation events, and sensitive-data exclusion.

## Next checkpoint — outcomes and owner feedback (5B), then Admin Calls (5C)

- [ ] Persist versioned/provenanced call outcomes separately from user feedback, deriving provider-confirmed connection and technical/failure stages without storing raw provider payloads in generic telemetry.
- [ ] Add owner-scoped post-call feedback for goal result, final-transcript quality, and an optional bounded comment; expose privacy-safe aggregate beta metrics.
- [x] Add a durable technical `call_events` stream distinct from immutable staff/action audit, with lifecycle stage, consent, duration, failure/provider/model, and credit-settlement fields. Derived latency and cost aggregation remain part of later read models.
- [ ] Add RBAC-protected `/admin/calls` list/detail views with useful status/outcome/consent/failure/language/date filters and privacy-minimized recipient/user context.

### Delivery order for this checkpoint

1. **5A — durable telemetry foundation — DONE.** The live `CallEvent` SSE contract remains unchanged. `DurableCallEvent` and immutable `call_events` now provide a bounded, PII-safe, idempotent technical timeline with transactional PostgreSQL writes and memory parity.
2. **5B — outcomes and owner feedback.** Keep technical terminal classification separate from semantic task outcome. Store immutable/versioned outcomes with provenance (`system`, `user`, or authorized staff) and never infer `resolved` from provider completion alone. Add owner-scoped Yes/Partly/No goal feedback, Good/Some errors/Poor transcript quality, and an optional length-bounded comment.
3. **5C — Admin Calls and Inspector.** Build the RBAC-protected list only after the event/outcome read model exists, then add the detail timeline, failure-stage filters, privacy-minimized identity context, and separately authorized/audited access to sensitive call content.

Immediate implementation scope is now **5B only**:

- Add an immutable, schema-versioned call-outcome record with explicit provenance (`system`, `user`, authorized staff) and revision history rather than mutable terminal labels.
- Derive only technical classifications from durable events: connection evidence, terminal/failure stage, consent/recording/transcription state. Never infer semantic task success from provider completion.
- Add owner-scoped feedback with goal result (Yes/Partly/No), final-transcript quality (Good/Some errors/Poor), and an optional length-bounded comment stored under the existing private-data boundary.
- Define idempotent submission/revision behavior, tenant isolation, and privacy-safe aggregate metrics before adding Admin Calls UI.
- Cover contracts, memory/PostgreSQL persistence, immutable revision/provenance evidence, ownership, idempotency, and the separation between technical classification and semantic feedback.

Acceptance for 5B: provider completion alone never marks a task resolved; every outcome/feedback revision has explicit provenance and ownership; another user cannot read or write it; comments remain bounded/private; aggregate beta metrics expose no call text or direct identity.

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
- [ ] Define the archive/backfill policy for nullable pre-authentication records before validating a final `NOT NULL` constraint. **Verified:** the PostgreSQL ownership integration suite executes successfully in the database-enabled local environment.

Acceptance: user A cannot infer, read, stream, mutate, start, stop, export, play, delete, or retry user B's resource.

### P0 — represented identity defect

- [x] Remove `DEFAULT_REPRESENTED_PERSON = "Ivan Slavinskyi"` and all implicit personal defaults. Require separate represented-person first and last names; store their combined value only as a compatible call snapshot.
- [x] Test that call brief validation rejects a missing first or last name and never supplies another person's name.
- [ ] Copy the authenticated user's `first_name` and `last_name` only as visible/editable suggestions; both represented-person fields remain an explicit choice.

### P1 — acceptance and lifecycle

- [x] Record append-only accepted Terms/AUP revision IDs and timestamps; require re-acceptance when a newer material revision is published.
- [ ] Provide session listing/revocation, user data export, transcript/data deletion, and account deletion/anonymization with documented audit, suppression, backup, provider, and retention behavior. **Partial:** `/app/account` supports current logout and tested all-session revocation; session inventory/audit and the remaining data lifecycle are open.

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
- [x] Add public opt-out and staff suppression workflow. The localized public form requires SMS proof of control and hashed phone/IP rate limits before a global block; the localized safety form and API restrict staff/complaint blocks and audited lifts to active admin/superadmin accounts with an explicit reason. Spoken in-call opt-out remains P2.
- [x] Implement audited account suspension and session blocking/revocation policy. Suspension atomically revokes all sessions; unsuspension never restores them; concurrent session creation and PostgreSQL call creation/reservation are blocked; force logout is a separate audited action.
- [x] Add a global kill switch that blocks new calls/reservations without ending active calls unless separately commanded. Changes require a reason and append immutable safety events; an operator CLI is available for PostgreSQL deployments.
- [ ] Rate-limit registration, auth/recovery, compilation, call create/start, exports, playback, and costly endpoints; detect mass accounts without logging unnecessary PII. **Partial:** registration/auth, shared create/recompile preparation, shared start/approve-and-start, recording download, and transcription retry limits are enforced by hashed user/IP with `Retry-After` and a bounded process-local bucket store. Recovery/export endpoints and durable cross-instance state remain.

### P1 — promo and complaints

- [x] Add `promo_codes` with keyed HMAC code hash, credits, global/per-user limits, start/expiry, active flag, campaign; add transactional unique and immutable `promo_redemptions`.
- [x] Issue promo/manual grants only through the ledger with actor, reason, time, idempotency. Redemption and ledger insertion share one locked transaction; admin grants resolve a verified target email and retain the acting administrator.
- [ ] Add complaint/abuse intake, repeat-call/opt-out/policy review, escalation, and response ownership.

## 3. Public Product & User Experience

### P0 — routing and authenticated shell

- [x] Make `/en` and `/de` public landing pages and redirect `/` through current locale negotiation.
- [x] Move—not rewrite—the Dashboard to `/en/app` and `/de/app`; move call detail to `/en/app/calls/[id]` and `/de/app/calls/[id]`, preserving current review, LiveCall, transcript, recording, history, search/filter/pagination, and accessibility behavior. The former local-development URLs are removed without compatibility redirects.
- [x] Add localized EN/DE login, registration, and phone-verification screens with separate required first and last names.
- [x] Add `/app/account` with integrated usage and session actions; protect all app routes server-side.
- [x] Add localized How it works, Privacy, Terms, Acceptable Use, Support, and Opt-out. App/admin/auth/onboarding routes are `noindex` (not a security control).
- [x] Show credits, New call, History, and account/session actions in the app header.

### P0 — landing and onboarding

- [x] Publish EN/DE Hero: AI phone assistant acting for the user, focused on speech accessibility/language barriers; CTA “Try the beta”; “Free public beta”, “3 calls included”, “Switzerland only”.
- [x] Explain: describe -> compile -> review/approve -> call -> result.
- [x] Explain disclosure, consent-gated processing/recording, retention/deletion control, and beta fallibility.
- [x] List supported information/appointment/document/status/neutral-message cases and prohibit emergencies, harassment, deception, spam/bulk marketing, political persuasion, and high-stakes legal/medical/financial negotiation.
- [x] Separate website languages from call languages; FAQ covers disclosure, consent, recording, transcripts, retention/deletion, Swiss numbers, and credits.
- [x] Add accessible onboarding with current Terms/AUP acceptance and explicit consent/retention/use/credit explanations.

### P1 — outcomes and feedback

- [ ] Persist versioned/provenanced outcomes: `resolved`, `partially_resolved`, `unresolved`, `wrong_recipient`, `voicemail`, `declined`, `technical_failure`.
- [ ] Ask goal result (Yes/Partly/No), final transcript quality (Good/Some errors/Poor), and optional bounded comment.
- [ ] Ownership-scope feedback and make it available as privacy-safe beta metrics.

## 4. Content / CMS / SEO

Keep buttons, forms, validation/errors, call/admin UI, and accessibility labels in typed code catalogues. CMS manages public editorial content only.

### P0 — localized CMS and publishing

- [ ] Add `/admin/content` for Landing, Pages, FAQ, Navigation, Media, and separate `/admin/seo`. **Partial:** RBAC-scoped EN/DE Landing, Pages, reusable FAQ, internal Navigation, and `/admin/seo` reporting are implemented; Media remains deferred.
- [x] Model logical `content_pages` separately from localized routing/editorial data, allowing `/en/privacy` and `/de/datenschutz`; expose draft/published state and editor-facing revision metadata.
- [ ] Support `page`, `landing`, future `article`; no blog or universal builder for beta.
- [ ] Store revision snapshots with editor/revision/times; support draft, authenticated or signed short-lived noindex preview, publish, history, rollback. Publish via DB update and cache revalidation, without deployment. **Partial:** the full audited editorial lifecycle and database publication, including Landing preview, are implemented; public reads pick up publication through the existing 60-second revalidation window, while targeted on-publish revalidation remains.
- [x] Model Landing as ordered/enabled localized Hero, How it works, Use cases, Safety & Privacy, Languages, FAQ, CTA blocks. Reusable localized FAQ items are independently published and embedded by reference.
- [x] Prefer navigation references to known internal entities and reject enabled destinations that cannot resolve for both public locales.
- [ ] Add media metadata: file/MIME/dimensions/size, EN/DE alt, uploader/time, usage references.

### P0 — legal/localization/SEO correctness

- [x] Let Terms/AUP revisions require account re-acceptance on both app/admin server rendering and protected APIs.
- [x] Track source revision and translation-source revision; automatically flag stale legal, FAQ, and claims in the SEO audit.
- [x] Never silently serve English at a German public URL. Unpublished locale means no route, sitemap entry, or hreflang; exact locale/slug reads return 404 and the locale switch resolves logical localized slugs.
- [ ] Generate localized title, description, slug, OG, robots, canonical; validate advanced canonical override. **Partial:** all route-derived metadata and localized generated OG images exist; a canonical override is intentionally not exposed until its validation/use policy is defined.
- [x] Generate hreflang and `x-default` automatically from published localizations of one logical page.
- [x] Sitemap only published/public/indexable pages; exclude app/admin/auth/preview and add matching robots behavior.
- [ ] Add global site/canonical/title/description/OG/verification and structured organization/product settings. Generate JSON-LD from structured fields, not arbitrary JSON. **Partial:** a validated canonical site origin, localized home metadata, and generated OG assets exist; editable verification/organization/product settings and JSON-LD remain.

### P1 — SEO audit

- [x] Report each public URL's locale, publication/index state, title/description, canonical, hreflang, and OG image with a compact error overview.

## 5. Admin & Observability

### P0 — minimum safe operations

- [ ] Protect `/admin` with server-side RBAC. `content_editor`: CMS/SEO, no calls/recordings. `support`: appropriate support/call metadata, no CMS or recordings by default. Admin/superadmin permissions remain explicit. **Partial:** content editors now have dedicated server- and API-guarded CMS/SEO boundaries with no app/call/recording or operational-admin access; admin/superadmin permissions remain explicit, while the role-specific support area remains.
- [ ] Audit staff login; user/session/status, credit, suppression, content/legal, kill-switch, export/deletion actions; and every sensitive call-content access. **Partial:** suspend/unsuspend/force-logout events and suppression/lift safety events are immutable and include the applicable actor, target/source, reason, and time.
- [ ] Provide user lookup, suspend/unsuspend, revoke sessions, ledger credit grant, suppression, and kill-switch controls before beta. **Partial:** the localized user console now consolidates paginated role-scoped lookup, ledger inspection, confirmed suspend/unsuspend, force logout, and idempotent manual credit grants; localized suppression controls and the kill-switch operator command also exist, but suppression lookup and in-app kill-switch control remain.

### P1 — admin areas

- [ ] `/admin`: user, call, outcome/consent/failure, cost, and system-health metrics.
- [ ] `/admin/users` and detail: identity/verification, activity/status, ledger/promos, calls/feedback/safety/complaints, and audited grant/suspend/session/delete actions. **Partial:** the localized RBAC-protected console supports paginated name/email/role/status search, a privacy-minimized credit ledger, and reasoned grant/suspend/unsuspend/session actions with destructive confirmations; calls, feedback, safety/complaints, promo history, and account deletion remain.
- [ ] `/admin/calls` and detail: user/recipient (controlled), locale, status/outcome, duration, consent, recording/transcription, failure stage, and useful failure/policy/model/language/date filters.
- [ ] `/admin/safety`: blocks, repeat recipients, no-consent/declines, opt-outs, complaints, suspicious registration/credits, anomaly review and actions. **Partial:** an RBAC-protected localized form now creates staff/complaint suppressions and audited lifts; list/search, anomaly queues, call context, and complaint review remain.
- [ ] `/admin/credits`: ledger, grants/adjustments, promo/redemption/expiry/campaign; no silent balance edits. **Partial:** localized RBAC-protected promo creation and manual reasoned grant forms exist; ledger/redemption browsing, deactivation, and campaign management remain.
- [ ] `/admin/audit`: actor/action/target/time/result filters and immutable evidence.

### P1 — Call Inspector and telemetry

- [x] Keep human/action `audit_events` separate. Add append-only `call_events`: call/attempt/user correlation, time, source/name/stage/severity, provider status/failure code, model/version, channels/duration, bounded metadata, and schema version. Add rebuildable `call_metrics` only if needed.
- [ ] Instrument brief/compiler/policy/approval/credit/Twilio/ringing/answer/disclosure/consent/recording/Realtime/first-audio/conversation/completion/transcription/outcome, including latency, retries, reconnects, provider IDs/status, model/version, channels/duration, feedback. **Partial:** the reconstructable 5A lifecycle is durable; first-audio latency, reconnect/cost derivation, outcomes, and feedback remain.
- [ ] Build `/admin/calls/[id]`: summary, timeline, technical metadata, separately permissioned sensitive content. Never show secrets; audit sensitive views.
- [x] Define event-specific metadata allow-lists excluding phone/name/brief/transcript text, credentials, cookies, OTPs, arbitrary exception bodies, and raw provider payloads from durable call events.
- [ ] `/admin/system`: API/DB/Twilio/OpenAI health, active calls, jobs/failures, webhooks, retention, transcription, costs, alerts, and kill switch.

## 6. Production & Compliance

### P0 — deployment and recovery

- [ ] Deploy stable web/API/Twilio ingress on production domain/TLS; Quick Tunnel is development-only. Preserve isolation of main authenticated API/SSE from Twilio ingress.
- [ ] Provision production Postgres, managed secrets, least privilege, repeatable migrations, encrypted backups/retention, and documented successful restore test/recovery targets.
- [ ] Add PII-safe structured logs, error and uptime/health monitoring, provider/cost dashboards and alerts.
- [ ] Enforce request limits, endpoint rate limits, secure headers, session security, CSRF where applicable, dependency scanning, configuration validation, and a focused security review. **Partial:** expensive endpoint rate limits and origin checks are implemented; the remaining headers/scanning/review work is still open.
- [ ] Document rollback, incident, provider outage, abuse, complaint, kill-switch, and support procedures with owners.

### P0 — privacy and Swiss launch review

- [ ] Publish reviewed EN/DE Privacy, Terms, AUP, Support/contact, Opt-out, retention/deletion, and subprocessors information. **Partial:** structured EN/DE implementation drafts now describe current retention, Twilio/OpenAI processing, support/data-request boundaries, and opt-out; reviewed operator/contact details and Swiss legal/privacy approval remain mandatory.
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
- [ ] Localized landing, auth/onboarding, support, opt-out live. **Partial:** every route and acceptance boundary is implemented and browser-verified locally; a monitored public support contact and production deployment remain.
- [ ] Reviewed Privacy, Terms, AUP, retention/deletion, subprocessors live. **Partial:** localized implementation drafts are live locally, but formal review and final operator/subprocessor/contact details remain.
- [x] CMS supports EN/DE drafts/revisions, authenticated noindex preview, immutable publication/history, rollback-as-new-draft, audit, and legal acceptance/re-acceptance.
- [x] Localized metadata, canonical, hreflang, robots, sitemap verified locally from published content.
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
- [x] Separate technical telemetry; `audit_events` remains action audit.
- [ ] Structured outcomes and user feedback measurable.
- [ ] Admin Users workflows. **Partial:** safe search, credit-ledger inspection, and consolidated status/session/grant actions exist; account deletion and related support context remain.
- [x] Transactional promo codes and ledger grants.
- [ ] Account/data export/delete and session revocation tested. **Partial:** current logout and all-session revocation are exposed in `/app/account` and tested; session listing, data export/delete, and account deletion remain.
- [ ] Support/complaint/suppression workflow with owners and targets. **Partial:** staff/complaint suppression and lift actions are RBAC-protected and audited, but complaint intake, ownership, escalation, and response targets remain.
- [ ] CI and `main` branch protection.
- [x] SEO audit.
- [ ] Quality/safety evaluation meets thresholds.

## Release decision record

- Decision: **GO / NO-GO**
- Release scope and tester cap:
- Date and approvers:
- Metrics observation window:
- P1 waivers, owners, controls, expiry:
- Open incident/legal/security/privacy findings:
- Rollback/kill-switch owner:
