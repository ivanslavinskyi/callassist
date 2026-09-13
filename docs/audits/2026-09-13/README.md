# Evidence — public testing audit, 2026-09-13

See the [full audit](../../public-testing-audit-2026-09-13.md) and [current roadmap](../../mvp-plan.md).

This directory's original evidence predates B01/B02 remediation. See the [follow-up evidence](b01-b02/evidence.json) and [remediation report](../../b01-b02-remediation-2026-09-13.md) for the latest dependency/System results.

`evidence.json` contains the sanitized local check summary, HTTP statuses and CMS revision numbers. It contains no session cookies, passwords, OTPs, database connection URLs or provider keys. UUIDs in HTTP paths are replaced with `[fixture-id]`.

The 15 PNG captures were taken from the current local web application with an isolated in-memory API, mock providers and fictional accounts/phone numbers. The CMS was populated from the source seed. These screenshots do not establish the state of the local PostgreSQL publication or a production deployment. Code findings and read-only PostgreSQL verification are distinguished in the report.

Desktop captures use a 1440 px viewport; German landing uses 390 px, email form 320 px. The final Pages capture uses the restored default browser viewport. Captures were opened and visually inspected after saving. An unreliable stitched full-page capture and redundant/off-target captures were excluded. Original local logs and private fixture sessions remain outside versioned evidence under the ignored audit directory.

The historical dependency acceptance is superseded by the fresh failing audit. Full-suite success is from a new isolated test database; the pre-existing test database checksum mismatch was preserved and reported.
