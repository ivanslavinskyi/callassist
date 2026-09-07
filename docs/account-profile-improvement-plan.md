# Account profile improvement plan

Status: core implementation complete; final multi-browser/device acceptance remains.

Reviewed 2026-09-07 against `96229ea`. The dated checkpoint counts below are historical;
the [current audit](project-audit-2026-09-07.md) ran 503 automated tests. These tests
do not prove real password-manager or screen-reader behavior. R05 contact-challenge
erasure/cleanup is now implemented; see [remediation](remediation-2026-09-07.md).
R13 browser acceptance and R15 durable notifications remain open.

## Goals

- Prevent password managers from placing the account email in the replacement-phone field.
- Let an authenticated account owner update first and last name.
- Let an authenticated account owner replace the login email only after recent password proof and verification of the proposed address.
- Make verified-phone replacement understandable, recoverable, accessible, and consistent across browsers.
- Reorganize the Account surface around Profile, Security, Usage, and Data & privacy without weakening the existing deletion, session, recovery, or audit boundaries.

## Delivery order

1. Correct form semantics (`id`, `name`, `autocomplete`, field-level errors) and add a regression test for credential autofill.
2. Add owner-scoped name-update contracts, API, repository operations, UI, and memory/PostgreSQL tests.
3. Add a pending email-change challenge with current-password proof, time-limited single-use verification, rate limits, old-address notification, atomic completion, recovery-capability invalidation, minimized immutable evidence, and UI tests.
4. Improve phone entry and OTP states: normalized human input, masked destination, expiry/resend guidance, edit/cancel actions, and specific safe error messages.
5. Rework the Account information architecture and responsive layout; remove duplicate session actions and nested mobile scrolling.
6. Verify EN/DE, keyboard and screen-reader behavior, light/dark themes, and 320/390/768/1280 px layouts.

## Implementation checkpoint (2026-09-02)

- Completed form semantics, owner name editing, verified email replacement, safer phone entry, field-specific feedback, and EN/DE copy.
- Added atomic in-memory/PostgreSQL operations, minimized email-change evidence, delivery-provider configuration, production fail-closed validation, API/client coverage, and migration `0048_account_profile_changes.sql`.
- Reworked the page into compact Profile, Usage, Data & privacy, and Security sections; removed duplicate session actions and nested mobile ledger scrolling.
- Verified TypeScript, ESLint, package builds, migration catalogue, 70 contract tests, 52 focused API/PostgreSQL tests, and 105 web tests. Browser automation covered the 390 px and 1280 px layouts and the live form semantics.
- Remaining release gate: hands-on autofill checks in Chrome, Edge, Safari, and Firefox plus the complete light/dark and 320/768 px visual matrix.

## Current operational limits

Email-change codes are HMAC-hashed and challenge records contain the proposed email
in plaintext until cleanup. Both email/phone challenge tables currently purge old
rows only when a new challenge is created; account anonymization does not erase them.
This is an open lifecycle defect, not completed anonymization. Verification mail to
the new address and a notice to the old address are sent concurrently during challenge
creation. Either delivery failure invalidates the challenge and returns
`EMAIL_DELIVERY_UNAVAILABLE`. There is no durable retry/outbox or separate completion
notification. See audit A05 and roadmap R15.

## Acceptance criteria

- Saved usernames never appear in the replacement-phone inputs in Chrome, Edge, Safari, or Firefox.
- Name changes persist after reload and appear in owner, admin, and data-export read models.
- The old email remains the login identity until the proposed address is verified; expired, replayed, foreign-session, occupied-address, and concurrent challenges cannot mutate the account.
- Email and phone security changes invalidate the intended recovery capabilities and sessions and retain no credential, OTP, raw token, old/new contact value, or provider payload in immutable evidence.
- Every field error is textual and associated with its control; asynchronous success, error, and progress messages are programmatically announced.
- The Account UI has no horizontal overflow or nested scrolling at the supported breakpoints, and destructive controls remain visually separated from routine profile actions.
- Contracts, API routes, service policy, in-memory repository, PostgreSQL repository, API client, localized UI, and regression tests are delivered together for each capability.

## Security dependency

Email replacement is not a direct profile `UPDATE`. Production enablement requires a configured email-delivery provider. Development and tests may use an explicit mock provider; production must fail closed when only the mock provider is configured.
