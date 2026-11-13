# Local call interruption, 13 November 2026

The latest local call was terminated by the application's persistence failure
handler. PostgreSQL timed out while the transcript writer waited for a row lock
on `call_briefs`. The generic `openai_error` conversation-end label does not
identify the underlying failure in this incident.

Call: `86e57d57-09eb-44ce-ac52-cc502a99db3d`.
Attempt: `ed6e7916-7ba6-4850-b911-ef9ef89c7f57`.
Environment: local `callassist_roles_20261109`, container `callassist-postgres-1`.
All timestamps below are UTC; Zurich local time is UTC+1.

## Confirmed evidence

| Time | Evidence |
| --- | --- |
| 10:59:45.645 | Call attempt created. |
| 10:59:57.714 | Telephony connection recorded as in progress. |
| 10:59:59.253 | Conversation start event. |
| 11:00:23.842 | PostgreSQL first cancels a trace write query for exceeding its 2.5-second statement timeout. |
| 11:00:29.919 | Worker claim query times out while locking a tuple in `preparation_settings`; further worker lock timeouts follow. |
| 11:00:30.934 | PostgreSQL PID 44911: `canceling statement due to statement timeout`, with context `while locking tuple (18,5) in relation "call_briefs"`. The query is `SELECT id FROM call_briefs WHERE id=$1 AND data_deleted_at IS NULL FOR UPDATE`. |
| 11:00:30.938 | API logs `Live persistence failed`, immediately followed by `Live session failed`, code `LIVE_PERSISTENCE_FAILED`. |
| 11:00:38.032 | Conversation-end event is persisted with the generic reason `openai_error`. This timestamp is later than the actual failure handling. |
| 11:00:38.207 | Recording completion event: 32 seconds, two channels. |
| 11:00:38.367 | Telephony attempt becomes `completed`. |
| 11:00:44.693 | Transcript capture is marked `incomplete`, with `persistence_failed` and `session_unconfirmed`; `sessionFinalized=false`. |
| 11:00:45.970 | Trace manifest reports 46 dropped events, `complete=false`, `sessionClosed=false`, and a drain timeout. |

Saved transcript content shows that the recipient selected November 25 at 10:00.
The assistant began repeating that date, time, duration and purpose, and the saved
text ends during that readback. It does not contain the final confirmation.
Several queued transcript fragments were saved after the session had already
been closed. Their later persistence is not evidence that the call continued.
The trace-drain timeout is also downstream of the persistence failure.

The provider's `completed` status describes the ended telephone connection; it
does not establish that the meeting was successfully confirmed.

## Code path

- `PostgresCallRepository.addTranscript` takes `FOR UPDATE` on the call row
  before inserting a transcript fragment. Its pool sets a 10-second statement
  timeout. See `apps/api/src/storage/postgres-call-repository.ts:597` and `:5533`.
- Trace persistence uses a separate pool, but its transaction takes `FOR SHARE`
  on the same call row. Separating connections does not remove this row-lock
  dependency. See `apps/api/src/storage/native-live-store.ts:119`.
- A rejected transcript persistence promise enters `LiveConversation.#write`
  and calls `#fail("LIVE_PERSISTENCE_FAILED")`. That terminates the live socket
  and invokes the enclosing call's failure callback. See
  `apps/api/src/voice/live-conversation.ts:1233`.
- The native call failure path maps that callback to
  `#close("openai_error")`. See `apps/api/src/voice/native-live-v2-call.ts:375`.
  This explains the misleading provider attribution without requiring an
  OpenAI outage or a model decision to hang up.
- Trace-write errors alone are caught and counted as dropped diagnostics;
  the fatal condition here was transcript persistence failure. See
  `apps/api/src/voice/live-protocol-trace.ts:59`.

## What remains unknown

The blocking transaction cannot be identified retrospectively from the available
logs. PostgreSQL `log_lock_waits` was off and duration logging was disabled.
A later read-only activity snapshot showed no outstanding blockers or open
transactions in this database. The simultaneous worker timeouts demonstrate
broader contention but do not identify its origin or prove that a preparation
worker held the call lock. There is no logged deadlock to justify that diagnosis.

The direct cause is established: a call-row lock wait exceeded the persistence
deadline and triggered the existing application shutdown path. The original
lock holder, and why it held the lock for that long, remain unproven.

## Recommended follow-up boundary

First repeat the observation under reduced local host load, with resource and
lock-wait diagnostics captured. The resource hypothesis below is a reason to
investigate the environment before selecting a storage-code change.

Capture blocker PID, transaction age, wait event and sanitized query identity
during a recurrence, with lock-wait logging enabled for the local investigation.
If a storage defect is established, repair the specific transaction or lock scope
responsible and verify concurrent transcript/trace/worker writes using a separate
test database. Preserve the lifecycle and deletion/privacy guarantees that those
locks currently protect.

Keep the existing voice behavior and post-call evaluation contract. A blanket
timeout increase or suppression of persistence failures would conceal the
observed dependency without establishing reliable capture. Preparation auditing
and display translation are not in the recorded failure path.

This investigation made no application-code, runtime-configuration, database-data
or assessment changes and placed no calls or model requests. Local private
evidence is retained under `.tools/runtime/roles-local-2026-11-09/` in
`latest-call.private.json`, `latest-call-abort.private.json`, and the API/worker
logs named `*-20261113-115357.*.log`. Raw transcript and identity data are omitted
from this report.

## Follow-up: concurrent Docker workload and host resources

Read-only checks at approximately 11:15 UTC (12:15 Zurich) found:

- Windows had 15.65 GiB visible physical memory with 1.08 GiB free, and reported
  16% CPU load across eight logical processors. A subsequent snapshot showed
  1,198 MiB available and 90% committed memory usage. These are later snapshots,
  not measurements of the incident window.
- `antiscam-v2-check-pg-20261113` started at 10:58:41 UTC, about one minute before
  the call attempt. It has a separate PostgreSQL data volume, a one-CPU quota and
  a 256 MiB memory limit. At inspection it used 0.17% CPU and 154.2 MiB memory.
- `callassist-postgres-1` had been running since 07:32:37 UTC, with zero container
  restarts and `OOMKilled=false`. It used 1.71% CPU and 295.5 MiB at inspection.
  The other container also had zero restarts and `OOMKilled=false`.
- No critical/error/warning entries were returned from the Windows System log
  for 10:58–11:02 UTC. This does not exclude CPU scheduling, paging or disk delays.
- The second PostgreSQL log shows its ordinary initial cluster startup; the
  startup shutdown/restart sequence ended before the call. It does not record a
  resource spike at the interruption. The Callassist checkpoint completed at
  10:59:48 UTC; its elapsed duration alone does not establish disk saturation.

The two PostgreSQL servers have separate data directories and lock managers.
The second server cannot itself hold a row lock in the Callassist database. Its
workload can compete for shared host CPU, memory and disk, which could delay a
Callassist transaction and prolong the time it holds its own locks. The small
current memory reserve makes host resource pressure a plausible contributing
factor; no historical resource measurements or blocker identity establish that
it caused this particular interruption.

Neither container was stopped or reconfigured. No new call was placed. The
confirmed failure chain remains row-lock timeout → persistence failure → session
closure; the upstream reason for the prolonged lock remains unresolved.
