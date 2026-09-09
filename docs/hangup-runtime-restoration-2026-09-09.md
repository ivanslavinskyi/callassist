# Local agent hangup restoration — 2026-09-09

The latest local API launch omitted `REALTIME_AGENT_HANGUP_ENABLED`. The main
`.env` also lacked it. `index.ts` enables the bridge only when the value is exactly
`true`; the bridge default is `false`. The R21 acceptance report records that its
successful call used the flag on a temporary QA API and did not persist it for the
main local environment. The hangup implementation remains present.

Read-only PostgreSQL evidence confirmed migration 0062 is applied. The latest
completed call had consent and Realtime readiness but no hangup events. The prior
successful R21 call had three hangup phase events, one request, and an
`agent_hangup` completion. No transcript, recipient, user or provider identifiers
were read into this report.

Restoration: append only `REALTIME_AGENT_HANGUP_ENABLED=true` to the local `.env`.
Every pre-existing file byte was verified unchanged. The repository example and
production defaults remain opt-in. The API was restarted on 2026-09-09 at 12:17 UTC
after a fresh check found zero active briefs and zero active attempts. The current
OpenAI text settings, mock SMS and existing tunnel URL were preserved.

Targeted verification command from `apps/api`:

```powershell
node node_modules/vitest/vitest.mjs run src/realtime/agent-hangup.test.ts src/realtime/agent-hangup-recovery.test.ts src/realtime/openai-realtime-bridge.test.ts --silent
```

These tests use fake sockets/providers and cover farewell playback, interruptions,
fallback deadlines, disabled-flag behavior and durable restart recovery. No real
call or provider request is part of this verification. Result: **55/55 passed**
(22 hangup state tests, 32 bridge tests, one restart-recovery test). A fresh
`load-env` check returned `true`. After the coordinated restart, API startup logging
explicitly reported `agentHangupEnabled: true`. Both health endpoints
returned 200, the web login returned 200, capabilities retained OpenAI generation
and all 24 configured operations, and the public tunnel rejected an unsigned voice
webhook with 403. Startup now logs the non-secret hangup flag to make an omitted
configuration visible. A new real farewell/hangup call has not been performed;
the runtime verification is not a claim of a new live provider acceptance test.
See the
[local restart procedure](runtime-reference.md#preserving-the-local-test-runtime-when-restarting).
