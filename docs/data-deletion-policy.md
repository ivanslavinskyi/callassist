# Data deletion and account anonymization policy

Status: implemented application baseline through checkpoint 6F3b. This document is a technical lifecycle policy, not a substitute for the final Swiss legal/privacy review or production backup evidence.

Updated 2026-09-09 for text artifacts, language context and review receipts. R05 removes email/phone-change
challenge contacts in the same transaction as account anonymization, under the user
lock. The deletion worker also purges challenges older than 30 days and legacy
deleted-user challenges on startup and hourly, even without new user traffic.

## Principles

1. A deletion action removes or irreversibly redacts user-provided personal content. It does not rewrite immutable financial, consent, safety, or access evidence.
2. Provider audio is deleted before local call content is redacted. A provider failure leaves the local content available for a safe retry and never produces a false success response.
3. Owner requests are idempotent. A completed operation retains only a random request identifier, actor/call references, provider disposition, and time.
4. Active calls cannot be deleted. Background work is fenced or cancelled before content redaction so a stale worker cannot recreate a transcript.
5. Global recipient suppressions survive caller account deletion. Removing them could allow a new account to call a recipient who already opted out.
6. Deleted content is excluded from owner, export, playback, SSE, and sensitive-admin read boundaries. Technical aggregates may continue to count the retained non-content shell.

## Record-by-record lifecycle

| Record family | Call-data deletion | Account deletion/anonymization | Reason |
| --- | --- | --- | --- |
| User email, phone, first/last name, password, login time | Unchanged | Replace with unique tombstones; invalidate credential and verification; mark `deleted` | Remove account identity while preserving foreign-key continuity |
| Sessions | Unchanged | Revoke all immediately after successful anonymization | Prevent future access |
| Email/phone-change challenges | Unchanged | Delete all states atomically with anonymization | Independent startup/hourly worker cleanup after 30 days; contact-free immutable security events remain |
| Password recovery challenges/grants | Unchanged | Capabilities fail eligibility after deletion, but rows are retained | Expiry is not erasure; scheduled retention remains R17 |
| Pending call preparations | Unchanged | Cancel queued/running work and erase encrypted source input before publication | Prevent creation of new calls after deletion request |
| Call brief recipient/person/objective/context/facts/compilation/disability or language-assistance text | Redact; hide call from owner reads | Redact every owned call | User-provided personal content |
| Realtime and final transcript text/segments | Delete or null | Delete or null for every owned call | Conversation content |
| Immutable final transcript revisions | Null encrypted payloads; retain source identity/hash and minimized references | Same for every owned call | Historical source text is personal content too |
| Plan/clarification translations, transcript translations, summaries and persisted chunks | Cancel jobs and null all encrypted payloads | Cancel at request time; redact with each call | No late worker result may recreate content |
| Plan review receipts | Null encrypted evidence; retain immutable revision/hash/language references | Same for every owned call | Preserve minimized approval linkage without retained review content |
| Preparation/call language contexts | Delete affected contexts | Delete owned contexts and reset account preferences during anonymization | User-specific selection and detection metadata |
| Approval title/reason/proposed speech | Delete | Delete for every owned call | May contain sensitive proposed disclosures |
| Feedback comment | Null only; retain categorical scores | Null only; retain categorical scores | Remove free text while preserving product-quality evidence |
| Provider recording | Delete at Twilio first; treat provider 404 as already absent | Delete all owned recordings before final account anonymization | Audio is the most sensitive provider-held artifact |
| Provider call/recording identifiers and failure free text | Null after provider deletion | Null for every owned call | No longer needed for normal operation |
| Credit ledger, promo redemption, signup/admin grants | Retain immutable, minimized rows | Retain with tombstoned user reference | Reconciliation and abuse/financial evidence |
| Onboarding Terms/AUP acceptance | Retain immutable revision IDs, booleans, locale and time | Retain with tombstoned user reference | Proof of accepted legal revision |
| Consent and technical call events | Retain bounded allow-listed metadata and time | Retain with tombstoned user/call shell | Consent, safety and operational evidence |
| Call outcome and categorical feedback revisions | Retain; remove feedback free text | Retain; remove feedback free text | Aggregate quality evidence without conversation content |
| Audit, staff access, session/export/deletion evidence | Retain immutable minimized fields | Retain with tombstoned user reference | Accountability and incident investigation |
| Recipient suppressions and safety events | Retain independently of caller | Retain independently of caller | Opt-out and safety continuity |
| Durable job attempts | Cancel content-producing work and retain minimized attempt history | Cancel all owned content-producing work and retain history | Failure recovery and stale-worker fencing |
| Backups | No in-place mutation | No in-place mutation | Deleted data expires with the documented encrypted-backup lifecycle; a restore must replay deletion tombstones before service return |

## Call-data deletion flow

Only a terminal, owner-visible call is eligible. The request requires the current password, the exact `DELETE` phrase, and a client-generated UUID. The server checks origin, session, ownership, rate limit, and password. It then deletes any provider recording, atomically redacts local private content, cancels outstanding work for that call, and appends immutable minimized evidence. A repeated request with the same UUID returns the original completion time; a different user or UUID receives the same not-found boundary as any inaccessible call.

## Account deletion flow (implemented in 6F3b)

Account-wide deletion reuses the provider-first call primitive through a durable leased request with owner-visible `queued`, `processing`, `waiting_for_calls`, `retrying`, `needs_support`, and terminal `completed` states. Creation requires an active owner session, current-password step-up, the exact `DELETE MY ACCOUNT` phrase, a client UUID, an allowed origin, and a per-user/IP limit. An existing request is returned idempotently instead of creating competing jobs.

While a request is open, browser call mutations are rejected with `ACCOUNT_DELETION_PENDING`. A dialing, connected, or approval-paused call changes the request to `waiting_for_calls` without consuming its bounded provider-failure budget. Inactive pre-call drafts are safely stopped, and terminal calls are processed in bounded batches through the 6F3a provider-first primitive. Provider failures use exponential backoff and immutable attempt evidence; the fifth failed attempt enters `needs_support`. Admin or superadmin recovery requires an operational reason, creates a new retry generation, and does not restore content already removed by an earlier attempt.

Text generation is cancelled immediately when account deletion is requested, including
while deletion waits for an active call. Enqueue, retry, provider reservation and result
publication lock/check the owner and pending deletion state, then validate the current
source and durable lease. Reads needed by the deletion workflow remain available until
call redaction. Late provider responses may finish bounded usage accounting but cannot
restore artifact or chunk payloads. Removing audio on its retention deadline is separate:
it does not delete retained original text, translations or summaries.

Only after no visible owned call remains does finalization tombstone the primary user
email, phone, first/last name and password, clear verification/last-login time, mark
the user `deleted`, revoke sessions and record completion atomically. PostgreSQL
rejects finalization if an undeleted call raced into the account. Global recipient
suppressions are never selected or mutated. The current finalization transaction
removes secondary email/phone challenge contacts and resets language preferences.
Immutable minimized evidence and backup retention remain separate from primary-store
content erasure.

## Backups and support

Deletion removes data from the live primary store and configured providers. Encrypted backups are not rewritten in place and must expire according to the production backup schedule. Any restored backup must be isolated, replay deletion evidence held outside that backup, pass verification, and only then be eligible to serve traffic. Migration 0041 and the application worker do not by themselves satisfy this cross-backup requirement. The production retention duration, independently retained deletion journal, named controller/support owner, response SLA, and exercised restore-and-replay evidence remain launch gates.

## Swiss privacy references

- FDPIC, [Knowing and asserting my rights](https://www.edoeb.admin.ch/en/knowing-and-asserting-my-rights): deletion rights and lawful/overriding-interest limits.
- FDPIC, [Frequently asked questions about data protection](https://www.edoeb.admin.ch/en/faq-data-protection): retention must be defined by data category, purpose and proportionality rather than one universal FADP period.
- FDPIC, [Duty to provide information](https://www.edoeb.admin.ch/en/duty-to-provide-information): transparent notice should describe processing duration or the criteria used to determine it.
