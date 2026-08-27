# Admin interface architecture

Status: accepted for implementation on 2026-08-27.

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
  concepts.
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
