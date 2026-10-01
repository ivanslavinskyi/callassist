# Admin interface architecture

Status: implemented; updated 2026-09-22 for expenses, notifications, Analytics,
localized OG management and telemetry exports. The original design was accepted on 2026-08-27. Remaining admin
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

Since 2026-09-15, Operations separates **Goal achievement ? AI** from **Goal achievement ? user feedback**.
The former uses the latest attempt's canonical assessment (achieved/partial/not achieved/uncertain,
plus pending/unavailable/not assessed); its rate is achieved / all completed assessments, including
uncertain. The latter counts only the latest user answer per call (yes/partly/no/missing); its rate
is yes / received responses. Neither model decisions nor staff classification alter user responses.
Existing semantic outcomes and resolved-rate displays are explicitly labelled manual user/staff
classification. History, recent calls and Inspector share conversation/credit/assessment projection;
no-answer, no consent, analysis pending and analysis failure stay distinct. Counts retain the existing
call-created date scope and one-row-per-call unit; they are not per-turn classifier counts.

## Decision

Recent panels preserve these role boundaries: [expense explorer](cost-audit-2026-09-17/implementation.md)
is shared by operations and call/preparation inspectors; [notification settings](superadmin-notifications.md)
and [telemetry export](admin-call-telemetry-export.md) require superadmin.
Analytics settings are described in [localization and Analytics](localization-and-analytics.md).
Content-authorized staff manage [localized OG images](home-og-images.md) in SEO.
Export has a separate queue and status/heartbeat in Calls; general System job
diagnostics are not its queue monitor. Export selection uses attempt/preparation
time independently of Calls table filters and requires an audited content-access reason.

The administrative interface is a separate, primarily English application surface
under `/admin`. Since 2026-09-25, the registration-policy controls in System use all
seven UI locales. They independently select full/registration-time onboarding and
required/deferrable email, with revision checks and an audit reason. This does not
move admin routes under locale prefixes. See the
[registration implementation](registration-and-call-improvements-2026-09-25.md).

- Admin routes do not live below `[locale]`.
- Admin routes never use `/en/admin` or `/de/admin`.
- There are no rewrites or compatibility redirects for the removed localized
  admin routes. Those paths return `404`.
- The public and customer application is localized under `/de/*`, `/fr/*`, `/it/*`,
  `/rm/*`, `/en/*`, `/ru/*` and `/uk/*`.
- All seven locales are supported content locales inside the English admin UI. The
  interface language and the locale of edited or previewed content are separate
  concepts. Content locale syntax/storage is extensible (0067); all seven are
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

## Call result alignment - 2026-09-15

Call list and Inspector display the same latest-attempt lifecycle as customer history. Operations separates no answer, busy, explicit refusal, missing consent and confirmed conversations; technical-failure counters no longer include ordinary no-answer/refusal. Goal outcomes remain explicit user/staff feedback. The legacy outcome-metrics endpoint now derives technical failures from current durable evidence rather than historical snapshots. See [implementation and verification](call-lifecycle-history-2026-09-15.md).
