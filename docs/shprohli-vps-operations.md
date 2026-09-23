# Shprohli VPS operations

Shprohli runs beside OstKompass on the same VPS. It has separate systemd
services, a Linux user, release directories, PostgreSQL 17 cluster on loopback
port 5433, database, secrets, logs and backups. nginx shares ports 80/443 but
routes `shprohli.ch` and `voice.shprohli.ch` through separate vhosts. Never
restart OstKompass or PostgreSQL 16 as part of a Shprohli update.

## Routine code update

1. Commit and push the intended code or static content changes to `main`.
2. Wait for the exact main-branch `CI` run to succeed.
3. On the VPS, run `sudo shprohli-release check`, then
   `sudo shprohli-release deploy`.
4. Check `sudo shprohli-release status` and the public site. Confirm
   `https://ostkompass.ch/` is still healthy.

The helper is installed as `/usr/local/sbin/shprohli-release` from
[`scripts/shprohli-vps-release.sh`](../scripts/shprohli-vps-release.sh). It
fetches the exact main SHA, requires ancestry from the active release and a
successful CI run, builds an inactive release with the frozen lockfile and a
bounded concurrency, checks the migration catalog, pauses new calls, drains
active calls and worker jobs, creates a fresh database backup, switches the
`current` symlink, restarts API/web/worker and checks process parity, readiness,
worker heartbeat, redirects, both public sites and the call gate. A failed
switch attempts to restore the old symlink and services. If recovery cannot be
verified, it leaves new calls paused for investigation.

The routine command deliberately refuses any change to SQL migrations. Schema
updates need a reviewed compatibility plan, a fresh restore test and a
supervised deployment. Code rollback does not undo migrations or user data.
Database-backed CMS content also does not move with a Git push; stage and
publish it through the application's content workflow.

## Rollback

`sudo shprohli-release rollback` switches to the previous built release after
the same migration, call-drain, backup and health checks. Inspect active calls,
queued work and provider state before invoking it during an incident. The
helper retains the former release at `/opt/shprohli/previous` after a
successful switch. A database restore is a separate incident procedure and
requires reconciliation of provider effects and deletion/suppression state.

## Backups, logs and TLS

- `/usr/local/sbin/shprohli-db-backup` runs daily at 04:15 UTC via
  `shprohli-db-backup.timer`. It validates each custom-format dump before
  publication, then keeps seven days in root-only `/var/backups/shprohli`.
- The Shprohli PostgreSQL and nginx logrotate rules keep seven daily rotations
  with size caps. The application has its own journald namespace and seven-day
  retention. These settings do not change OstKompass's log policy.
- Certbot renews the site and voice certificates using the Shprohli ACME
  webroot. Its lineage-filtered deploy hook tests and reloads nginx only for
  Shprohli renewals.

The current backups are on the same VPS as the database. They cover accidental
changes and some software incidents but cannot recover from VPS or disk loss.
Daily dumps can lose up to 24 hours of data. An off-host backup and shorter
recovery interval require a separate decision before claiming those guarantees.

## Launch controls

The first VPS migration left the rolling USD budget unconfigured, which
blocks paid operations. The owner selected USD 20 per rolling 24 hours for the
public beta. Configure and test it during the supervised first-account and
provider acceptance. The local database's per-minute and per-text reserves
are not transferred by Git and must be reviewed on the VPS. Do not infer that
a successful `/health/ready` response verifies Twilio, OpenAI, Resend, alert
delivery or a full customer call.
