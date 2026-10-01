# Homepage social images

The SEO console at `/admin/seo` manages homepage Open Graph and Twitter images for
every enabled UI locale. Content editors, admins and superadmins use the existing
content authorization and onboarding checks. The console's interface is English,
consistent with the rest of the admin area; image slogans are localized.

## Editing and publishing

- Select a language, edit its slogan, and generate a preview. The source logo and
  Roboto font are bundled locally. Font metrics reject missing glyphs or text
  that would exceed two lines at 48–56 px. No AI or external font service is used.
- Alternatively, upload a still PNG, JPEG or WebP, describe it, and adjust the
  crop using horizontal/vertical positioning and zoom. The server decodes and
  verifies the original, applies EXIF orientation, crops, flattens transparency,
  strips metadata and encodes an sRGB PNG at 1200 × 630.
- Upload limits: 5 MiB, 24 megapixels, selected crop at least 600 × 315. Files with
  unsupported formats, animation, invalid pixels or oversized output are rejected.
- Saving produces a private draft. Publishing explicitly switches the live image.
  The panel displays the latest 50 versions and offers a previous-version preview
  and restoration. Previously published image URLs remain valid.
- Generate all templates processes locales sequentially and preserves locales
  whose current draft, or published version if there is no draft, is a manual
  upload. It reports per-locale failures and never publishes automatically.
- Revision checks reject stale writes from another tab/session. Rendering failure
  leaves published data untouched. Render concurrency is bounded to two per API
  process; content mutation endpoints use the shared application rate limiter.

## Storage and delivery

Migration `0078_home_og_images.sql` adds immutable PNG assets, version records,
locale publication pointers and audit events. Production uses PostgreSQL via
`STORAGE_DRIVER=postgres`; memory mode follows the existing development behavior
and is ephemeral. Include these tables in normal database backups. There is no
filesystem upload directory or external object-storage dependency.

The public pointer API is `GET /api/content/og`. It performs one small SQL query
and is uncached. Next reads this during homepage metadata generation using
`cache: no-store`. This updates OG and Twitter tags on the next page request
without depending on revalidation webhooks or the CMS's 60-second content cache.
Published bytes are served at `/media/og/home/<locale>/<sha256>.png` on the web
origin, proxied from `/api/content/og/<locale>/images/<sha256>.png`. Successful
responses carry an ETag and `public, max-age=31536000, immutable`. Failures are
never cached under an immutable URL. HEAD and conditional GET are supported.

Private previews are fetched with the editor's API session and displayed using
blob URLs; preview responses are `private, no-store`. The public image endpoint
only permits versions published at least once in that locale.

Bundled `/og/home/<locale>.png` images provide defaults before first publication
and when pointer lookup is temporarily unavailable. Both image URL prefixes
bypass language-negotiation middleware. The old `/<locale>/opengraph-image` URL
remains as a noncached redirect. The special `opengraph-image.tsx` metadata file
was removed to prevent it overriding the published selection.

Social platforms may retain an already-shared card until they fetch the page
again. Each changed image has a new content-hash URL; old files are retained.

## Deployment and maintenance

The 23 September security update uses patched Satori 0.33.5 directly with sharp
0.35.4 for PNG output. Updating only a transitive Satori resolution cannot repair code
bundled inside an older `@vercel/og` release. Install the committed lockfile and rebuild/restart
the API. The template is now v3; previously published PNGs remain valid. In the admin
editor, generated/upload branches have separate React keys, so switching to a file
input does not reuse the controlled slogan input. See the [audit](release-audit-2026-09-23.md).

1. Install dependencies with the committed pnpm lockfile.
2. Apply normal database migrations before starting the updated API.
3. Build and deploy the API and web together. API build copies local logo/font
   assets to `dist/og/assets`; static fallback PNGs are committed with the web app.
4. Verify `/admin/seo`, publish a test locale, then inspect its public OG/Twitter
   tags and anonymous PNG response.

After changing the template, logo, font or default slogans, run
`pnpm --filter @callassist/api og:build-fallbacks` and commit the fallback PNGs.
Update the local logo copy when changing the canonical brand SVG and increment
the layout version. Existing published images intentionally retain their original
appearance until new versions are generated and published in the console.

Focused checks cover rendering and glyph/layout validation, upload normalization,
authorization, origin checks, private drafts, immutable caching, stale-write
conflicts, PostgreSQL reconnect/publication/audit, localized metadata and middleware.
The PostgreSQL integration test requires a dedicated `*_test` database via
`TEST_DATABASE_URL`, as do the project's existing database suites.
