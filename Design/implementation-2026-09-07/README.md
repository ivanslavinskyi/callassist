# Emerald Paper application review

> **Design record, 2026-09-07.** This is the accepted visual baseline or its exploration/QA history. Route states, fixtures and screenshots predate later language, appointment and result changes. Use the [current documentation](../../docs/README.md) for implemented behavior and remaining acceptance; this record does not describe a currently running preview.


The approved design is implemented in `apps/web`. This directory contains evidence and a disposable review backend; it is not imported by the application.

- [Coverage and route/state map](COVERAGE.md)
- [Project design QA](../../design-qa.md)
- `route-audit.json`: chronological browser measurements; earlier failures remain as iteration evidence.
- `final-route-audit.json`: latest valid route/section, width and theme measurements after fixes; regenerate with `python Design/implementation-2026-09-07/consolidate-review.py` from the repository root.
- Screenshot files retain the atlas `.png` names, but CUA returns JPEG-encoded bytes. Desktop/mobile filenames normally represent requested 1440x1024 / 390x844 CSS viewports; captured surfaces are 1425x1013 / 375x811 pixels. `workspace-empty-desktop-light.png` was captured at 1024x1024 and is state evidence only.

## Local preview

The review uses the actual Next application and API `buildApp`, with in-memory repositories, synthetic identities and mock verification/telephony providers. The recording is a generated 66-second silent WAV. No provider call, production database mutation or CMS publication is part of this review.

The historical fixture identities are defined by the disposable review backend;
credentials and generated IDs are not documented here. Restarting that backend
resets its in-memory data. The launch recipe below belongs to the dated design
review and has not been revalidated against later call/review contracts. Use the
root README for normal application startup.

To reproduce from the repository, run the review API from `apps/api`:

```powershell
$env:NODE_ENV = 'development'
node --import tsx ../../Design/implementation-2026-09-07/review-server.mts
```

In a second terminal, set these values only for the review process, then build/start the web app from the repository root:

```powershell
$env:NEXT_PUBLIC_API_URL = 'http://localhost:4040'
$env:INTERNAL_API_URL = 'http://localhost:4040'
$env:NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'
corepack pnpm --filter @callassist/web build
corepack pnpm --filter @callassist/web start --hostname 127.0.0.1
```

The normal project `.env` is unchanged. Stop the preview before using the same port for normal development. Browser checks here are bounded integration/visual evidence; R13 cross-browser, assistive-technology and exhaustive fault-state tests, and R06/R14 live-provider gates remain separate.
