# Recipient opt-out

Public SMS verification is available only after confirmed outbound Twilio contact
with the original destination. Ringing, connected/completed, busy and unanswered
calls qualify. Drafts, mock calls, queued requests and failures/cancellations without
earlier contact do not qualify. Consent and credit charging are unrelated.

## Deployment

1. Create a dedicated Twilio Verify Service and configure
   `TWILIO_OPT_OUT_VERIFY_SERVICE_SID` on the API. It must differ from the account
   `TWILIO_VERIFY_SERVICE_SID`. Configure its sender/branding as appropriate.
2. Generate an independent random 32-byte base64 `RECIPIENT_CONTACT_HASH_KEY`.
   Install the same value on every API and worker process. Keep it stable across
   data-encryption key rotation and include it in the protected backup/recovery
   configuration. Replacing it makes existing contact fingerprints unresolvable;
   any change needs a separate migration strategy.
3. Apply migration `0075_recipient_opt_out_eligibility.sql`, run the deployment
   check, and restart API and workers with the same release/configuration.
   Normal service initialization backfills existing eligible attempts in batches.

No external SMS or calls are needed to test this change. Production validation
requires both settings; there is no fallback to the account verification service.

## Evidence and legacy data

New attempts retain a keyed fingerprint of their original destination. Trusted
provider status handling writes a monotonic, separate contact marker in the same
transaction. Owner deletion clears the attempt's fingerprint, preserving only
the separate marker. Later failures and owner deletion cannot remove this marker. The
marker contains only a keyed phone fingerprint and last-contact time. There is no
expiry: a recipient does not lose access to opt-out because the call was old.

Backfill uses real Twilio attempts and recorded provider evidence. It binds a
historical attempt to the current number only if its compilation matches the
current brief (or the attempt already has its own fingerprint). Attempts with an
ambiguous historical destination stay in `recipient_contact_backfill` for manual
reconciliation; never assign a newly edited number to an older call. Numbers
already erased before this release cannot be reconstructed from deleted data.
Support can always apply an audited staff suppression, including for landlines.

## Confirmation and spending

Eligible requests reserve a purpose-specific challenge before SMS dispatch. Only
the SHA-256 digest of the random 256-bit browser token and the keyed phone
fingerprint are stored. Challenges expire after ten minutes, allow eight guesses,
and use a thirty-second claim lease to fence simultaneous confirmations. A new
send invalidates older challenges. Consumption and global suppression/audit are
one PostgreSQL transaction. The existing recipient lock also serializes staff
suppression and call admission. Expired challenges are cleaned on new requests.

Unknown/already-suppressed numbers, cooldowns and SMS provider failures return
the same 202 response shape with an opaque token; no phone-history flag is exposed.
Only eligible, successfully dispatched challenges can reach the Verify check.
The existing IP/phone limits cover ineligible requests too. Actual sends also use
the existing shared cooldown, hourly, global and beta spending budgets. Failed or
uncertain sends are never retried automatically and cannot activate a challenge.

The UI uses conditional delivery wording in English/German and offers support if
SMS does not arrive or the recipient number cannot receive SMS. Staff suppression
remains available regardless of previous call history.
