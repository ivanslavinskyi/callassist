# SHPROHLI

SHPROHLI helps people make everyday phone calls when speaking or the local language
is a barrier. Users prepare and approve a call plan, follow a conversation, and
receive a saved transcript with optional translation, summary and recording transcription.

The current source uses one native Live voice session (live-managed-v9) with
application-owned consent, recording, tool authorization and closing playback.
Consent recognition is configurable in Admin System: semantic mode remains the
default; the hybrid mode checks short replies locally before semantic fallback.
Realtime and legacy Live fallback remain explicit compatibility paths. The default
is Live with fallback disabled. Production deployment is a separate operation;
repository checks do not establish the currently deployed version.

## Develop

Requires Node.js >=22.19, Corepack/pnpm 10.12.4 and PostgreSQL 17 (Docker is provided).

    corepack pnpm install --frozen-lockfile
    corepack pnpm env:init
    corepack pnpm db:up
    corepack pnpm db:migrate
    corepack pnpm dev

Use an isolated development database and mock providers before opting into paid
provider requests. Configuration defaults and required secrets are documented in
[.env.example](.env.example). API and web are separate applications; see the
[engineer guide](docs/engineer-guide.md) for ownership, workflows and tests.

    corepack pnpm license:check
    corepack pnpm copy:check
    corepack pnpm db:migrate:check
    corepack pnpm lint
    corepack pnpm typecheck

Database tests require a dedicated test database. For a disposable full API run,
from apps/api use: node --import tsx scripts/test-isolated-db.mjs --reporter=dot.
Do not point tests at a working or production database. Build with corepack pnpm build.

## Current capabilities

- Public application and content in DE, FR, IT, RM, EN, RU and UK; separate interface,
  task and call languages, with original or translated plan approval receipts.
- Immutable approved plans, durable preparation with stage diagnostics, bounded
  retries, shared multiuser admission, role workers and recorded provider usage.
- Admin selection of the generation model and Standard/Fast without an evaluation
  prerequisite; fixed audit/review profiles and policy snapshots for existing jobs.
- Optional Swiss-only account phones for registration and phone changes, with
  matching forms and copy across all seven interface locales.
- Post-consent recording, Live transcripts and explicitly requested recording ASR;
  retention and deletion apply to recordings and derived export archives.
- Transactional credit reserve/charge/refund and versioned beta allowances by
  lifetime, UTC day, week or month without rollover; optional registration seats display.
- Admin expense/usage explorer, safety review of returned plan revisions, durable
  localized superadmin alerts, and telemetry exports with retained audio.

[Documentation index](docs/README.md) · [Current engineer guide](docs/engineer-guide.md) ·
[Preparation runtime](docs/preparation-runtime.md).
Historical evidence is under docs/archive/. Deployment runbooks and VPS topology
are local only under the ignored docs/local-operations/ directory.

Internal workspace package names remain callassist / @callassist/*.

## License

© 2026 Ivan Slavinskyi. All rights reserved. This repository is proprietary;
use requires prior written permission. See [LICENSE](LICENSE).
Third-party components retain their respective licenses and notices.
