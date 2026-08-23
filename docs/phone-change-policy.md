# Verified phone-number change policy

Status: implemented repository baseline in checkpoint 6F6. This is a
self-service flow for an active, signed-in user who still knows the current password
and controls the replacement phone. It is not a support override for loss of both
password and verified-phone access.

## Security invariants

1. Both endpoints require an allowed browser origin and an active verified account
   session. The challenge is bound to the initiating user and exact session UUID; a
   different session belonging to the same or another user cannot consume it.
2. Start requires the current password. The repository locks the user and initiating
   session and compares the same password hash that the service verified, so a
   concurrent password reset cannot create a stale phone-change challenge.
3. The normalized replacement number must differ from the current number. Start does
   not reveal whether another account already uses it and the challenge does not
   reserve it. Only after OTP proof does the users table's unique constraint make
   occupied or concurrent completion atomic: at most one account succeeds.
4. A challenge expires after 10 minutes, permits at most eight durable attempts, and
   is invalidated when a newer challenge is created. SMS-provider send failure
   invalidates it before returning a controlled unavailable response.
5. The current phone remains verified and unchanged until the provider approves an
   OTP sent to the replacement phone. A failed, stale, exhausted, foreign-session, or
   replayed challenge returns the same `INVALID_PHONE_CHANGE` boundary.
6. Completion locks the user, initiating session, and challenge. In one transaction it
   replaces and verifies the phone, marks the challenge complete, revokes every other
   active session, invalidates every unused password-recovery challenge/grant created
   for the old phone, invalidates other pending phone changes, and appends immutable
   minimized evidence. The initiating session remains active.

## Abuse and outage behavior

Shared PostgreSQL rate limits cover IP, user, replacement phone, and challenge ID.
Start allows three user/phone requests per hour and ten per IP. Confirmation permits
eight attempts per user/phone/challenge and twenty per IP over 15 minutes, in addition
to the durable eight-attempt challenge cap. Explicit throttling returns `429` with
`Retry-After`.

If shared rate-limit state is unavailable, the request fails closed before password
verification, challenge creation, provider work, or account mutation. Verification
provider send/check failure cannot change the account. Operational logs emit only
controlled event names and never phone, password, code, challenge, session, provider
payload, or exception text.

## Privacy and retention

The pending challenge temporarily contains the replacement phone because the server
must ask the verification provider to check that destination. Challenges are deleted
after 30 days by the repository cleanup path; production maintenance must run the same
cleanup even during periods without phone-change traffic. The immutable event stores
only user/challenge UUIDs, revoked-session count, invalidated-recovery counts, and
time. It has no phone, phone hash, password/session credential, OTP, provider ID, or
foreign key that would retain the temporary challenge row.

## Remaining boundaries

- A user who no longer controls the verified phone and also cannot sign in must use a
  separately reviewed support/identity-proofing policy. Staff cannot replace a phone
  or bypass this challenge.
- Suspicious-session detection, notification of security changes, a reusable recent
  step-up grant, external alert routing, and an exercised provider/store outage drill
  remain production work.
