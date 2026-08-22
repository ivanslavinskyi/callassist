# Data deletion and account anonymization policy

Status: implementation baseline for checkpoint 6F3. This document is a technical lifecycle policy, not a substitute for the final Swiss legal/privacy review.

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
| Call brief recipient/person/objective/context/facts/compilation/disability or language-assistance text | Redact; hide call from owner reads | Redact every owned call | User-provided personal content |
| Realtime and final transcript text/segments | Delete or null | Delete or null for every owned call | Conversation content |
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

## Account deletion flow (next 6F3 slice)

Account-wide deletion will reuse the provider-first call primitive through a durable, leased request with `queued`, `running`, `succeeded`, and `needs_support` public states. The account remains accessible while a provider failure is retryable; successful finalization atomically tombstones identity and revokes sessions. An in-flight call delays execution rather than being silently interrupted. Exhausted provider retries enter support escalation with PII-safe error codes only.

## Backups and support

Deletion removes data from the live primary store and configured providers. Encrypted backups are not rewritten in place and must expire according to the production backup schedule. Any restored backup must be isolated, replay all deletion evidence created after the backup, pass verification, and only then be eligible to serve traffic. The production retention duration, named controller/support owner, response SLA, and exercised restore-and-replay evidence remain launch gates.

## Swiss privacy references

- FDPIC, [Knowing and asserting my rights](https://www.edoeb.admin.ch/en/knowing-and-asserting-my-rights): deletion rights and lawful/overriding-interest limits.
- FDPIC, [Frequently asked questions about data protection](https://www.edoeb.admin.ch/en/faq-data-protection): retention must be defined by data category, purpose and proportionality rather than one universal FADP period.
- FDPIC, [Duty to provide information](https://www.edoeb.admin.ch/en/duty-to-provide-information): transparent notice should describe processing duration or the criteria used to determine it.
