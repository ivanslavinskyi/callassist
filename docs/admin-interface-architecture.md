# Admin interface architecture

Status: implemented; updated for B02 remediation on 2026-09-13 (working tree based
on `ef36cfa`). The original design was accepted on 2026-08-27. Remaining admin
workflows are tracked under B08 in the [current roadmap](mvp-plan.md).

System diagnostics project an explicit public durable-job DTO shared by memory and
PostgreSQL; internal targets such as `textArtifactId` and lease-owner data are not
included. The outbound control is rendered and loaded independently of diagnostics.
`GET` and `PUT /api/admin/system/outbound-calls` return only `{ outboundCalls }`.
The write commits its audit event and returns the written state without rebuilding
the system dashboard. Both routes remain private/no-store and role-protected;
only superadmin can enable calls. Unknown state offers disable only. This switch
prevents new calls; it does not terminate calls already in progress.

Since 2026-09-14, **Beta access and spending** is another independent System panel.
Administrators can read `/api/admin/system/beta`; only superadmins may update settings,
create additional one-use invitations or revoke them. Updates require a reason and
matching settings revision. Invitation codes are shown once; only their hashes are
stored. UI errors do not pretend an uncertain write failed before commit: refresh
is required to inspect the current state. See [beta controls](beta-controls-2026-09-14.md)
for public admission, USD budget, call duration/concurrency and stop semantics.

## Decision

The administrative interface is a separate, English-only application surface
under `/admin`.

- Admin routes do not live below `[locale]`.
- Admin routes never use `/en/admin` or `/de/admin`.
- There are no rewrites or compatibility redirects for the removed localized
  admin routes. Those paths return `404`.
- The public and customer application remains localized under `/en/*` and
  `/de/*`.
- German remains a supported content locale inside the English admin UI. The
  interface language and the locale of edited or previewed content are separate
  concepts. Content locale syntax/storage is extensible (0067); EN/DE remain the
  enabled customer UI dictionaries. Publishing a localization does not enable a UI.
- The customer shell contains at most one role-gated entry point to `/admin`;
  individual admin functions are shown only inside the admin shell.

## Route and layout boundaries

`app/admin/layout.tsx` owns authentication, onboarding and broad staff access.
The console and content-preview experiences are separate route groups:

```text
app/admin/
  layout.tsx
  (console)/
    layout.tsx       # AdminShell
    page.tsx
    calls/
    users/
    credits/
    safety/
    system/
    content/
    seo/
  (preview)/
    layout.tsx       # content authorization + fixed English public shell context
    content/
```

Preview routes stay outside `AdminShell` so a public-page preview is not nested
inside administrative chrome.

## Role model

- `content_editor`: content pages, editorial collections and SEO.
- `admin`: all content areas plus overview, calls, users, credits, safety and
  system operations.
- `superadmin`: the same navigation as admin; sensitive or destructive
  capabilities remain guarded by their existing API permissions.
- `user` and `support`: no admin interface access.

Navigation visibility is not an authorization boundary. Server layouts and
every `/api/admin/*` endpoint continue to enforce access independently.
