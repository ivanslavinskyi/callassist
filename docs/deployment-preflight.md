# Deployment preflight and first release

Updated 2026-09-23. B06 remains open. The owner chose `shprohli.ch` for the first
deployment with temporary restricted access, on an existing VPS that already serves
another Next.js project. B07 landing changes are now implemented and published locally;
VPS topology and access details remain to be supplied before deployment.
A separate staging hostname/server is not a release requirement; external acceptance
can run on the final domain before public access opens.

The latest local checkpoint includes source migrations through 0080, corrected spending
reconciliation, the 20,000-token compiler ceiling and the
[preparation/review/call UI update](workflow-feedback-2026-09-15.md), followed by
[distinct call results, history and admin metrics](call-lifecycle-history-2026-09-15.md).
It also includes the [16 September landing, language and opt-out changes](delivery-2026-09-16.md).
Apply migrations through 0080 before restarting every updated API/worker. Old workers refund immediately and must not coexist with the new final-assessment settlement path.

The [superadmin notification layer](superadmin-notifications.md) requires the same
`EMAIL_DRIVER`, `RESEND_API_KEY`, `EMAIL_FROM`, and `NEXT_PUBLIC_SITE_URL` on API and
external worker. Migration 0077 creates an initially disabled queue configuration;
choose verified superadmin recipients and enable categories in Admin > System.
Existing registrations and calls are not backfilled.
Local budget settings (revision 3: 20 USD/24 h, 0.60 USD/call minute,
0.15 USD/paid text) must be explicitly checked/configured in the deployment;
they are not transferred by pushing the repository. The 16 September local API,
web and contracts checks do not replace the release-candidate and provider drills.

For 0075, configure a dedicated `TWILIO_OPT_OUT_VERIFY_SERVICE_SID` on the API,
different from account Verify, and an independent stable 32-byte base64
`RECIPIENT_CONTACT_HASH_KEY` shared by every API/worker. Production validation rejects
missing settings; the contact key must differ from data-encryption keys. Preserve it
in protected recovery configuration rather than rotating it with encryption keys.
Initialization backfills trusted contact evidence; ambiguous historical destinations
stay queued for manual reconciliation. Review [the rollout procedure](recipient-opt-out.md).

## Additions for the 22 September candidate

Follow the [17–22 September delivery record](delivery-2026-09-22.md) as well as the
older acceptance evidence. Migrations 0076–0079 cover expenses, notifications, OG
images and telemetry exports; verify the target database rather than inferring its
state from the source catalog. The current candidate also requires migration 0080 for feedback re-encryption
after privacy redaction. Check the target migration ledger; source/CI state does
not prove the target has been migrated. See the [23 September audit](release-audit-2026-09-23.md).

- Deploy the same API/worker revision and keyring. Verify the export consumer
  heartbeat in Calls; `ADMIN_TELEMETRY_EXPORT_ENABLED=false` disables it. PostgreSQL
  17 is required. Check TTL cleanup and source-deletion revocation.
- Verify billing sync scope/credentials without treating account billing as another
  per-call charge. Unknown historic usage remains explicitly incomplete.
- Notifications default to disabled; select eligible recipients and verify real
  email delivery separately. Their bodies use recipient locale, while Admin is English.
- API build must include OG logo/font assets; web contains seven fallback PNGs.
  Verify published OG/Twitter tags and immutable anonymous image delivery.
- Local CMS r10/translation completion is not a production content update. Review
  the target revisions, seven locale routes, RM copy and Analytics/privacy policy.
- On restore, invalidate telemetry archives before exposing traffic and perform
  deletion/suppression replay. See [recovery](database-recovery-and-secrets.md).

## Implemented preparation

Run `corepack pnpm deployment:check` against the intended combined deployment
configuration. The built API package also provides `deployment:check:prod`.
This read-only command validates production API/worker configuration, public web/API
origins, private SSR origin, explicit feature flags, text directions and email branding.
Its report excludes configuration values and secrets. It does not connect to the
database or providers, change settings, or approve public release.

The supported preflight profile uses one browser origin: `NEXT_PUBLIC_SITE_URL` and
`NEXT_PUBLIC_API_URL` both point to `https://shprohli.ch`. The existing reverse proxy
must route `/api/*` to Fastify and other page requests to Next.js. SSR uses the private
`INTERNAL_API_URL`. This keeps the host-only production session cookie available to
both browser API requests and Next.js SSR. Public web values must be set at build time.

The Twilio-only listener uses a separate HTTPS callback hostname and
`PUBLIC_BASE_URL`; its concrete hostname is not yet selected. `TWILIO_WEBHOOK_HOST`
defaults to `127.0.0.1`; a private container may explicitly use `0.0.0.0` without
publishing that port. Keep the main API and Twilio listener isolated behind the proxy.
Do not apply a browser login wall to signed Twilio callbacks/Media Streams.

`TRUSTED_PROXY_CIDRS` configures Fastify's trusted peers. Production API startup requires
an explicit value: reviewed literal IPs/CIDRs, or `none` for direct ingress. Boolean
trust-all, hop counts, named networks and `/0` are rejected. Default development
behavior remains direct-peer IP. The edge must discard untrusted forwarded headers;
the API port must not be publicly reachable around that edge. An untrusted direct peer
cannot change its rate-limit identity by supplying `X-Forwarded-For`.
See the [Fastify trustProxy reference](https://fastify.dev/docs/latest/Reference/Server/#trustproxy).

## What remains before deploying

- Inspect the VPS OS, existing process supervisor, reverse proxy, port allocation,
  database/backup setup and an owner-provided SSH alias. Preserve the existing project;
  do not install a competing listener on ports 80/443.
- Select isolated SHPROHLI processes, database and secrets. The current production
  database validator rejects loopback URLs; reconcile this deliberately with the chosen
  private database topology. Do not falsify `NODE_ENV` to bypass validation.
- Prepare deployment/restart/migration/rollback commands for that actual host.
  This preflight is not a packaging script, container image or server configuration.
- Configure DNS/TLS and temporary site access. Check email links and signed Twilio
  HTTP/WebSocket callbacks under the access policy. Keep secrets out of web build output.
- Configure and accept the separate opt-out Verify Service's sender, locales,
  geo/fraud and spending controls. Check proven-contact success, missed-call
  eligibility, generic unknown-number behavior and manual support for non-SMS numbers.
- Verify secure cookies, login through SSR, CORS/CSRF, separate client IP limits,
  spoofed headers, SSE streaming/reconnect and Twilio WebSocket upgrades externally.
  Check guest/authenticated landing CTAs, login/register redirects, session-check
  failure/retry and session changes across tabs on the final hostname.
  Proxies must preserve streaming; see the [Next.js self-hosting guide](https://nextjs.org/docs/app/guides/self-hosting).
- Compare effective API/worker settings on the running host, migrate the database,
  set the USD budget, test restart recovery, alerts/stop and backup/restore. Checking a
  combined env file cannot prove that the deployed processes received identical settings.

Original local verification of the proxy preparation: 79 tests across proxy policy, runtime
configuration, deployment check and auth API; repository lint/typecheck; API production
build including the new CLI. No external deployment, DNS changes or provider dispatches
were performed. The earlier 1,163-test beta-controls checkpoint is separate evidence.
Current implementation checks, including production validation of both new opt-out
settings, are recorded in [delivery, 2026-09-16](delivery-2026-09-16.md).
