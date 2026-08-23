# Password and account recovery policy

Status: implemented application baseline in checkpoint 6F4. This flow restores access only when the account still controls its previously verified phone number; phone-number replacement and support-assisted identity recovery are deliberately outside this boundary.

## Security invariants

1. The start endpoint always returns `202`, `verification_required`, and a fresh random recovery UUID for every syntactically valid email. It does not reveal whether the email exists, whether the account is verified, suspended, deleted, or waiting for deletion.
2. Only an active account with a verified phone and no pending account-deletion request receives an SMS and a durable challenge. A provider-send failure invalidates the challenge and emits only a PII-free operational event; the public response remains generic.
3. The recovery UUID is a random capability, expires after 10 minutes, and permits at most eight durable verification attempts. Creating a newer challenge invalidates older unverified challenges for that account.
4. Successful SMS verification produces a separate 32-byte random grant. Only its SHA-256 digest is stored. The grant expires after 15 minutes, can be consumed once, and is never placed in a URL, cookie, log, browser storage, or immutable event.
5. Completion hashes the new password with the existing `scrypt-v1` policy. In one PostgreSQL transaction it replaces the password, clears the last-login marker, revokes every active session, consumes the grant, and appends minimized immutable evidence containing only user/challenge IDs, revoked-session count, and time.
6. Login session creation locks the same user row and must match the password hash that was verified. A login that checked the old password before a concurrent recovery cannot create a session after the reset transaction.
7. Recovery does not sign the user in. A successful user must authenticate again with the new password.

## Abuse boundaries

The shared limiter stores only keyed HMAC-SHA-256 identifier digests in bounded PostgreSQL buckets when the API uses PostgreSQL. Current defaults are:

| Action | Boundary | Limit |
| --- | --- | --- |
| Start | IP | 10 per hour |
| Start | normalized email | 3 per hour |
| SMS send | verified phone | 3 per hour; denial remains generic |
| Verify | IP | 20 per 15 minutes |
| Verify | recovery UUID | 8 per 15 minutes, in addition to the durable eight-attempt cap |
| Complete | IP | 10 per 15 minutes |
| Complete | recovery-token digest | 3 per 15 minutes |

The durable challenge counter and the broader IP/email/phone/token budgets survive a process restart and are shared by every PostgreSQL-backed API instance. Provider limits remain defense in depth rather than the primary policy. Single-process development may use the bounded in-memory implementation, which is explicitly not a horizontal-scaling mode.

## Public and operational behavior

- Invalid, expired, already-used, suspended, deleted, deletion-pending, or provider-failed recovery capabilities return the same `INVALID_RECOVERY` result after the generic start step.
- Validation failures describe malformed request structure only. They do not describe account eligibility.
- The localized EN/DE page keeps the recovery UUID and grant only in React memory. Reloading or navigating away intentionally discards them and requires a fresh start.
- Raw email, phone, OTP, new password, recovery UUID, grant, and token digest are absent from immutable recovery evidence. Standard request logging records the route template rather than the raw URL or body.
- Equal response structure and error codes prevent direct account-state disclosure. If the limiter is unavailable, an eligibility-sensitive recovery start stays generic but suppresses SMS; explicit recovery actions fail closed. SMS-provider latency is not a formal constant-time boundary, so queued delivery or response padding should still be evaluated before public scale.

## Remaining boundaries

- WAF/infrastructure limits, mass-account correlation, production monitoring thresholds, and external alert routing remain deployment work. The shared application-store policy is documented in `docs/rate-limit-policy.md`.
- Changing a verified phone number requires a separate re-verification design. A user who lost both password and verified-phone control needs a separately reviewed support/identity-proofing policy; staff cannot bypass this recovery grant today.
- Expired unused challenge/grant retention and cleanup must be included in the final production retention schedule. Recovery events are intentionally immutable security evidence and follow that schedule rather than containing recoverable credentials.
