# Database recovery and secret operations

Updated 2026-09-09 for text artifacts. Rotation/restore share all seventeen ciphertext
families. The current catalog has 61 migrations and 58 public tables. See the
[remediation evidence](remediation-2026-09-07.md).

This document defines the repository-owned recovery contract. The executable drill
proves local backup and restore mechanics; it does not claim that managed production
backups, point-in-time recovery, secret-manager policy, or a production restore test
already exist.

## Provisional invite-alpha recovery objectives

The deployment owner and privacy owner must accept or replace these targets before
invite alpha:

| Scope | RPO | RTO | Reason |
| --- | --- | --- | --- |
| PostgreSQL application state | 15 minutes | 2 hours | Credits, consent evidence, suppression, audit, jobs and call state are authoritative here. |
| Web/API/worker binaries | Git commit; no data loss | 30 minutes after database availability | Immutable artifacts must be rebuilt or redeployed from the evidenced commit. |
| Provider recordings | Existing 0/7/30-day product retention; no independent archive | Reconcile within 4 hours | Audio remains provider-held and must not be copied into a longer-lived backup tier. |

SHPROHLI is not an emergency service. During recovery, new outbound calls remain
disabled until authoritative database state, worker fencing, provider reconciliation,
credit settlement, suppression, and retention state are verified.

## Required production backup policy

- Use managed PostgreSQL point-in-time recovery with continuous WAL coverage capable
  of the accepted RPO, plus a daily base backup.
- Encrypt backup transport and storage with a backup-specific managed key. Restrict
  backup administration separately from application runtime credentials.
- Keep a provisional 35-day database-backup retention window, subject to the formal
  privacy/legal review. Do not extend recording retention through database backups.
- Store the application commit, migration head, database/server version, backup or
  snapshot identifier, start/end time, retention expiry and operator in protected
  evidence. Never store connection strings, encryption keys or restored private data
  in evidence or CI logs.
- Run an isolated restore before launch, monthly during invite alpha, after a database
  major-version change, and after a material migration/recovery-tool change.
- Expired backups must be irrecoverably removed by policy. Account/data deletion must
  define how deleted records age out of immutable backups and how any later disaster
  restore replays deletion/suppression obligations before service resumes.

## Repository recovery drill

Run from the repository root with the local PostgreSQL Compose service healthy:

```powershell
pnpm db:recovery:drill
```

The command uses `RECOVERY_SOURCE_DATABASE_URL` when supplied and otherwise
`DATABASE_URL`. It accepts only a named local PostgreSQL application database. The
PostgreSQL container is discovered from Compose or supplied through
`RECOVERY_POSTGRES_CONTAINER`; CI uses the GitHub service-container ID.

The drill:

1. Verifies the source migration checksums and critical application tables. Run it
   against a quiescent local source so its row-count snapshot cannot race with writes.
2. Opens an exclusive PostgreSQL custom-format dump with a requested mode of `0600`
   in a generated system temporary directory without printing database contents or
   credentials. Windows relies on the current user's inherited temporary-directory ACL.
3. Creates only a random `callassist_restore_drill_<hex>` database.
4. Restores with `--exit-on-error`, reruns the migration runner idempotently, compares
   the complete public-table inventory, row-count and migration snapshots, reads
   critical tables, and decrypts one available sample from each encrypted data family
   using the current data key.
5. Emits versioned JSON evidence with tool/database versions, archive size/SHA-256,
   migration/table counts and the number of encrypted samples verified.
6. Force-disconnects and drops only the generated restore database, then deletes the
   temporary dump even when the drill fails.

This dump is intentionally ephemeral and unencrypted beyond its restrictive local
file permissions. It is a mechanics test, not an approved production backup sink.
Production drills must restore an encrypted managed snapshot into an isolated network
and preserve only the minimized evidence record.

## Production recovery sequence

1. Declare the incident, disable new calls, stop worker consumers and record the UTC
   recovery point, application commit and named recovery/privacy owners.
2. Select the newest valid recovery point within the accepted RPO. Obtain database
   credentials and the matching data-encryption key through separate least-privilege
   access; do not copy either into an incident ticket.
3. Restore into an isolated database/network first. Run the equivalent of the
   repository drill, malware/access checks required by the platform, migration
   checksum validation and a current-key decryption canary.
4. Deploy the matching web/API/worker artifacts, apply only forward migrations, and
   keep public traffic and job consumers disabled.
5. Verify liveness/readiness, users/sessions, credits, suppressions, audit immutability,
   worker fencing, queues, consent/retention state and provider reconciliation.
6. Replay deletion, suppression and retention obligations that occurred after the
   selected recovery point. The privacy owner must approve this step before traffic.
7. Resume the API, then one worker, then a supervised non-billable smoke path. A
   superadmin records the decision before re-enabling outbound calls.
8. Preserve only minimized evidence and complete the incident/postmortem process.

## Secret inventory and rotation contract

Production secrets belong in a managed secret store with environment/workload-scoped
read access, access audit, versioning, protected backup/escrow where required, and no
browser, source-control, CI-log or support-channel exposure.

| Secret | Rotation procedure |
| --- | --- |
| PostgreSQL credential | Create a new least-privilege credential, deploy API/worker overlap, verify readiness and the restore drill, then revoke the old credential and review access logs. |
| Twilio/OpenAI credentials | Create/activate a new provider credential, deploy all consumers, perform bounded provider checks, then revoke the old credential. Disable calls throughout an incident rotation. |
| Session exposure | Revoke all server-side sessions with the existing audited control and require login again; rotating unrelated encryption keys does not revoke sessions. |
| `PROMO_CODE_HASH_KEY` | Deactivate every outstanding promo campaign/code before replacement, deploy the new independent key, and issue new codes. A future key-ID scheme is required for overlap without invalidation. |
| `RATE_LIMIT_HASH_KEY` | Keep the old key through the maximum seven-day bucket window or clear the ephemeral rate-limit tables during a controlled maintenance window, then deploy the new independent key to every API instance at once. A mixed-key fleet would create separate budgets and is forbidden. |
| `EMAIL_VERIFICATION_HASH_KEY` | Rotation invalidates every pending email-change code. Pause email changes, wait ten minutes or invalidate pending challenges, deploy the new independent key to every API instance at once, and then resume the flow. |
| Data-encryption keyring | Never replace `DATA_ENCRYPTION_KEY` alone. Introduce a new active ID/key while retaining the old key in `DATA_ENCRYPTION_PREVIOUS_KEYS`, map legacy `v1` rows with `DATA_ENCRYPTION_LEGACY_V1_KEY_ID`, run the confirmed re-encryption procedure below, verify a restore with the full keyring, and retire the old key only after affected backups expire or have an approved recovery path. |

A suspected data-encryption-key compromise is a release-blocking security incident,
not a normal environment-variable update. Keep any old key available only under
incident-controlled access until re-encryption and backup-expiry obligations are
complete. The production launch remains blocked until the secret manager, named
owners, access policy and one exercised credential/key procedure are evidenced.

## Data-encryption key rotation

The shared inventory includes `call_preparation_requests.input_ciphertext`.
The queued-old-key regression rotates it, removes the old runtime key, completes
the preparation and proves a no-op replay. The merged rotation regression also
verifies immutable plans and attempt snapshots after retiring the old runtime key.
The 2026-09-07 restore drill verified 12 populated families from the then 13-family inventory;
its schema parity tests covered those 13 columns. See [merge evidence](merge-verification-2026-09-07.md).
The current inventory has 17 ciphertext columns, adding final transcript revisions,
generated text artifacts, persisted artifact chunks and plan review receipts. Updated
isolated rotation and Docker restore tests verify these payloads after retiring the
old runtime key, including immutable hashes and privacy-redaction behavior. This local
evidence does not replace production backup/deletion-replay acceptance.
Do not retire a key using success evidence from older builds;
run the updated tool against the target data and preserve the results below.

New immutable compilation/approval, attempt snapshot and transcription-chunk columns
are included alongside pending preparation input; schema inventory tests enforce
coverage. Before migrating populated databases through 0061, follow the
[cutover sequence](approved-call-plan-cost-security-roadmap.md#migration-and-rollout-sequence).

New encrypted values use `v2:<key-id>:<iv>:<tag>:<ciphertext>`. AES-GCM authenticates
the key ID as additional data, so changing the envelope ID invalidates authentication.
The runtime still reads legacy `v1` values by resolving them through the explicitly
configured legacy key ID. Feedback idempotency fingerprints are also key-versioned;
new versions derive a purpose-separated HMAC key rather than using the data key
directly.

Use this sequence for every production rotation:

1. Preserve a successful encrypted backup/restore record and record the application
   commit, current key ID, proposed new key ID, maintenance window and named security,
   database and privacy owners. Never put key material in that evidence.
2. Disable outbound calls, stop worker consumers, quiesce all API writers, and keep
   traffic stopped until every consumer runs the dual-read build. A mixed deployment
   is unsafe because an old binary cannot read a newly written `v2` envelope.
3. Configure a fresh active ID/key, retain the old ID/key in the JSON previous-key map,
   and point the legacy ID at the key that encrypted existing `v1` rows. Production
   startup rejects an implicit active ID, unknown legacy ID, duplicate IDs, more than
   four previous keys, and the same key material under two IDs.
4. Set `DATA_ENCRYPTION_REENCRYPT_CONFIRM` to the exact active key ID and run
   `pnpm db:reencrypt`. The command applies pending migrations, takes a dedicated
   PostgreSQL advisory lock, commits bounded batches, refuses unverified feedback,
   and emits only aggregate versioned JSON evidence. It covers all seventeen
   enumerated families, including pending preparation input. An interrupted
   run is resumable; rows already using the active key are skipped.
5. Run `pnpm db:reencrypt` again with the same confirmation. Preserve evidence that
   both remaining counts are zero and the second run rewrites zero rows. Run
   `pnpm db:recovery:drill` with the complete keyring and preserve its minimized
   evidence before resuming one worker, the API, and finally outbound calls.
6. Remove the old runtime key only when no live row depends on it and every retained
   backup containing old ciphertext has expired or has a separately approved escrowed
   recovery procedure. Validate production startup and recovery again after removal.

Example shape (values belong in the managed secret store, not the shell history or
repository):

```text
DATA_ENCRYPTION_ACTIVE_KEY_ID=primary-2026-08
DATA_ENCRYPTION_KEY=<new-base64-key>
DATA_ENCRYPTION_PREVIOUS_KEYS={"primary-2026-01":"<old-base64-key>"}
DATA_ENCRYPTION_LEGACY_V1_KEY_ID=primary-2026-01
DATA_ENCRYPTION_REENCRYPT_CONFIRM=primary-2026-08
```

## Historical remediation evidence (before mainline integration)

The 2026-09-07 audit restored the populated test database in a disposable Docker
PostgreSQL 17.10 container: 49 migration/checksum rows, 51 public-table row counts,
seven critical tables and eight available ciphertext-family samples verified.
The drill reported temporary resources removed. This proves the current tool's
enumerated coverage, not verification of preparation ciphertext or production PITR.
The targeted rotation probe separately reproduced the omitted-family failure.
