# Database recovery and secret operations

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

CallAssist is not an emergency service. During recovery, new outbound calls remain
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
| `DATA_ENCRYPTION_KEY` | Do not replace it in place. Current `v1` ciphertext has no key identifier: removing the old key makes existing private data unreadable. Rotation requires a reviewed key-ring/envelope format, dual-read/new-key-write deployment, complete resumable re-encryption with counts, backup/restore verification, and only then retirement of the old key. |

A suspected `DATA_ENCRYPTION_KEY` compromise is therefore a release-blocking security
incident, not a normal environment-variable update. Keep the old key available only
under incident-controlled access until re-encryption and backup-expiry obligations are
complete. The production launch remains blocked until the secret manager, named
owners, access policy and one exercised credential/key procedure are evidenced.
