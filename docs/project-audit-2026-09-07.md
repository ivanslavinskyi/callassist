# Project audit — 2026-09-07

> Historical baseline at `96229ea`. Subsequent changes close R01-R05/R18/R19 and
> repair the R06 runner; see [remediation evidence](remediation-2026-09-07.md) and the
> [current roadmap](mvp-plan.md). Findings and counts below preserve the original
> audit observations; they are not the current defect status.


Audited source: `96229ea8572929c557f8dba45bb51248c28e7b4e`.
Scope: all three packages, runtime entry points, 87 route registrations, contracts,
database catalog, repositories, auth/credits/privacy/voice/worker boundaries, web
routing/configuration, CI/dependencies, scripts and all existing Markdown documents.
Application source and lockfile were not changed by this audit; documentation and
the roadmap were updated. The pre-existing untracked attachment directory was left alone.

**Release assessment: NO-GO for unrestricted public beta.** The implemented MVP is
substantial and its local regression suite passes, but dependency, configuration,
key rotation, deletion, consent false positives, persistent-stream authorization and
live-drill gaps prevent treating it as release-ready.
This is a source/verification assessment, not evidence of a production compromise
or a legal determination. The [roadmap](mvp-plan.md) converts each finding into work.

## Verification

Machine-readable, minimized results: [audit evidence](audit-evidence-2026-09-07.json).
Probe inputs are synthetic. Counts represent this run, not a continuing monitoring claim.

| Check | Result | Evidence / practical limit |
| --- | --- | --- |
| Environment | Node 24.9.0, pnpm 10.12.4, Turbo 2.10.5, Windows | CI targets Node 22.19.0/Linux; that hosted environment was not run here |
| Tests | **503 passed, 0 skipped** in the database-enabled run | API 325/49 files; web 108/25 files; contracts 70/14 files |
| PostgreSQL coverage | All five DB suites executed | Calls, auth, content, limiter, account export; isolated disposable PostgreSQL 17 cluster |
| Lint | Passed, all three packages | API/contracts scripts run TypeScript; web runs ESLint |
| Typecheck | Passed after rebuilding stale Next types | Initial failure referenced a deleted generated route under `.next/types`; no source edit required |
| Build | Passed, all three packages | Next.js generated the current public/customer/admin routes |
| Public-copy check | Passed | Existing script scans branding/copy rules, not truthfulness of the privacy architecture |
| Migration catalog | 49 valid, latest `0049_imprint_content_page.sql` | Fresh apply and immediate replay succeeded in disposable DB |
| Recovery drill | Passed | Docker PostgreSQL 17.10; 51 tables/count comparisons, 49 checksummed migrations, seven critical tables, eight encrypted samples; tool removed its temporary restore resources |
| Dependency audit | **Failed: 8 high + 2 moderate entries** | Six distinct advisories across two fast-uri versions and qs; not ten distinct exploitable application defects |
| Targeted rotation probe | **Reproduced A03** | Success/remaining=0 while pending preparation still used old key ID |
| Targeted worker probe | **Reproduced A04** | Production worker validation accepted explicit mock compiler |
| Targeted deletion probe | **Reproduced A05** | `users.status=deleted` while one email and one phone challenge contact remained |
| Targeted consent probe | **Reproduced A12** | Three qualified refusals in EN/DE/RU returned `affirmative` |
| Authenticated HTTP stream probe | **Reproduced A13** | After revoke-all, fresh GET returned 401 but existing SSE received a new transcript delta |
| Turbo dry run | **Confirmed A02 configuration** | API test `envMode=strict`; empty configured env; null pass-through despite shell TEST_DATABASE_URL |
| Real providers/browser accessibility | Not executed | No PSTN/SMS/email/model requests, live-audio quality, password-manager, screen-reader or visual acceptance claim |

Full-test command used explicit disposable `DATABASE_URL`/`TEST_DATABASE_URL` and
`pnpm test --force --env-mode=loose`; `--force` bypassed Turbo cache. The initial
default run failed against unavailable local database configuration. Docker became
available during the audit; the populated test database was copied into an isolated
Docker container for the repository's actual backup/restore command. No application
database or user's Compose volume was used for these destructive fixture operations.

The recovery tool removed its own randomized restore database/archive. Cleanup of
the audit's outer container and native fixture directory was separately rejected by
automatic approval review (`blocked by policy`). Both audit servers were stopped;
container `callassist-audit-20260907` and the synthetic data under
`%TEMP%/callassist-audit-20260907/postgres` remain. The user's `callassist-postgres-1`
container was left running and healthy.

The first registry audit failed TLS chain validation on this machine. Retrying with
Node's system CA trust (`NODE_USE_SYSTEM_CA=1`) succeeded without disabling TLS
verification and returned the dependency findings below. A normal test/build pass
does not override a failed dependency gate.

## Findings

Finding priorities describe urgency of remediation: P1 is high priority, P2 is planned
hardening. Roadmap **P0** separately means mandatory before public-beta release.
All A01–A08 are mapped to mandatory release work R01–R08. A12/A13 map to mandatory
R18/R19 and should be addressed first because they affect consent and ongoing access.

### A01 — vulnerable locked production dependencies

**P1; registry-confirmed, application exploitability not established.**
[Lockfile](../pnpm-lock.yaml#L1832) contains `fast-uri@3.1.5`, `fast-uri@4.1.2`
and `qs@6.15.3`. `pnpm audit --prod --audit-level high` exits 1. Fast-uri is reached
through Fastify/validation dependency chains; qs also needs triage in its actual call sites.

| Advisory | Package entries | Registry severity | Remediation version |
| --- | --- | --- | --- |
| [GHSA-5jgf-p345-68v8](https://github.com/fastify/fast-uri/security/advisories/GHSA-5jgf-p345-68v8) | fast-uri 3.1.5 / 4.1.2 | High × 2 | 3.1.6 / 4.1.3 |
| [GHSA-f65p-4m7j-42xc](https://github.com/fastify/fast-uri/security/advisories/GHSA-f65p-4m7j-42xc) | fast-uri 3.1.5 / 4.1.2 | High × 2 | 3.1.6 / 4.1.3 |
| [GHSA-fph4-wmhf-6fwf](https://github.com/fastify/fast-uri/security/advisories/GHSA-fph4-wmhf-6fwf) | fast-uri 3.1.5 / 4.1.2 | High × 2 | 3.1.6 / 4.1.3 |
| [GHSA-jqff-g426-hqxp](https://github.com/fastify/fast-uri/security/advisories/GHSA-jqff-g426-hqxp) | fast-uri 3.1.5 / 4.1.2 | High × 2 | 3.1.6 / 4.1.3 |
| [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) | qs 6.15.3 | Moderate | 6.16.0 |
| [GHSA-4mjr-xmp4-gh2g](https://github.com/ljharb/qs/security/advisories/GHSA-4mjr-xmp4-gh2g) | qs 6.15.3 | Moderate | 6.16.0 |

The primary fast-uri advisory confirms affected versions and patched release lines;
the qs maintainer advisory confirms the affected range. Update the dependency graph
with a frozen-lockfile regression run; do not infer an exploitable SSRF from the
presence of a transitive package alone. **Next work: R01.**

### A02 — Turbo filters runtime and integration-test environment

**P1; configuration reproduced.** [turbo.json](../turbo.json) declares no `env`,
`passThroughEnv` or global equivalent. The dry run reports strict mode with an empty
API-test environment configuration even when `TEST_DATABASE_URL` is set in the shell.
[CI](../.github/workflows/ci.yml#L34) injects that variable, then calls `pnpm test`.
All five DB suites choose `describe.skip` when it is absent, for example the
[call repository suite](../apps/api/src/storage/postgres-call-repository.integration.test.ts#L23).

On a clean CI checkout without `.env`, test execution can therefore appear green
without PostgreSQL coverage. Locally the API env loader can mask the omission by
loading root `.env`. The same undeclared environment affects injected API/worker
development settings and private web SSR origin; `.env` is not an explicit cache
input. Tests are cacheable even though database state is external to source hashes.

Reproduce the configuration with a disposable TEST_DATABASE_URL and
`corepack pnpm exec turbo test --dry=json`; inspect API task env settings. The audit's
all-DB run used loose env and no cache. Declare variables/inputs per task, disable or
correctly constrain integration caching, and make CI fail on missing/skipped database
coverage. **Next work: R02.**

### A03 — preparation ciphertext is omitted from key rotation

**P1; reproduced against PostgreSQL.**
[Rotation inventory](../apps/api/src/db/reencrypt-data.ts#L20) and
[restore sampler](../apps/api/src/db/recovery-drill.ts#L33) enumerate eight encrypted
families. [Migration 0046](../apps/api/src/db/migrations/0046_call_preparation_requests.sql)
added encrypted preparation input; neither tool includes it.

Probe: create a queued preparation encrypted under `audit-old`; rotate with a new
active key while retaining the old key for reads; inspect only the remaining envelope
key ID. The command returned `data_encryption_reencryption_succeeded`, reported zero
remaining non-active ciphertexts, while the preparation still had `audit-old`.
Retiring that key makes pending input unreadable and can fail durable compilation.
The successful recovery drill also checks only eight encrypted samples, so it does
not detect this omission.

Extend both tools and seed pending preparation in rotation/restore regression
fixtures. Preserve the old key until complete-family verification proves retirement
safe. The runbook now states this hold explicitly. **Next work: R03.**

### A04 — production worker permits mock compilation

**P1; reproduced without a provider request.**
[Production validation](../apps/api/src/config/runtime-environment.ts#L45) places the
compiler-driver requirement inside `runtime === "api"`. The
[worker](../apps/api/src/worker.ts) now creates the compiler and processes preparation
jobs. [Compiler factory](../apps/api/src/brief-compiler/create-brief-compiler.ts)
returns `DeterministicBriefCompiler` for an explicit `mock` even in production.

A production-shaped environment with valid structural settings and
`BRIEF_COMPILER_DRIVER=mock` passed worker validation and selected that class.
This permits production preparations to bypass the configured OpenAI
moderation/compilation path. Require the compiler driver on every process that
executes compilation and test the API/worker matrix. **Next work: R04.**

### A05 — account deletion leaves replacement contacts behind

**P1; reproduced against PostgreSQL.**
[Finalization](../apps/api/src/auth/postgres-auth-repository.ts#L743) tombstones the
user and revokes sessions, but does not delete the temporary contact-change records.
[Phone challenges](../apps/api/src/db/migrations/0044_verified_phone_changes.sql)
store `new_phone_e164`; [email challenges](../apps/api/src/db/migrations/0048_account_profile_changes.sql)
store `new_email`. Both are plaintext and linked to the user/session.

Probe: create a verified synthetic user/session, one phone-change and one email-change
challenge; request, lease and finalize deletion. The final status was `deleted`,
yet one non-null phone and one non-null email contact remained. The repository's
30-day purge occurs only on a subsequent challenge creation, so inactivity can retain
these values beyond that period. Revoked access prevents using a challenge; it does
not erase its personal data.

Add deletion-time cleanup and scheduled bounded retention; test pending, completed,
expired and concurrent challenge cases. Keep minimized immutable security events
without retaining challenge PII. **Next work: R05.**

### A06 — real-provider drill no longer matches the application

**P1; source-confirmed, no calls placed.**
[Runner](../apps/api/scripts/run-real-call-drill.mjs#L74) posts to
`/api/call-briefs` expecting `201`. The current
[creation route](../apps/api/src/app.ts#L1929) is `/api/call-preparations`, returns `202`
and requires a UUID idempotency key. The old POST registration is absent.

The previous outage procedure stopped the worker before preparation; that now stalls
compilation. The runner also generates a random CH account phone and sends it to
registration. With real Verify, this could send SMS to a number whose owner did not
authorize the test; the runner lacks a verification-driver guard.

Repair enqueue/poll/snapshot loading, add a prepared-before-dialling outage pause and
safe identity configuration. Test the runner against a non-billable harness before
authorized live use. August call evidence is retained as historical, not current
release proof. **Next work: R06.**

### A07 — public notice and acceptance semantics need alignment

**P1; implementation/copy mismatch, not a legal conclusion.**
[Bridge](../apps/api/src/realtime/openai-realtime-bridge.ts#L682) recognizes speech
in an isolated OpenAI session before consent. Earlier architecture/README claims
of no recipient processing before consent were inaccurate and are corrected here.
The public [Privacy seed](../apps/api/src/content/seed-content.ts#L64) describes
consent before conversation processing without clearly explaining this recognition
exception. Its provider list names Twilio/OpenAI while account email uses Resend.
The [spoken prompt](../apps/api/src/telephony/twilio-copy.ts) asks about
recording/transcription but does not speak the selected retention duration.

[Onboarding](../apps/web/components/onboarding-form.tsx#L29) now has one legal
checkbox and sets four legacy acknowledgment booleans to true programmatically.
They must not be interpreted as four separately captured user choices. The updated
architecture and roadmap describe this distinction.

Review public/spoken copy against the actual processing and provider flow, publish
new immutable revisions through the supported workflow, and obtain the required
independent privacy review. Do not rewrite historical migrations/publications to
make old evidence appear different. **Next work: R07.**

### A08 — live disclosure controls still depend on prompts

**P1; known architectural gap confirmed in source.**
The [Realtime session configuration and event handler](../apps/api/src/realtime/openai-realtime-bridge.ts)
contain audio/transcription events and instructions, but no registered model
`request_approval`/`end_call` tools or corresponding function-call dispatcher.
[CallService](../apps/api/src/call-service.ts) and UI expose approval operations,
including deterministic mock demonstrations. Their existence does not make a real
model utterance wait for a server-owned sensitive-disclosure decision.

Recipient-audio consent gating is deterministic; subsequent model compliance with
fact/disclosure instructions is a different boundary. Implement the actual tool/action
gate with reject/expiry/adversarial tests, or constrain the release scope to a
separately reviewed enforceable boundary. **Next work: R08.**

### A09 — deployment topology is not encoded or verified

**P2; deployment constraint, no deployed failure asserted.**
[API cookies](../apps/api/src/app.ts#L2376) are host-only, while
[SSR](../apps/web/lib/server-auth.ts) only forwards cookies received by the web host.
Placing browser API on a different hostname means the web server does not receive its
session cookie. CORS and `INTERNAL_API_URL` alone cannot bridge that gap. The
[Twilio listener](../apps/api/src/index.ts) binds loopback, so it also needs an
explicit same-network/process ingress design. `trustProxy` is not configured; behind
an edge proxy, per-IP limits see the connection peer unless deliberately addressed.

README/runtime reference now specify a same-host browser API and private SSR routing.
Production manifests, TLS/origin configuration, proxy trust, WAF and deployed probes
remain R09/R12. No Dockerfile or production web/API/worker Compose service is present.

### A10 — test presence overstates browser and release evidence

**P2; verification gap.** The web suite uses unit/SSR/static-source checks, including
[account form semantics](../apps/web/lib/account-form-semantics.test.ts); the repository
does not contain a committed browser E2E harness. These checks cannot establish
real autofill, screen-reader, focus, multi-device rendering or live-provider quality.
The old roadmap mixed historical browser statements/test counts with current status.
Those claims now remain explicitly dated and current verification is centralized here.

Add browser-level coverage and the accepted visual/accessibility matrix (R13), plus
a versioned multilingual/audio/safety corpus with thresholds (R14). Hosted CI,
branch protections, domain/TLS, provider settings and actual monitor ownership were
not inspected during this local audit and are not marked complete. Dependencies were
already installed; a fresh frozen installation was not repeated on this host.

### A11 — large shared modules increase change risk

**P2; maintainability observation, not a functional defect.**
The call PostgreSQL repository is 6,044 lines, its memory counterpart 3,227,
`app.ts` 2,931 and the Realtime bridge 1,022 at the audited commit. Several unrelated
domains share transactions/entry points. Duplication makes it easy to omit a new
data family from maintenance tools, as A03 illustrates.

During R03/R05/R16/R17, centralize lifecycle/encryption inventories and extract bounded
domain interfaces where those changes require it. Preserve transaction boundaries and
memory/PostgreSQL parity. A general rewrite is not justified by file size alone.

### A12 — qualified refusals can be classified as consent

**P1; deterministic multilingual probe reproduced.**
[Classifier](../apps/api/src/realtime/consent-classifier.ts#L34) grants affirmation
when text equals or starts with an allowed phrase, provided none of its limited
negative phrases match. This is insufficient to distinguish a clear grant from a
qualification/refusal after “yes”. Three synthetic inputs returned `affirmative`:

| Locale | Input | Observed result |
| --- | --- | --- |
| en-GB | Yes, but I don't agree to recording | affirmative |
| de-CH | Ja, aber ohne Aufnahme | affirmative |
| ru-RU | Да, но запись запрещаю | affirmative |

The bridge passes this decision to `ConsentFlow`, whose `grant_voice` action starts
the consent/recording path. No ASR uncertainty is needed to reproduce the defect:
the exact recognized text already yields the wrong classification. Require a
conservative complete-utterance decision, route qualifications to clarification or
refusal, and test negation/conditions/quoted speech across all supported locales.
Assert at bridge level that rejected/unclear examples never start recording.
**Next work: R18, before public consent-flow use.**

### A13 — revoking sessions does not revoke existing SSE subscriptions

**P1; reproduced with a real local HTTP stream and mock fixtures.**
[SSE route](../apps/api/src/app.ts#L2317) authenticates once, then subscribes a `send`
callback. Neither that callback nor its heartbeat checks session validity again;
cleanup only follows socket close/error. Revocation blocks future requests but does
not end an established private-data stream.

Probe: create a synthetic owner and valid session; subscribe to the owned call's
events over HTTP; revoke all sessions; issue a fresh snapshot GET and publish a new
synthetic recipient delta. The GET returned `401`, while the existing stream still
received `AFTER_REVOCATION_FIXTURE`. This defeats the expectation that forced logout
or password/session recovery cuts off an already-connected client from future speech.

Add bounded revalidation or cross-instance revocation-driven stream teardown. Cover
expiry, selective/all-session revoke, reset and suspension; stop emitting private
events before closing the stream. **Next work: R19.**

## Documentation reconciliation

| Previous claim or drift | Corrected description |
| --- | --- |
| Public beta already established | Implemented supervised MVP; release readiness/evidence open |
| Two assistance reasons | `none` default plus two optional disclosures |
| Whole-recording ASR + live-role alignment is normal | Channel-utterance ASR; full-file plain fallback; live draft ignored |
| No OpenAI recipient processing before consent / DTMF only | Isolated pre-consent speech recognition, voice-first flow and fallback-only DTMF |
| Consent recognition socket speaks the introduction | Main audio socket speaks; separate socket recognizes |
| All private data / all ciphertext families covered | Explicit plaintext/encrypted map; ninth-family maintenance gap |
| All account contact data anonymized | Primary user tombstoned; contact challenge cleanup still open |
| Old-email notice on successful completion | Old-address notice is sent during challenge start with new-address verification; either failure invalidates challenge |
| Localized admin / admin migration pending | Implemented English-only `/admin`, bilingual editorial data |
| UI preference wholly future / i18n package undecided | Typed custom catalogues/cookie routing implemented; registration locale stored; preference update UI deferred |
| Four independent onboarding acknowledgments | One checkbox; four legacy compatibility booleans |
| Always local PostgreSQL 55432 | Example selects 56432; Compose fallback is 55432; existing env can differ |
| Real-call runner and stopped-worker ordering ready | Runner incompatible with async API; manual procedure and repair gate |
| CI and all checks green | Local suite/build pass with explicit DB env; CI env defect and failing dependency audit |
| Ambiguous consent fails closed / revocation ends access | Prefix-classifier false positives and existing SSE revocation gap now explicit |
| 6F7 is necessarily next | R01–R08 first, then deployment evidence; step-up remains R15 |

Added a documentation index and source-derived 87-route/configuration reference.
Updated the detailed plans/runbooks with current status and explicit gaps. Removed
duplicated completed backlog items from the active roadmap; prior checkpoint history
remains available in Git. All remaining backlog areas are retained as prioritized
acceptance criteria or explicit P2 deferrals.

## Limits and follow-through

No source change, dependency upgrade, application-database migration, publication, deploy, merge, real
call or external message was made as part of the documentation audit. Findings are
open until implemented and re-verified. The audit inspected repository behavior and
ran meaningful local checks; it is not a penetration test, exhaustive proof of every
race, professional legal review, or a review of inaccessible production state.

Follow [R18/R19 and R01–R08](mvp-plan.md#milestone-1--repository-release-blockers) first. Preserve
current-commit evidence after fixes, then close production ownership/operations and
privacy gates before expanding beyond supervised use.
