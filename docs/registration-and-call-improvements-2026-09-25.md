# Approved implementation plan — 2026-09-25

Branch: `feat/gpt-live-pilot`. Approved by the owner in this task.
Merge to main and production deployment require the owner's approval after local testing.
Keep `VOICE_RUNTIME_DRIVER=realtime` as the production default.

## Scope and acceptance criteria

- [x] Independent administrative policies: full/registration onboarding and required/deferrable email verification. Preserve existing defaults, revision checks and audit history.
- [x] Registration-mode onboarding: unchecked required agreement, links and recorded versions of Terms, Acceptable Use and Privacy; atomic account and acceptance creation; SMS only after commit. Existing acceptances remain immutable.
- [x] After SMS always show email verification for an unverified address. When allowed, show “Confirm later” before and after sending a code. Remember deferral for the current address, without marking it verified. Reset on address change; required policy overrides deferral. Full onboarding still follows email confirmation/deferral when necessary.
- [x] Shared country-aware phone input and strict server validation before account creation/SMS. CH and UA national/international/00/bare country-code/trunk-prefix variants normalize to E.164. Country is independent of UI locale. Canonical identities share verification/rate limits. Preserve separate SMS and outbound-country policies.
- [x] Retry a definitively unanswered call from its page: create an idempotent linked draft using the existing validated compilation, then show the existing review screen. No compiler/provider spending on unchanged retry. Fresh review approval and execution snapshot; no copied runtime consent, action decisions, results, recordings, feedback or usage. Reject ambiguous provider states; allow expired appointment drafts to be corrected, but reject their start. Enforce current admission policy at start.
- [x] Visible New call / History links on the call page, including narrow screens; navigation does not stop calls.
- [x] History/recent calls show a two-line objective in the input language. Generate display objective within the existing compilation request; use stored matching translation or original input for legacy records. Never generate on listing or mutate historical compilation hashes.
- [x] Feedback has explicit read-only saved state, Edit, Save changes and Cancel; preserve revision/idempotency/privacy behavior and drafts on errors.
- [x] Every new/changed customer and administrative string, error, accessible label and route supports DE/FR/IT/RM/EN/RU/UK through existing localization infrastructure. Keep UI, input, voice and phone-country preferences independent.

## Implementation sequence

1. Registration policies, document acceptance, email deferral and routing.
2. Shared phone parsing/input.
3. Linked retry drafts, compilation reuse and review safety.
4. History objective and mobile navigation.
5. Feedback state and complete localization.

Use additive migrations only where durable state requires them. Preserve historical data and encrypted content handling. No merge, production configuration changes or deployment in this implementation phase.

## Verification

- Contracts and memory/PostgreSQL integration: four registration-policy combinations, stale documents/settings, verification failures, deferral/relogin/address changes, server enforcement.
- Phone fixtures: equivalent CH/UA prefixes, invalid/ambiguous inputs, canonical identity limits and independent country policies.
- Retry: no compiler call, double click/concurrent requests, source ownership/deletion, late callbacks, provider uncertainty, appointment expiry, fresh consent/approval, admission/billing for both runtimes.
- Display: seven locales, independent input/call/UI languages, legacy/redacted data, no list-time LLM calls, mobile widths from 320px.
- Feedback: save/reload/edit/cancel/network retry and privacy redaction.
- Full test, lint, typecheck, build and copy checks; isolated PostgreSQL database; local browser validation. Record actual outcomes here before owner testing.

## Implementation and verification log

Implemented on the existing pilot branch. Additive migrations 0082 and 0083; no new
production feature env defaults. Two independent policies live in the existing
revisioned beta settings JSON. General settings updates preserve registration policy.

The retry draft has a new call ID and source-attempt uniqueness, reuses immutable
compilation data and ready translations, and obtains a new review receipt before
starting. Choosing an unavailable translation explicitly may generate one; opening
the reused plan and saving an unchanged task do not call the compiler. Deleting one
call retains the separately created retry; deleting the account follows existing
account-wide erasure. Provider expense records stay on their original operations.

Browser QA found and fixed an obsolete mandatory-email banner and a Romansh
country-name hydration mismatch between Node ICU and Chromium. The phone selector
uses localized CH/UA labels and initializes additional country names after hydration.

Final review also found a callback/accounting deadlock in the existing hangup
recovery path. Accounting used attempt → brief-FK lock order, while callbacks used
brief → attempt. Provider operation/session/usage/cost writes now take a brief lock
first. Three deterministic PostgreSQL tests reproduce the conflicting lock schedule
and verify it completes without deadlock. No external operation is retried to hide
the failure, and usage idempotency remains unchanged.

Security/privacy review: ownership and active-user checks protect retries; stale
documents roll back account admission and acceptance together; email policy is
rechecked under the same admission lock as credit reservation. Email deferral is
not verification. Existing encrypted compilation/artifact storage, redaction and
immutable approvals remain in use. History adds no LLM requests. New retry attempts
still use current recipient, concurrency, credit and spending admission controls.

### Repeatable local browser check

Requires dependencies installed, a local `TEST_DATABASE_URL` accepted by the test
database guard, a database role with CREATEDB, and Playwright/Chromium. The script
creates and drops its own database and starts API/web only on loopback. Providers
are explicitly test implementations: no Twilio calls/SMS, email or OpenAI requests.

```sh
node --import ./apps/api/node_modules/tsx/dist/loader.mjs scripts/registration-call-browser-smoke.mts
```

If Playwright is installed outside the workspace, set `PLAYWRIGHT_MODULE_PATH` to
its absolute `index.mjs` (Playwright or playwright-core). An existing compatible
Chromium executable can be selected with `CHROMIUM_EXECUTABLE_PATH`. Optional
`SMOKE_API_PORT`/`SMOKE_WEB_PORT` default to 4311/3311. Run separately from the full
suite to avoid starving timed integration tests. Screenshots and Next output are
written under ignored `.tools/registration-smoke/`.

Passed browser scenarios: seven registration locales at 320/390px, three document
links and unchecked agreement, CH prefix normalization, SMS → email screen, deferral
after sending a code, relogin with unverified email, feedback save/reload/edit/cancel,
lost-response retry with the same feedback idempotency key and preserved draft,
repeat → fresh review, unchanged edit without recompilation, top navigation and
source-language history objective. No browser runtime/hydration errors remain.

Final local checks: **1,591 tests passed across 191 files** (API 1,182; web 281;
contracts 128), full lint, typecheck and production build passed. Public copy check
passed across 811 files. The final browser smoke also passed and removed its temporary
database and servers. Test migrations ran only on isolated local databases;
historical migration checksums were preserved. The two new beta-policy integration
tests use a 30-second deadline, matching other migration-heavy fixtures in that file.
Owner acceptance, merge and production deployment remain pending.

Manual UI feedback, 25 September: restored the original single phone field on
call creation/editing, with the existing localized validity hint. The country
selector and canonical-number preview belong to account phone flows; outbound
calls still have the fixed CH boundary. Shared normalization remains active on blur
and submission, including national and international prefix variants. Web tests
(281), lint and typecheck passed after this layout correction.
