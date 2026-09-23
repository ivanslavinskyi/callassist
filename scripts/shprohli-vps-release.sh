#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Install as /usr/local/sbin/shprohli-release, owned by root. No credentials
# belong in this file. Schema-changing releases require a supervised rollout.
base=/opt/shprohli
source_repo=$base/source
current=$base/current
previous=$base/previous
pg_bin=/usr/lib/postgresql/17/bin
action=${1:-}

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ $(id -u) == 0 ]] || die 'Run as root (sudo shprohli-release ...).'
[[ $# == 1 && ( $action == status || $action == check || $action == deploy || $action == rollback ) ]] ||
  die 'Usage: shprohli-release <status|check|deploy|rollback>'
exec 9>/run/lock/shprohli-release.lock
flock -n 9 || die 'Another Shprohli release operation is running.'

db() {
  sudo -u postgres "$pg_bin/psql" -X -p 5433 -d shprohli \
    -v ON_ERROR_STOP=1 -At -c "$1"
}
git_source() { sudo -u shprohli -H env GIT_TERMINAL_PROMPT=0 git -C "$source_repo" "$@"; }
site_ok() {
  [[ $(curl -sS --max-time 6 --noproxy '*' \
    --resolve shprohli.ch:443:127.0.0.1 -o /dev/null -w '%{http_code}' \
    https://shprohli.ch/en) == 200 ]]
}
old_site_ok() {
  [[ $(curl -sS --max-time 6 -o /dev/null -w '%{http_code}' \
    https://ostkompass.ch/) == 200 ]]
}
release_sha() {
  local path=$1 sha
  [[ -d $path && ! -L $path ]] || return 1
  sha=$(cat "$path/.release-sha")
  [[ $sha =~ ^[0-9a-f]{40}$ && $path == "$base/releases/$sha" ]] || return 1
  printf '%s\n' "$sha"
}
active_path=$(readlink -f "$current")
[[ -L $current && $active_path == "$base"/releases/* ]] || die 'Invalid current symlink.'
active_sha=$(release_sha "$active_path") || die 'Invalid active release marker.'
[[ $(stat -c '%U:%G %a' "$base") == 'root:shprohli 750' ]] || die 'Invalid application root permissions.'

service_gate() {
  systemctl is-active --quiet shprohli-api.service shprohli-web.service \
    shprohli-worker.service shprohli-db-backup.timer \
    postgresql@17-shprohli.service postgresql@16-main.service \
    ukrainedirekt.service nginx.service
  curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:4100/health/ready
  site_ok && old_site_ok
}

ledger_gate() {
  local dir=$1 rows name checksum actual count=0 catalog_count latest catalog_latest
  dir=$dir/apps/api/src/db/migrations
  [[ -d $dir ]] || die 'Migration catalog missing.'
  catalog_count=$(find "$dir" -maxdepth 1 -type f -name '*.sql' | wc -l)
  catalog_latest=$(find "$dir" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' | sort | tail -1)
  rows=$(db 'SELECT name,checksum_sha256 FROM schema_migrations ORDER BY name')
  while IFS='|' read -r name checksum; do
    [[ $name =~ ^[0-9]{4}_[a-z0-9_]+\.sql$ && $checksum =~ ^[0-9a-f]{64}$ ]] ||
      die 'Invalid live migration ledger row.'
    [[ -f $dir/$name ]] || die "Missing applied migration $name."
    actual=$(node - "$dir/$name" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const sql = fs.readFileSync(process.argv[2], 'utf8').replace(/\r\n?/g, '\n');
process.stdout.write(crypto.createHash('sha256').update(sql).digest('hex'));
NODE
    )
    [[ $actual == "$checksum" ]] || die "Applied migration checksum mismatch: $name."
    count=$((count + 1))
  done <<< "$rows"
  latest=$(db 'SELECT max(name) FROM schema_migrations')
  [[ $count == "$catalog_count" && $latest == "$catalog_latest" ]] ||
    die "Migration ledger differs from active release (database $count/$latest, catalog $catalog_count/$catalog_latest)."
  printf 'Migration ledger matched: %s through %s\n' "$count" "$latest"
}

ci_gate() {
  local sha=$1 response
  response=$(mktemp /tmp/shprohli-ci.XXXXXX)
  if ! curl -fsS --max-time 25 \
      -H 'Accept: application/vnd.github+json' \
      -H 'X-GitHub-Api-Version: 2022-11-28' \
      --get --data-urlencode "head_sha=$sha" \
      --data-urlencode 'event=push' --data-urlencode 'branch=main' \
      --data-urlencode 'per_page=20' -o "$response" \
      'https://api.github.com/repos/ivanslavinskyi/callassist/actions/workflows/ci.yml/runs'; then
    rm -f -- "$response"
    die 'GitHub CI API unavailable.'
  fi
  if ! node - "$sha" "$response" <<'NODE'
const fs = require('node:fs');
const [sha, path] = process.argv.slice(2);
const runs = JSON.parse(fs.readFileSync(path, 'utf8')).workflow_runs;
const run = Array.isArray(runs) && runs.find(r => r.head_sha === sha &&
  r.event === 'push' && r.head_branch === 'main' &&
  r.status === 'completed' && r.conclusion === 'success');
if (!run) process.exit(1);
console.log(`CI passed: ${sha} (run ${run.id})`);
NODE
  then
    rm -f -- "$response"
    die "No successful main push CI run for $sha."
  fi
  rm -f -- "$response"
}

candidate_gate() {
  local path=$1
  [[ -s $path/apps/api/dist/index.js && -s $path/apps/api/dist/worker.js &&
     -s $path/apps/web/.next/BUILD_ID &&
     -f $path/apps/web/node_modules/next/dist/bin/next ]] ||
    die 'Candidate build artifacts missing.'
  if ! diff -qr -- "$active_path/apps/api/src/db/migrations" \
      "$path/apps/api/src/db/migrations"; then
    die 'Migration catalog changed; use a supervised schema rollout.'
  fi
}

run_call_toggle() {
  local command=$1 reason=$2 unit
  unit="shprohli-release-calls-$command-$(date -u +%Y%m%dT%H%M%S)-$$"
  systemd-run --quiet --unit="$unit" --wait --collect \
    -p Type=exec -p User=shprohli -p Group=shprohli \
    -p Slice=shprohli.slice \
    -p WorkingDirectory=/opt/shprohli/current/apps/api \
    -p Environment=HOME=/opt/shprohli -p Environment=NODE_ENV=production \
    -p EnvironmentFile=/etc/shprohli/database.env \
    -p EnvironmentFile=/etc/shprohli/runtime.env \
    -p EnvironmentFile=/etc/shprohli/provider.env \
    -p LogNamespace=shprohli -p RuntimeMaxSec=90s \
    /usr/bin/node dist/db/set-outbound-calls.js "$command" "$reason"
}

work_state() {
  db "SELECT
    (SELECT count(*) FROM call_attempts WHERE ended_at IS NULL OR
      (provider='twilio' AND max_duration_seconds IS NOT NULL AND
       coalesce(provider_status,'unknown') NOT IN
       ('completed','canceled','busy','failed','no-answer'))) || '|' ||
    (SELECT coalesce(sum(active_jobs),0) FROM durable_worker_heartbeats
      WHERE stopped_at IS NULL AND last_seen_at > now()-interval '30 seconds') || '|' ||
    (SELECT count(*) FROM durable_worker_heartbeats
      WHERE stopped_at IS NULL AND last_seen_at > now()-interval '30 seconds')"
}

wait_for_idle() {
  local state calls jobs workers
  for ((attempt=1; attempt<=300; attempt++)); do
    state=$(work_state)
    IFS='|' read -r calls jobs workers <<< "$state"
    if [[ $calls == 0 && $jobs == 0 && $workers == 1 ]]; then
      printf 'Idle: calls=%s worker_jobs=%s workers=%s\n' "$calls" "$jobs" "$workers"
      return 0
    fi
    sleep 2
  done
  die "Drain timed out: calls=$calls worker_jobs=$jobs workers=$workers."
}

fresh_backup() {
  local archive
  systemctl start shprohli-db-backup.service
  [[ $(systemctl show -P Result shprohli-db-backup.service) == success ]] ||
    die 'Database backup failed.'
  archive=$(find /var/backups/shprohli -maxdepth 1 -type f \
    -name 'shprohli-*.dump' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)
  [[ -n $archive && -s $archive &&
     $(stat -c '%U:%G %a' "$archive") == 'root:root 600' ]] ||
    die 'Fresh backup missing or permissions invalid.'
  (( $(date +%s) - $(stat -c %Y "$archive") < 300 )) || die 'Backup is not fresh.'
  "$pg_bin/pg_restore" --list "$archive" >/dev/null
  printf 'Verified pre-switch backup: %s\n' "$archive"
}

replace_link() {
  local name=$1 destination=$2 temporary
  temporary="$base/.$name-next-$$"
  [[ ! -e $temporary && ! -L $temporary ]] || return 1
  ln -s "$destination" "$temporary"
  mv -Tf -- "$temporary" "$base/$name"
}

runtime_ok() {
  local wanted=$1 api_pid web_pid worker_pid heartbeat ready=0
  for ((attempt=1; attempt<=45; attempt++)); do
    api_pid=$(systemctl show -P MainPID shprohli-api.service)
    web_pid=$(systemctl show -P MainPID shprohli-web.service)
    worker_pid=$(systemctl show -P MainPID shprohli-worker.service)
    if [[ $api_pid =~ ^[1-9][0-9]*$ && $web_pid =~ ^[1-9][0-9]*$ &&
          $worker_pid =~ ^[1-9][0-9]*$ ]] &&
       [[ $(readlink -f "/proc/$api_pid/cwd") == "$wanted/apps/api" &&
          $(readlink -f "/proc/$worker_pid/cwd") == "$wanted/apps/api" &&
          $(readlink -f "/proc/$web_pid/cwd") == "$wanted/apps/web" ]] &&
       systemctl is-active --quiet shprohli-api.service shprohli-web.service \
         shprohli-worker.service &&
       curl -fsS --max-time 4 -o /dev/null http://127.0.0.1:4100/health/ready 2>/dev/null &&
       site_ok 2>/dev/null; then
      heartbeat=$(db "SELECT count(*) FROM durable_worker_heartbeats
        WHERE stopped_at IS NULL AND last_seen_at > now()-interval '30 seconds'")
      if [[ $heartbeat == 1 ]]; then ready=1; break; fi
    fi
    sleep 2
  done
  [[ $ready == 1 ]] || return 1
  [[ $(ss -H -ltn '( sport = :4100 or sport = :4101 )') == *'127.0.0.1:4100'* ]] || return 1
  [[ $(ss -H -ltn '( sport = :4101 )') == *'127.0.0.1:4101'* ]] || return 1
  [[ $(curl -sS --max-time 5 --noproxy '*' \
       --resolve shprohli.ch:443:127.0.0.1 -o /dev/null \
       -H 'Accept-Language: en' \
       -w '%{http_code}|%{redirect_url}' \
       'https://shprohli.ch/?campaign=beta') == \
       '307|https://shprohli.ch/en?campaign=beta' ]] || return 1
  old_site_ok
}

cutover_switched=0
cutover_worker_stopped=0
cutover_pause_attempted=0
cutover_recovery_ok=0
cutover_original_gate=
cutover_reason=
recover_cutover() {
  local rc=$1
  trap - EXIT INT TERM
  set +e
  if (( rc != 0 )); then
    printf 'Release change failed; restoring %s\n' "$active_sha" >&2
    if (( cutover_switched == 1 )); then
      replace_link current "$active_path"
      if [[ $(readlink -f "$current") == "$active_path" ]]; then
        systemctl restart shprohli-api.service shprohli-web.service shprohli-worker.service
        runtime_ok "$active_path" && cutover_recovery_ok=1
      fi
    elif (( cutover_worker_stopped == 1 )); then
      systemctl start shprohli-worker.service
      runtime_ok "$active_path" && cutover_recovery_ok=1
    else
      runtime_ok "$active_path" && cutover_recovery_ok=1
    fi
    if [[ $cutover_original_gate == true && $cutover_pause_attempted == 1 &&
          $cutover_recovery_ok == 1 &&
          $(db "SELECT enabled::text FROM system_controls WHERE key='outbound_calls'") == false ]]; then
      run_call_toggle enable "Rollback after $cutover_reason"
    fi
    printf 'Recovery health: %s; call gate: %s\n' "$cutover_recovery_ok" \
      "$(db "SELECT enabled::text FROM system_controls WHERE key='outbound_calls'")" >&2
    old_site_ok || printf 'OstKompass health check failed.\n' >&2
  fi
  exit "$rc"
}

cutover() {
  local target=$1 target_path
  target_path=$base/releases/$target
  [[ $(release_sha "$target_path") == "$target" ]] || die 'Invalid target release.'
  candidate_gate "$target_path"
  ledger_gate "$active_path"
  service_gate || die 'Services are not ready before cutover.'
  cutover_original_gate=$(db "SELECT enabled::text FROM system_controls WHERE key='outbound_calls'")
  [[ $cutover_original_gate == true || $cutover_original_gate == false ]] ||
    die 'Call gate unavailable.'
  cutover_reason="Release $active_sha to $target"
  trap 'recover_cutover $?' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  if [[ $cutover_original_gate == true ]]; then
    cutover_pause_attempted=1
    run_call_toggle disable "$cutover_reason"
    [[ $(db "SELECT enabled::text FROM system_controls WHERE key='outbound_calls'") == false ]] ||
      die 'Could not pause new calls.'
  fi
  wait_for_idle
  fresh_backup
  systemctl stop shprohli-worker.service
  cutover_worker_stopped=1
  replace_link current "$target_path"
  cutover_switched=1
  [[ $(readlink -f "$current") == "$target_path" ]] || die 'Release switch failed.'
  systemctl restart shprohli-api.service shprohli-web.service shprohli-worker.service
  cutover_worker_stopped=0
  runtime_ok "$target_path" || die 'Candidate health or parity check failed.'
  if [[ $cutover_original_gate == true ]]; then
    run_call_toggle enable "$cutover_reason"
    [[ $(db "SELECT enabled::text FROM system_controls WHERE key='outbound_calls'") == true ]] ||
      die 'Could not resume new calls.'
  fi
  replace_link previous "$active_path"
  [[ $(readlink -f "$previous") == "$active_path" ]] || die 'Previous release pointer failed.'
  trap - EXIT INT TERM
  printf 'Active release: %s\nPrevious release: %s\n' "$target" "$active_sha"
  printf 'Call gate: %s\n' "$(db "SELECT enabled::text FROM system_controls WHERE key='outbound_calls'")"
  printf 'Shprohli HTTPS 200; OstKompass HTTPS 200\n'
}

case $action in
  status)
    printf 'Active release: %s\n' "$active_sha"
    if [[ -L $previous ]]; then printf 'Previous release: %s\n' "$(readlink -f "$previous")"; fi
    printf 'Call gate: %s\n' "$(db "SELECT enabled::text FROM system_controls WHERE key='outbound_calls'")"
    service_gate && printf 'Service and site health: ready\n'
    ;;
  check)
    service_gate || die 'Services are not ready.'
    ledger_gate "$active_path"
    ci_gate "$active_sha"
    [[ $(git_source rev-parse --is-shallow-repository) == false ]] || die 'Git history is shallow.'
    printf 'Release prerequisites passed for %s\n' "$active_sha"
    ;;
  deploy)
    service_gate || die 'Services are not ready.'
    ledger_gate "$active_path"
    [[ -z $(git_source status --porcelain=v1) ]] || die 'Source checkout has local changes.'
    [[ $(git_source rev-parse --is-shallow-repository) == false ]] || die 'Git history is shallow.'
    git_source fetch origin main
    target=$(git_source rev-parse 'FETCH_HEAD^{commit}')
    [[ $target =~ ^[0-9a-f]{40}$ && $target == $(git_source rev-parse origin/main) ]] ||
      die 'Fetched main is inconsistent.'
    if [[ $target == "$active_sha" ]]; then printf 'Already on main: %s\n' "$target"; exit 0; fi
    git_source merge-base --is-ancestor "$active_sha" "$target" ||
      die 'Remote main does not descend from the active release.'
    ci_gate "$target"
    target_path=$base/releases/$target
    if [[ -e $target_path || -L $target_path ]]; then
      [[ -L $previous && $(readlink -f "$previous") == "$target_path" ]] ||
        die "Release directory already exists outside the rollback slot: $target_path"
      printf 'Reusing previously deployed rollback release: %s\n' "$target"
    else
      available_memory_kib=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
      available_disk_kib=$(df -Pk "$base" | awk 'NR==2 {print $4}')
      (( available_memory_kib >= 4*1024*1024 && available_disk_kib >= 15*1024*1024 )) ||
        die 'Insufficient memory or disk headroom for a build.'
      sudo -u shprohli -H mkdir -m 0750 -- "$target_path"
      git_source archive "$target" | sudo -u shprohli -H tar -x -C "$target_path"
      printf '%s\n' "$target" | sudo -u shprohli -H tee "$target_path/.release-sha" >/dev/null
      diff -qr -- "$active_path/apps/api/src/db/migrations" \
        "$target_path/apps/api/src/db/migrations" ||
        die 'Migration catalog changed; use a supervised schema rollout.'
      timeout --signal=TERM --kill-after=30s 20m sudo -u shprohli -H env -i \
        HOME=/opt/shprohli USER=shprohli LOGNAME=shprohli \
        PATH=/opt/shprohli/.local/bin:/usr/local/bin:/usr/bin:/bin \
        COREPACK_HOME=/opt/shprohli/.cache/corepack \
        XDG_CACHE_HOME=/opt/shprohli/.cache CI=1 NEXT_TELEMETRY_DISABLED=1 \
        NEXT_PUBLIC_SITE_URL=https://shprohli.ch \
        NEXT_PUBLIC_API_URL=https://shprohli.ch \
        INTERNAL_API_URL=http://127.0.0.1:4100 \
        bash -c 'set -euo pipefail; cd "$1"; nice -n 10 pnpm install --frozen-lockfile --prod=false; NODE_ENV=production nice -n 10 pnpm exec turbo build --concurrency=2' \
        bash "$target_path"
    fi
    candidate_gate "$target_path"
    [[ $(readlink -f "$current") == "$active_path" ]] || die 'Active release changed during build.'
    cutover "$target"
    if [[ -z $(git_source status --porcelain=v1) ]]; then
      git_source reset --hard "$target" || printf 'WARNING: source checkout stayed on its prior SHA.\n' >&2
    fi
    ;;
  rollback)
    [[ -L $previous ]] || die 'No previous release pointer.'
    target_path=$(readlink -f "$previous")
    [[ $target_path == "$base"/releases/* && $target_path != "$active_path" ]] ||
      die 'Invalid previous release pointer.'
    target=$(release_sha "$target_path") || die 'Invalid previous release marker.'
    cutover "$target"
    ;;
esac
