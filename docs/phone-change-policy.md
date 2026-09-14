# Verified phone-number change policy

Status: implemented repository baseline in checkpoint 6F6. This is a
self-service flow for an active, signed-in user who still knows the current password
and controls the replacement phone. It is not a support override for loss of both
password and verified-phone access.

Reviewed 2026-09-14 against the current working copy; implementation/release status is in
the [architecture](architecture.md) and [roadmap](mvp-plan.md).

## Security invariants

1. Both endpoints require an allowed browser origin and an active verified account
   session. The challenge is bound to the initiating user and exact session UUID; a
   different session belonging to the same or another user cannot consume it.
2. Start requires the current password. The repository locks the user and initiating
   session and compares the same password hash that the service verified, so a
   concurrent password reset cannot create a stale phone-change challenge.
3. The normalized replacement number must differ from the current number. After
   password/session proof, start checks whether another account already uses it,
   including unfinished registrations. An unavailable number returns the generic
   `PHONE_CHANGE_NOT_AVAILABLE` (409) without sending an SMS or exposing account
   details. A challenge does not reserve the number. The users table's unique
   constraint still protects concurrent completion: at most one account succeeds.
4. A challenge expires after 10 minutes, permits at most eight durable attempts, and
   is invalidated when a newer challenge is created. SMS-provider send failure
   invalidates it before returning a controlled unavailable response.
5. The current phone remains verified and unchanged until the provider approves an
   OTP sent to the replacement phone. A failed, stale, exhausted, foreign-session, or
   replayed challenge returns the same `INVALID_PHONE_CHANGE` boundary. If the
   provider accepts the code but the repository can no longer complete the change,
   the challenge is invalidated and `PHONE_CHANGE_NOT_AVAILABLE` is returned;
   the UI must not describe a valid provider proof as an incorrect code.
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
must ask the verification provider to check that destination. The repository deletes
rows older than 30 days on new challenge creation and via startup/hourly deletion-worker
maintenance, including idle periods. Account deletion removes all challenge states
atomically with anonymization. Existing deleted-user remnants are also purged by
maintenance. The immutable event stores
only user/challenge UUIDs, revoked-session count, invalidated-recovery counts, and
time. It has no phone, phone hash, password/session credential, OTP, provider ID, or
foreign key that would retain the temporary challenge row.

## Remaining boundaries

Account contacts support Swiss (+41) and Ukrainian (+380) SMS destinations.
Registration, correction and replacement normalize international spacing and `00`
prefixes; unprefixed local numbers use CH. The local SMS allow-list and repository
default are `CH,UA`. Call destinations and recipient opt-out retain their own policy.
Twilio Verify Geo Permissions must also permit Ukraine for real delivery.

2026-09-14: completion now sends a localized security notice to the account's
verified email. Delivery failure does not undo the completed change. All Twilio
sends also consume shared cross-flow phone/global budgets and the SMS country
allow-list. [Email/SMS configuration and acceptance](email-sms-implementation-2026-09-14.md).

- A user who no longer controls the verified phone and also cannot sign in must use a
  separately reviewed support/identity-proofing policy. Staff cannot replace a phone
  or bypass this challenge.
- Suspicious-session detection, durable delivery of security notices, a reusable recent
  step-up grant, external alert routing, and an exercised provider/store outage drill
  remain production work.
