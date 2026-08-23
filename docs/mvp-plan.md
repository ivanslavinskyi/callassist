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
- [x] Versioned owner-scoped account data export for profile, bounded active sessions, complete credit ledger, legal acceptances, call snapshots, consent/recording metadata, transcripts, outcomes, and feedback; provider/security identifiers are minimized and generation is rate-limited and immutably evidenced.
- [x] PostgreSQL persistence for briefs, attempts, transcripts, approvals, recordings, final transcripts, compilations, and immutable audit events.
- [x] Schema-versioned, append-only durable call telemetry with immutable PostgreSQL storage, memory parity, bounded event-specific metadata, and lifecycle/credit idempotency.
- [x] Immutable, schema-versioned call outcomes with explicit provenance, owner-scoped versioned feedback, encrypted bounded comments, and privacy-safe aggregate metrics.
- [x] AES-256-GCM protection for private context/facts and encrypted compilation/final transcript data.
- [x] Audio retention choices of 0, 7, or 30 days and manual provider recording deletion.
- [x] Responsive authenticated Dashboard and LiveCall/call-detail under `/en/app` and `/de/app`, with history search/filter/pagination, confirmations, loading/error states, and EN/DE typed UI catalogues.
- [x] Locale negotiation/cookie, public localized roots, authenticated localized call routes, and routing/i18n tests.
- [x] Represented-person input uses explicit first/last name fields; the personal default has been removed from contracts and the call form.
- [x] Local lint, typecheck, unit/integration tests, builds, and migration commands.

## Known partial implementation and beta gaps

- **PARTIAL — product UI:** the localized public landing, authenticated `/app` Dashboard/call detail, account/usage, legal/support/FAQ routes, acceptance-gated onboarding, server route guards, localized CMS Core, and structured Landing/FAQ/navigation administration exist. Media administration, reviewed operator/contact details, and production release work remain.
- **PARTIAL — localization:** operational UI and CMS-managed structured Landing/legal/support/FAQ content are EN/DE with locale-specific slugs and no silent fallback. Route-derived canonical/hreflang/robots/sitemap/OG metadata and translation-freshness reporting exist; structured global/organization settings and additional editorial models remain.
- **PARTIAL — observability:** audit/provider/SSE data, separate liveness/readiness, PII-safe runtime logging boundaries, a privacy-safe durable technical event stream, versioned outcomes, owner feedback, Admin Calls/Inspector, operational cohorts/cost estimates, local system controls, bounded webhook-delivery evidence, truthful external-worker heartbeat state, and versioned snapshot alert rules/runbooks exist; upstream probes, external monitor/pager routing, named ownership, protected log storage, and invoice reconciliation remain.
- **PARTIAL — production security:** bounded HTTP requests, API/web security headers, global unsafe-origin rejection, hardened production cookies, fail-closed API/worker configuration, migration drift detection, a high-severity dependency audit gate, Dependabot configuration, repository CI, versioned dual-read/new-write data encryption, resumable verified re-encryption, and a disposable local database recovery drill are implemented; external CI execution/branch protection, managed secrets/backups, infrastructure controls, an isolated production restore, focused security/privacy review, and deployment evidence remain.
- **PARTIAL — async work:** final transcription, recording retention, and Twilio call/recording status reconciliation run through PostgreSQL-backed durable jobs with leases, fencing, bounded retries, attempt history, dead-letter state, restart seeding, and an independently runnable worker. Real-provider crash drills, cross-process persisted-state invalidation, external-worker heartbeat visibility, and local queue/worker alert thresholds are complete; remaining generic cleanup jobs and deployment notification routing remain open.
- **PARTIAL — data lifecycle:** recording deletion, transcript export, versioned full-data export, current logout, bounded active-session inventory, owner-scoped selective revocation, tested self-service all-session revocation, verified-phone password recovery, password-confirmed terminal-call deletion, and durable account-wide deletion/anonymization with support recovery exist; production backup expiry and restore-time deletion replay evidence do not.
- **PARTIAL — identity foundation:** user/session tables, repositories, shared contracts, scrypt password handling, register/verify/resend/login/logout/me/recovery/session-inventory/selective/all-session-revoke/data-export endpoints, immutable minimized session/export/recovery evidence, localized register/verify/login/recovery/account screens, Twilio Verify integration, opaque server-side session cookies, credentialed web API requests, server-side app/admin route guards, and shared PostgreSQL auth/public-safety/expensive-endpoint limits exist. Phone-change re-verification, suspicious-activity triggers, and support-assisted phone-loss recovery remain.
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

## Completed checkpoint — outcomes and owner feedback (5B)

- [x] Persist versioned/provenanced call outcomes separately from user feedback, deriving provider-confirmed connection and technical/failure stages without storing raw provider payloads in generic telemetry.
- [x] Add owner-scoped post-call feedback for goal result, final-transcript quality, and an optional bounded encrypted comment; expose privacy-safe aggregate beta metrics.
- [x] Add a durable technical `call_events` stream distinct from immutable staff/action audit, with lifecycle stage, consent, duration, failure/provider/model, and credit-settlement fields. Derived latency and cost aggregation remain part of later read models.

The system derives technical state only from durable events. Provider completion never infers semantic success. Every owner submission appends separate feedback and semantic-outcome revisions, is idempotent by request key, remains tenant-scoped, and exposes comments only through the existing private owner boundary. PostgreSQL immutability, encrypted comment storage, memory parity, ownership, replay/conflict behavior, and aggregate privacy are covered by automated tests.

## Completed checkpoint — Admin Calls and Inspector (5C)

- [x] Add an RBAC-protected `/admin/calls` read model and localized list/detail views with useful status/outcome/consent/failure/language/date filters and privacy-minimized operational context.
- [x] Build a technical timeline from durable events and outcomes, with separately authorized and audited access to sensitive content.
- [x] Add deterministic cursor pagination, empty/error/loading states, and contract/memory/PostgreSQL/API/RBAC/web-client coverage.

The default Admin Calls response contains call and owner UUIDs, locale, lifecycle state, bounded technical metadata, outcome provenance, comment-free feedback ratings, duration, and event counts. It excludes recipient identity, phone number, objective, context, facts, transcript text, and private feedback comments. Admins and superadmins can inspect this minimized view; only superadmins may perform the separate reasoned sensitive-content read. PostgreSQL records every such read in an append-only, update/delete-protected access-evidence table.

## Completed checkpoint — operational overview and cost visibility (5D)

- [x] Add privacy-safe operational aggregates for call volume, connection/consent/failure/outcome rates, duration, first-audio latency, reconnects/retries, and estimated provider/model cost.
- [x] Build localized `/admin` overview and `/admin/system` views for API/database/configured-provider state, active calls, transcription/retention work, recent failures, and the existing outbound-call control.
- [x] Define snapshot freshness and unavailable/no-sample/not-supported semantics; expose raw warning/error counts and separately versioned deterministic snapshot alerts without pretending notification delivery exists, and cover aggregation, RBAC, privacy, UI states, and PostgreSQL query behavior without introducing a second source of truth.

### Delivery order for this checkpoint

1. **5A — durable telemetry foundation — DONE.** The live `CallEvent` SSE contract remains unchanged. `DurableCallEvent` and immutable `call_events` now provide a bounded, PII-safe, idempotent technical timeline with transactional PostgreSQL writes and memory parity.
2. **5B — outcomes and owner feedback — DONE.** Technical terminal classification remains separate from semantic task outcome. Immutable outcome/feedback revision chains, explicit provenance, encrypted bounded comments, owner isolation, idempotent submissions, and identity-free aggregate metrics are implemented and tested.
3. **5C — Admin Calls and Inspector — DONE.** The RBAC-protected list and detail read model provides deterministic operational filters, a bounded technical timeline and outcome provenance without private call text. Sensitive content is a separate superadmin-only, reasoned read with immutable access evidence.
4. **5D — operational overview and cost visibility — DONE.** Privacy-safe creation cohorts now expose exact denominators, outcomes, duration/first-audio, retry/disconnect/recovery signals, versioned bounded cost estimates, local workload/configuration state, and audited outbound-call control.

## Completed checkpoint — durable transcription and retention jobs (6A1)

- [x] Move final transcription, owner retry, and retention deletion from process-local promises/timers into PostgreSQL-backed jobs enqueued in the same repository transaction as the source state change.
- [x] Add exclusive expiring leases, heartbeat renewal, fencing at user-visible writes, bounded exponential retries, terminal dead-letter state, immutable attempt history, startup seeding, and memory/PostgreSQL parity.
- [x] Extend `/admin/system` with bounded privacy-safe queue counts, oldest due work, recent job state, controlled failure codes, call-inspector links, and a reasoned superadmin-only dead-letter retry with immutable evidence.
- [x] Cover expired-worker fencing, retry/success, dead-letter restart generations, RBAC, immutable audit/attempt rows, and PostgreSQL claim concurrency.

Acceptance for 6A1 is met: queued work survives API restarts; only the current lease may publish a result; retry/dead-letter transitions are bounded and inspectable; ordinary users cannot access operational job state; and job payloads/system responses contain neither credentials nor private call text.

## Completed checkpoint — provider and webhook reconciliation (6A2)

- [x] Add durable Twilio call/recording status reconciliation for callbacks that are delayed or permanently lost. Signed callbacks remain primary; bounded provider reads recover controlled status/failure fields without storing raw payloads.
- [x] Schedule reconciliation transactionally with provider IDs, advance it immediately on restart or terminal callback, preserve active Twilio calls until provider state is known, and fence every reconciliation write by the current durable lease.
- [x] Expose privacy-safe provider-reconciliation queue/retry/dead-letter state through the existing `/admin/system` durable-job boundary and cover no-answer refunds, connected-call charging, lost recording completion, restart recovery, target deduplication, and stale-worker fencing in memory and PostgreSQL tests.
- [x] Add PII-free hourly accepted/rejected/unmatched/failed webhook aggregates, last-accepted age, and controlled last-problem evidence to `/admin/system`. The view labels age as a raw signal rather than an upstream probe, directs admins to reconciliation state, and reserves reasoned dead-letter retry for superadmins.
- [x] Add an independently runnable durable-worker entry point and explicit `embedded`/`external` topology. In external mode the API only enqueues; the worker owns recovery, seeding, polling, heartbeats, and execution. Shutdown stops new claims and drains the active lease, while restart claims remaining work; configuration, lifecycle, and process-local status boundaries are automated.
- [x] Add repeatable real-provider partial-failure and crash-boundary drills with explicit recipient authorization and PII-safe assertions. A live Twilio callback-contract mismatch was fixed with separate REST-resource and webhook status models; a worker-outage call proved queued reconciliation, transcription, and zero-day retention drain on restart without changing connection-backed credit settlement. Upstream operations may be retried, so correctness still depends on provider idempotency plus repository fencing rather than claiming external exactly-once execution. See `docs/real-provider-drills.md`.

Acceptance for 6A2 is met: stale call and recording state is durably detected and reconciled without weakening signed webhook boundaries; restart recovery no longer invents a Twilio failure/refund before querying provider state; pre-connection busy/no-answer paths still refund rather than charge; operators can distinguish callback acceptance, rejection, missing targets, and processing failure without exposing call/provider IDs or payloads; API/worker execution can be split without competing local consumers; and real-provider callback failure plus worker-outage recovery have been exercised.

## Completed checkpoint — cross-process state and worker liveness (6A3)

- [x] Relay committed worker/API state changes through a bounded PostgreSQL `LISTEN/NOTIFY` invalidation channel. Payloads contain only source and application-call UUIDs; the receiving API rehydrates the canonical snapshot and never transports private call content through PostgreSQL notifications.
- [x] Preserve the existing owner-authorized SSE contract, suppress self-originated duplicates, avoid remote reads when no local subscriber exists, keep ephemeral Realtime deltas local, and rely on snapshot load/reconnect rather than treating best-effort notification delivery as durable state.
- [x] Persist a bounded external-worker heartbeat with start/last-seen/stop timestamps and active-job count. Five-second reporting, a 15-second stale threshold, graceful offline transition, crash-stale behavior, and 30-day cleanup are explicit.
- [x] Expose healthy/stale/offline external-worker state, instance counts, active jobs, and last-seen age in the shared admin contract and localized `/admin/system` UI without worker IDs or private job payloads.
- [x] Cover source de-duplication, cross-service delivery, heartbeat lifecycle, stale/fresh aggregation, PostgreSQL notification transport, migration, contracts, and runtime shutdown behavior.

Acceptance for 6A3 is met: post-call worker changes reach an already-open API SSE stream without polling; missed notifications cannot lose state; `/admin/system` no longer mistakes an API-local disabled timer for external-worker health; and both graceful stop and stale-crash states are distinguishable.

## Completed checkpoint — operational readiness foundation (6B)

- [x] Replace the ambiguous combined health route with non-cacheable `GET /health/live` (process-only) and `GET /health/ready` (PostgreSQL-backed), returning bounded contracts and no dependency exception text. Keep both absent from the isolated Twilio ingress.
- [x] Configure the API and webhook Fastify runtimes to log registered route templates rather than raw URLs, redact known identity/content/credential/provider-ID fields, and replace arbitrary error messages/stacks with controlled shapes. Make standalone worker failures event-code-only.
- [x] Evaluate a versioned privacy-safe snapshot alert policy in `/admin/system` for external-worker availability, dead-letter and overdue queued work, retention deletion, webhook processing failures, and recent technical errors; expose severity, observed value, threshold, unit, and stable runbook code in EN/DE admin UI.
- [x] Document health semantics, logging allow/deny rules, thresholds, containment/recovery/verification flows, and role ownership for worker, job, retention, webhook, application, provider, rollback, abuse, complaint, privacy, and support incidents.

Acceptance for 6B is met locally: probes can distinguish a live process from a database-ready API; generic request/error logs do not intentionally serialize raw request/private content; alert evaluation is deterministic and contract-tested; and every signal maps to a documented response. Production monitor/pager integration, protected log transport/retention, upstream provider and invoice alerts, named human assignments, and drills remain explicit deployment gates.

## Completed checkpoint — application security and CI foundation (6C)

- [x] Bound both Fastify listeners by request-body size, request timeout and connection timeout; apply restrictive API headers and a web CSP/security-header policy without exposing raw configured URL paths.
- [x] Reject supplied foreign origins for every unsafe main-API request before dispatch, retain `SameSite=Lax`, and use a `Secure`, `HttpOnly`, `Priority=High`, host-only `__Host-` session cookie in production.
- [x] Fail production API/worker startup closed unless PostgreSQL, external worker topology, Twilio/OpenAI drivers and secrets, non-local HTTPS origins, valid independent 32-byte encryption/HMAC keys, and distinct listener ports are configured. Error output names invalid settings without printing their values.
- [x] Require a non-empty catalog with contiguous canonical migration names and non-empty SQL, persist SHA-256 checksums, reject changed or missing applied migrations, and support an explicit catalog-validation command. Legacy applied rows receive a one-time checksum bootstrap.
- [x] Add read-only GitHub CI with frozen installation, PostgreSQL service, catalog validation, double migration execution, high-severity production dependency audit, lint, typecheck, tests and builds; add weekly pnpm and GitHub Actions Dependabot checks.
- [x] Update vulnerable compatible dependencies and lock inherited Sharp/PostCSS versions to patched releases. The production dependency audit currently reports no known vulnerabilities; future findings at any severity remain visible for triage.

Acceptance for 6C is met in the repository: oversized bodies fail before application parsing, unsafe foreign origins fail before route dispatch, production cookies/configuration are automated, modified applied migration files fail closed, and the complete CI contract is versioned. The first hosted CI run, required-check branch protection, infrastructure/WAF/rate-limit controls, managed-secret rotation, and independent focused security review remain deployment gates.

## Completed checkpoint — recovery and secret-operations foundation (6D)

- [x] Add a guarded PostgreSQL custom-format backup/restore drill that accepts only a local named application database and creates/drops only a randomized `callassist_restore_drill_<hex>` target.
- [x] Compare the complete public-table inventory, row-count and migration/checksum snapshots, rerun migrations idempotently, read critical tables, verify available ciphertext samples with the current data key, and emit versioned PII-free evidence.
- [x] Keep the temporary archive outside the repository with restrictive permissions and remove both the archive and disposable database on success or failure; run the drill in CI against its PostgreSQL service container.
- [x] Define provisional invite-alpha RPO/RTO, backup encryption/retention/evidence requirements, the isolated production recovery sequence, drill cadence, and deletion/suppression replay boundary.
- [x] Document credential rotation by secret family and explicitly forbid an in-place `DATA_ENCRYPTION_KEY` swap until key-ring, dual-read and resumable re-encryption support exists.

Acceptance for 6D is met locally: real PostgreSQL 17 custom archives restored from both the application and populated integration-test databases; all 34 canonical migrations, 35 public tables and exact row counts matched, every critical table was readable, all eight encrypted data families available in the populated run decrypted, and all temporary resources were removed. Managed PITR/backups, accepted owner targets, production-isolated restore evidence, secret-manager configuration, and an exercised production credential/key procedure remain deployment gates.

## Completed checkpoint — versioned data-encryption rotation (6E)

- [x] Replace implicit single-key writes with authenticated `v2` AES-256-GCM envelopes carrying a bounded key ID; authenticate that ID as additional data while preserving legacy `v1` reads through an explicit legacy-key mapping.
- [x] Validate the production keyring fail closed: require an explicit active ID, bound decrypt-only history, reject unknown/reserved/duplicate IDs and reused key material, and keep the promo-code HMAC key independent from every data key.
- [x] Version owner-feedback fingerprints and derive their new HMAC key with purpose separation while preserving exact legacy replay semantics.
- [x] Add a confirmation-gated, advisory-lock-protected, resumable PostgreSQL command that rotates all eight ciphertext families in bounded transactions, narrowly preserves immutable feedback semantics, verifies every ciphertext/fingerprint, and emits PII-free evidence.
- [x] Exercise re-encryption in CI before the recovery drill and document the maintenance, verification, backup-expiry and old-key retirement sequence.

Acceptance for 6E is met locally: migrations 0035–0036 applied idempotently; 107 existing ciphertexts were re-encrypted and decrypted under `local-1` with zero non-active values; an immediate second run rewrote zero rows while re-verifying all 107. The CI-shaped populated-database run separately rotated and verified 7,569 ciphertexts plus 40 feedback fingerprints, rewrote zero on replay, then restored all eight encrypted families. The remaining launch gates are managed-secret provisioning, isolated production backup/restore evidence, named owners, and one exercised production rotation with retained evidence.

## Completed checkpoint — account session inventory and revocation (6F1)

- [x] Add a bounded active-session contract with current-session identity, lifecycle timestamps, total/truncated semantics, and categorized browser/platform values; never expose token hashes, raw User-Agent or IP.
- [x] Add owner-scoped `GET /api/auth/sessions` and selective `DELETE /api/auth/sessions/:sessionId`; a foreign or stale ID returns the same not-found response, while revoking the current session clears its cookie.
- [x] Make selective and all-session self-service revocation atomic with immutable, minimized PostgreSQL evidence containing only actor, optional session UUID, count, action and time.
- [x] Integrate the inventory and destructive confirmations into the localized EN/DE account console while retaining current logout and sign-out-everywhere recovery actions.
- [x] Cover bounded contracts, memory/PostgreSQL parity, cross-user isolation, current/other-session behavior, immutable evidence, client requests and production rendering.

Acceptance for 6F1 is met locally: migration 0037 applies idempotently; the current session is always included first in the bounded inventory without exposing credentials or raw client data; a user cannot infer or revoke another user's session; current, selective and all-session paths invalidate exactly the intended tokens; and security-action evidence rejects update/delete. The complete gate passes 369 tests, restores all 37 migrations and 36 public tables, and builds the production account route in both locales.

## Completed checkpoint — user data export (6F2)

- [x] Define a strict versioned server-generated JSON schema for the authenticated account, bounded categorized active sessions, complete credit ledger, immutable onboarding acceptances, and every owned call snapshot/outcome/feedback record.
- [x] Gather calls through owner-scoped pagination and a second ownership check; decrypt private brief/compilation/transcript fields only through the existing repository boundary while removing provider recording/response identifiers, foreign staff actor IDs, credential hashes, tokens, raw User-Agent and IP.
- [x] Add origin-protected `POST /api/account/data-export` with a shared atomic per-user/IP daily limit, attachment/no-store/nosniff response headers, and a localized EN/DE download surface that warns about sensitive contents.
- [x] Append only minimized generation evidence (`export_id`, user, schema version, call/byte counts, time) to an immutable PostgreSQL table; never persist the generated document in the audit record.
- [x] Cover strict schema versioning, unauthenticated access, cross-user isolation, private encrypted-field round-trip, identifier minimization, rate limiting, immutable evidence, and browser-client attachment handling.

Acceptance for 6F2 is met locally: migration 0038 applies idempotently; the downloaded file contains the authenticated user's currently owner-visible account/call/consent/credit/legal records and no other user's call data; encrypted private fields are available after authorized repository decryption while storage remains ciphertext; credential/token/raw-client/provider identifiers are absent or nulled; and export evidence rejects update/delete. The complete gate passes 373 tests, restores all 38 migrations and 37 public tables, and builds the production account route in both locales. This technical self-service export supports data access and portability but does not replace the formal Swiss privacy/legal review or a controller-handled request workflow.

## Completed checkpoint — owner call-data deletion (6F3a)

- [x] Define a record-by-record lifecycle policy for call/account identity, transcripts, provider media and identifiers, approvals, feedback, immutable financial/consent/safety/audit evidence, recipient suppression continuity, durable jobs, backups and support escalation.
- [x] Add an origin-protected, owner-scoped terminal-call deletion endpoint with current-password step-up, exact `DELETE` confirmation, UUID idempotency and a per-user/IP daily limit.
- [x] Delete Twilio audio before local redaction; provider failure leaves all local content intact for safe retry, and Twilio 404 remains an idempotent already-absent success through the provider boundary.
- [x] Atomically hide the call from owner/history/export reads; redact brief, compilation, transcript, approval, feedback-comment and provider fields; preserve categorical outcomes plus minimized credit, consent, technical, safety and audit evidence.
- [x] Cancel queued/running content jobs with fenced leases and immutable cancelled-attempt evidence so stale workers cannot recreate deleted transcripts.
- [x] Add a localized EN/DE destructive surface to terminal call details, truthful privacy seed copy, PostgreSQL/memory parity, cross-user isolation, immutable evidence and provider-failure tests.

Acceptance for 6F3a is met locally: provider deletion precedes the database transaction; a failed provider delete records no false success and changes no local content; a successful or concurrently replayed request makes the call inaccessible to owner reads and data export while retaining only the documented non-content shell. Migrations 0039–0040 add the deletion tombstone/evidence and a narrowly constrained privacy-redaction exception without permitting semantic feedback mutation. The complete gate passes 378 tests, builds all packages and the localized production call-detail route, and restores all 40 migrations and 38 public tables with encrypted-sample verification.

## Completed checkpoint — durable account deletion/anonymization (6F3b)

- [x] Add a PostgreSQL/memory account-wide request state machine with due ordering, leases, lease-expiry recovery, bounded exponential retries, generations, owner-visible states, immutable attempts, and immutable lifecycle events.
- [x] Require an allowed origin, active owner session, current-password step-up, exact `DELETE MY ACCOUNT` phrase, client UUID and per-user/IP rate limit; return an existing request idempotently.
- [x] Block new browser call mutations while deletion is pending; stop inactive pre-call drafts and delay without spending the provider-failure budget while any owned call is dialing, connected, or paused for approval.
- [x] Reuse the provider-first 6F3a primitive for every terminal call, preserve recipient suppressions and minimized retained evidence, and never report completion while provider deletion or local redaction is incomplete.
- [x] Finalize only after the PostgreSQL transaction rechecks that no undeleted call remains; tombstone email/phone/first name/last name/password, clear verification/login identity, mark the user deleted, revoke all sessions, and append completion evidence atomically.
- [x] Add localized EN/DE account status and destructive confirmation UI plus Admin Users exhausted-retry context with reason, confirmation, a fresh generation, and no restoration of already-deleted content.

Acceptance for 6F3b is met locally: the queue survives process boundaries, stale leases are recoverable, active calls enter an owner-visible wait state without consuming retry allowance, provider/local failures back off into `needs_support`, and a reasoned admin retry starts generation 2. PostgreSQL integration verifies the final identity/session/request/evidence transaction and immutable attempts/events. Migration 0041 brings the repository to 41 migrations and 41 public tables. The complete gate passes 385 tests and builds all packages and localized account/admin routes. Production backup duration, an independently retained deletion journal, and an isolated restore-and-replay drill remain release gates rather than an application-only promise.

## Completed checkpoint — password/account recovery (6F4)

- [x] Define and document a non-enumerating recovery boundary: every valid email receives the same accepted response and fresh random recovery UUID, while only active verified accounts without pending deletion receive a durable challenge and SMS.
- [x] Add a 10-minute PostgreSQL/memory challenge with newest-request invalidation and an eight-attempt durable cap; provider-send failure invalidates the challenge without exposing account eligibility or PII in operational logs.
- [x] Exchange a successful verified-phone OTP for a distinct 32-byte random, 15-minute, single-use grant while storing only its SHA-256 digest and never placing capabilities in URLs, cookies, logs, browser storage, or immutable evidence.
- [x] Atomically replace the password with the existing scrypt policy, clear last-login state, revoke every session, consume the grant, and append immutable minimized recovery evidence. Session creation must still match the password hash verified by login, closing the concurrent old-password race.
- [x] Add hashed process-local IP/email/phone/recovery/token rate boundaries plus the distributed-ready database attempt cap, with `Retry-After` on explicit throttling and generic SMS suppression where eligibility must stay private.
- [x] Deliver localized EN/DE in-memory `email → SMS → new password` screens, explicit fresh-login completion, strict contracts, API/client coverage, memory/PostgreSQL parity, immutable-evidence checks, and production route builds.

Acceptance for 6F4 is met locally: unknown, suspended, deleted/deletion-pending and eligible accounts have indistinguishable start payloads; stale, exhausted, expired and replayed capabilities cannot change credentials; successful completion changes the scrypt credential, invalidates every existing session and does not auto-login; and a stale concurrent login cannot create a post-reset session. Migration 0042 brings the repository to 42 migrations and 44 public tables. The complete gate passes 391 tests and builds all packages plus the localized recovery route. The threat model and remaining phone-loss/support boundary are versioned in `docs/password-recovery-policy.md`.

## Completed checkpoint — shared rate limits and abuse controls (6F5)

- [x] Replace the synchronous process-local contract with one injected asynchronous limiter used by registration/login/verification/recovery, public recipient opt-out, and every expensive/cost-bearing endpoint. PostgreSQL is authoritative in shared deployments; bounded memory mode remains for tests and single-process development.
- [x] Store only independent-key HMAC-SHA-256 identifier digests, validate bounded controlled scopes/windows/limits, cap the durable store at 100,000 active buckets, and expire enforcement state after at most seven days.
- [x] Serialize cross-instance decisions with deterministic PostgreSQL advisory locks. Grouped IP/user and IP/phone budgets increment every key or none, including under concurrent requests from separate limiter instances.
- [x] Fail closed with `503 RATE_LIMIT_UNAVAILABLE` before identity, SMS, suppression, provider, credit, export/deletion, download, or retry side effects. Eligibility-sensitive recovery start preserves its generic public response while suppressing SMS; Admin System stays available with an explicit degraded limiter status.
- [x] Add 30-day hourly allowed/denied aggregates by controlled scope only, expose a bounded 24-hour Admin System view in EN/DE, and exclude raw or hashed person/request identifiers from metrics and operational errors.
- [x] Require an independent production `RATE_LIMIT_HASH_KEY`, automate local generation and CI configuration, document synchronized rotation/store-outage behavior, and prove concurrency, atomic group rejection, expiry, cardinality, privacy, and no-side-effect failure paths.

Acceptance for 6F5 is met locally: twenty concurrent decisions split across two independent PostgreSQL limiter instances admit exactly the shared five-request budget; denied grouped requests do not partially consume a second key; expired buckets recover; store outages return the documented retryable boundary before registration, SMS, or brief persistence; and admin telemetry degrades without exposing identifiers. Migration 0043 brings the repository to 43 migrations and 46 public tables. The complete gate passes 403 tests (263 API, 79 web, 61 contracts), lint/typecheck, the production builds, dependency audit, migration drift check, and a disposable 46-table backup/restore drill. Infrastructure/WAF controls, external alert routing, mass-account correlation, and an exercised production outage drill remain deployment gates.

The next repository checkpoint is **6F6 — verified phone-number change and re-verification**: define a current-password/OTP step-up, verify a unique replacement number before an atomic swap, revoke other sessions and stale recovery capabilities, append minimized immutable security evidence, add shared abuse limits and conflict-safe PostgreSQL/memory parity, and deliver localized account UI plus cross-user/concurrency tests. Support-assisted recovery after loss of the verified phone remains a separately reviewed policy rather than an administrative bypass.

# Public Beta Foundation

## 1. Identity & Tenancy

### P0 — users, authentication, and sessions

- [x] Add `users`: `id`, unique normalized `email`, password credential, unique normalized `phone_e164`, `phone_verified_at`, required `first_name` and `last_name`, `role`, `status`, `ui_locale`, `created_at`, `last_login_at`. Build any display label from the two name fields; do not use a single ambiguous `display_name` as the source of identity.
- [x] Support `active`, `suspended`, `deleted` in storage and session authentication; define role values `user`, `admin`, `superadmin`, `content_editor`, `support`. Narrow account-status/session-revocation routes enforce server-side admin/superadmin RBAC; the complete admin permission matrix remains in the admin phase.
- [x] Add revocable server-side `sessions` with hashed opaque token, user, expiry, revocation, creation and last-use data. Issue HttpOnly, SameSite=Lax cookies and add Secure in production.
- [x] Implement backend registration, phone verification/resend, login, logout, and current-user endpoints with email, scrypt password, phone, and Twilio Verify SMS **phone verification/OTP**. Registration OTP is not 2FA.
- [x] Add password/account recovery with a non-enumerating start, verified-phone OTP step-up, a short-lived single-use grant, atomic password replacement/session revocation, and immutable minimized evidence.
- [x] Rate-limit verification sends/attempts, login, account creation, recovery, public opt-out, and expensive endpoints by atomic IP plus phone/email/user/capability groups. Twilio limits are defense-in-depth, not the sole control.
- [x] Move rate-limit state to a shared durable PostgreSQL store before running multiple API instances; retain only keyed identifier digests, bounded ephemeral buckets, and scope-only hourly metrics.
- [ ] Define re-verification for number changes and step-up verification for recovery, suspicious activity, and sensitive operations. **Partial:** verified-phone recovery step-up is implemented with durable attempts and a one-time grant; number changes, suspicious-activity triggers, support-assisted phone-loss recovery, and the remaining sensitive-operation matrix are open.

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
- [ ] Provide session listing/revocation, user data export, transcript/data deletion, and account deletion/anonymization with documented audit, suppression, backup, provider, and retention behavior. **Partial:** all application flows now exist, including durable owner-visible account anonymization and reasoned support recovery; production backup expiry, an external deletion journal, restore-time replay, and final legal/privacy review remain open.

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
- [ ] Rate-limit registration, auth/recovery, compilation, call create/start, exports, playback, and costly endpoints; detect mass accounts without logging unnecessary PII. **Partial:** registration/auth/recovery/public opt-out, create/recompile preparation, start/approve-and-start, promo redemption, data export/deletion, recording download, and transcription retry limits use atomic shared PostgreSQL buckets keyed by independent HMAC digests, with bounded cardinality, expiry, `Retry-After`, fail-closed outages, and scope-only aggregate metrics. Recovery OTP attempts additionally have a durable per-challenge cap. Privacy-reviewed mass-account correlation remains.

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

- [x] Persist versioned/provenanced outcomes: `resolved`, `partially_resolved`, `unresolved`, `wrong_recipient`, `voicemail`, `declined`, `technical_failure`.
- [x] Ask goal result (Yes/Partly/No), final transcript quality (Good/Some errors/Poor), and optional bounded comment.
- [x] Ownership-scope feedback and make it available as privacy-safe beta metrics.

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
- [ ] Audit staff login; user/session/status, credit, suppression, content/legal, kill-switch, export/deletion actions; and every sensitive call-content access. **Partial:** self-service selective/all-session revocation and data-export generation, suspend/unsuspend/force-logout, suppression/lift, and sensitive call-content reads are immutable and include only the bounded applicable actor, target/source, reason/count/size, schema and time.
- [ ] Provide user lookup, suspend/unsuspend, revoke sessions, ledger credit grant, suppression, and kill-switch controls before beta. **Partial:** the localized user console now consolidates paginated role-scoped lookup, ledger inspection, confirmed suspend/unsuspend, force logout, and idempotent manual credit grants; localized suppression controls and the kill-switch operator command also exist, but suppression lookup and in-app kill-switch control remain.

### P1 — admin areas

- [ ] `/admin`: user, call, outcome/consent/failure, cost, and system-health metrics. **Partial:** privacy-safe call/outcome/consent/failure cohorts, exact denominators, latency/reliability, bounded cost estimates, local system status, and versioned snapshot alerts exist; user metrics, upstream probes, and production notification routing remain.
- [ ] `/admin/users` and detail: identity/verification, activity/status, ledger/promos, calls/feedback/safety/complaints, and audited grant/suspend/session/delete actions. **Partial:** the localized RBAC-protected console supports paginated name/email/role/status search, a privacy-minimized credit ledger, reasoned grant/suspend/unsuspend/session actions, and recovery of an exhausted owner-confirmed deletion request with destructive confirmations; calls, feedback, safety/complaints, and promo history remain.
- [x] `/admin/calls` and detail: privacy-minimized owner context, locale, status/outcome, duration, consent, recording/transcription, failure stage, deterministic operational filters, technical timeline, outcome history, and a separately authorized sensitive-content boundary.
- [ ] `/admin/safety`: blocks, repeat recipients, no-consent/declines, opt-outs, complaints, suspicious registration/credits, anomaly review and actions. **Partial:** an RBAC-protected localized form now creates staff/complaint suppressions and audited lifts; list/search, anomaly queues, call context, and complaint review remain.
- [ ] `/admin/credits`: ledger, grants/adjustments, promo/redemption/expiry/campaign; no silent balance edits. **Partial:** localized RBAC-protected promo creation and manual reasoned grant forms exist; ledger/redemption browsing, deactivation, and campaign management remain.
- [ ] `/admin/audit`: actor/action/target/time/result filters and immutable evidence.

### P1 — Call Inspector and telemetry

- [x] Keep human/action `audit_events` separate. Add append-only `call_events`: call/attempt/user correlation, time, source/name/stage/severity, provider status/failure code, model/version, channels/duration, bounded metadata, and schema version. Add rebuildable `call_metrics` only if needed.
- [ ] Instrument brief/compiler/policy/approval/credit/Twilio/ringing/answer/disclosure/consent/recording/Realtime/first-audio/conversation/completion/transcription/outcome, including latency, retries, reconnects, provider IDs/status, model/version, channels/duration, feedback. **Partial:** the reconstructable lifecycle, first-audio latency, retries/disconnects/recovery, technical outcomes, owner feedback, and versioned cost derivation are durable; Realtime reconnect is explicitly unsupported until a recovery design exists.
- [x] Build `/admin/calls/[id]`: summary, timeline, technical metadata, separately permissioned sensitive content. Never show secrets; audit sensitive views.
- [x] Define event-specific metadata allow-lists excluding phone/name/brief/transcript text, credentials, cookies, OTPs, arbitrary exception bodies, and raw provider payloads from durable call events.
- [ ] `/admin/system`: API/DB/Twilio/OpenAI health, active calls, jobs/failures, webhooks, retention, transcription, costs, alerts, and kill switch. **Partial:** separate API liveness/database readiness, provider configuration (not upstream health), active workload, durable queue/retry/dead-letter detail, external-worker heartbeat liveness, privacy-safe webhook-delivery aggregates and age, versioned snapshot alerts, costs via the overview, reasoned superadmin job recovery, and RBAC kill-switch control exist; provider probes and external notification routing remain.

## 6. Production & Compliance

### P0 — deployment and recovery

- [ ] Deploy stable web/API/Twilio ingress on production domain/TLS; Quick Tunnel is development-only. Preserve isolation of main authenticated API/SSE from Twilio ingress.
- [ ] Provision production Postgres, managed secrets, least privilege, repeatable migrations, encrypted backups/retention, and documented successful restore test/recovery targets. **Partial:** forward transactional migrations have catalog/checksum drift detection; a versioned keyring and verified re-encryption command exist; a disposable local restore drill, PII-free evidence contract, provisional 15-minute RPO/two-hour database RTO, backup policy and recovery sequence are versioned. Production database/PITR, owner acceptance, secret manager, exercised production rotation and isolated restore evidence remain.
- [ ] Add PII-safe structured logs, error and uptime/health monitoring, provider/cost dashboards and alerts. **Partial:** route-template request logs, controlled error serialization, explicit redaction, event-only worker failures, split liveness/readiness, local admin alerts, and cost estimates exist; protected log transport/retention, real uptime/error collection and paging, provider probes, and invoice/budget alerts remain.
- [ ] Enforce request limits, endpoint rate limits, secure headers, session security, CSRF where applicable, dependency scanning, configuration validation, and a focused security review. **Partial:** bounded listeners, shared atomic PostgreSQL application limits, API/web security headers, global unsafe-origin rejection plus SameSite cookies, production `__Host-` cookies, fail-closed configuration, and a dependency-audit gate exist; infrastructure/WAF limits and an independent focused review remain.
- [ ] Document rollback, incident, provider outage, abuse, complaint, kill-switch, and support procedures with owners. **Partial:** repository runbooks define procedures and accountable roles; named primary/backup humans, monitored channels, response hours, and completed drills remain required.

### P0 — privacy and Swiss launch review

- [ ] Publish reviewed EN/DE Privacy, Terms, AUP, Support/contact, Opt-out, retention/deletion, and subprocessors information. **Partial:** structured EN/DE implementation drafts now describe current retention, Twilio/OpenAI processing, support/data-request boundaries, and opt-out; reviewed operator/contact details and Swiss legal/privacy approval remain mandatory.
- [ ] Perform formal privacy/security risk assessment for phone numbers, names, recordings, transcripts, possible health/speech-disability data, and provider/AI processing. Obtain Swiss legal/privacy review and separately assess DPIA necessity without predetermining the conclusion.
- [ ] Verify consent evidence, retention/deletion, data requests, provider deletion, backup expiry, sensitive staff access audit, encryption, and key management end to end.
- [ ] Preserve the conservative consent boundary in production.

### P1 — durable jobs and CI

- [ ] Use durable idempotent jobs for final transcription, retries, recording processing, retention deletion, provider reconciliation/status sync, and cleanup. **Partial:** PostgreSQL-backed transcription, retention, and provider call/recording reconciliation provide leases, fencing, bounded retry/dead-letter state, immutable attempts, transactional scheduling, restart seeding, and a separate runtime; remaining generic cleanup work remains.
- [x] Test restart, duplicate webhook, concurrent worker, and partial provider failure; expose stuck/dead-letter work. Lease-expiry recovery, stale-worker fencing, duplicate enqueue, concurrent PostgreSQL claims, bounded retry, dead-letter visibility, audited manual restart, and deterministic lost call/recording callback recovery are automated; repeatable real Twilio drills cover callback-contract failure and queued-work recovery after worker absence.
- [ ] Add CI for clean install, lint, typecheck, tests, build, and safe migration validation; protect `main` with required checks/review. **Partial:** the workflow now performs a frozen install, dependency audit, checksum-aware migration validation/double application, a real disposable backup/restore drill, lint, typecheck, tests and builds; its first hosted run and required branch protection/review are external setup items.

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
- [ ] Secrets/keys managed with least privilege and rotation procedure. **Partial:** secret-family procedures, authenticated key-version envelopes, dual-read/new-write support, feedback-fingerprint key separation, resumable full re-encryption and local evidence exist; the managed store, named access policy and exercised production rotation evidence remain.
- [ ] Backups configured and restore-tested. **Partial:** the repository and CI execute a guarded local custom-format restore with schema/checksum/ciphertext evidence; managed encrypted PITR/backups, retention enforcement and an isolated production restore remain.
- [x] Bounded API/webhook requests, secure response headers, unsafe-origin enforcement, and hardened production session cookies implemented and tested.
- [x] Production API/worker configuration fails closed without durable storage, real providers, HTTPS origins, independent valid keys, and isolated listener ports.
- [ ] CI and dependency scanning required before merge. **Partial:** the repository workflow, Dependabot, high-severity audit gate and checksum-aware migration checks exist; hosted evidence and branch protection remain.
- [ ] PII-safe logs, error/health/uptime monitoring, provider/cost alerts. **Partial:** code-level logging/health/alert foundations are complete; deployment transport, monitoring, paging and upstream/invoice integration remain.
- [x] Sensitive text, credentials, sessions, OTPs, raw provider payloads excluded from generic logs/telemetry through bounded durable-event schemas and runtime logger serialization/redaction policy.
- [ ] Security/privacy risk and Swiss legal/privacy launch reviews complete.
- [ ] Disclosure and consent precede recording/model processing in production tests.
- [ ] Incident/abuse/complaint/outage/rollback/support procedures and owners ready. **Partial:** procedures and role owners are documented; named assignments and exercised drills remain.

## P1 — broad-beta requirement; invite-alpha waiver only

- [x] Durable jobs and recovery/dead-letter visibility.
- [x] Admin Calls and failure-stage filters.
- [x] Call Inspector timeline and sensitive-access audit.
- [x] Separate technical telemetry; `audit_events` remains action audit.
- [x] Structured outcomes and user feedback measurable.
- [x] Privacy-safe operational cohorts, first-audio/reliability signals, bounded cost estimates, and local system controls.
- [ ] Admin Users workflows. **Partial:** safe search, credit-ledger inspection, consolidated status/session/grant actions, and exhausted account-deletion recovery exist; calls, feedback, safety/complaints, and promo context remain.
- [x] Transactional promo codes and ledger grants.
- [ ] Account/data export/delete and session revocation tested. **Partial:** bounded session inventory, current/selective/all-session revocation, versioned full-data export, terminal-call deletion, and durable account-wide anonymization are owner-isolated, rate-limited, immutably evidenced and tested; production backup expiry and restore replay remain.
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
