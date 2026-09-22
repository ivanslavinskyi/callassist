# OG template assets

`logo-light.svg` is a copy of the canonical `apps/web/public/brand/logo-light.svg`.
When changing the brand, update this copy and regenerate the fallback images.

`Roboto-Medium.ttf` is the static Roboto font distributed with pdfmake 0.3.11.
It includes Latin and Cyrillic glyphs. Its Apache 2.0 license is included here.
All image rendering uses these local files; there are no runtime font downloads.

Run `pnpm --filter @callassist/api og:build-fallbacks` after
changing the template, font, logo or default slogans. Commit the resulting seven
PNG files in `apps/web/public/og/home`. Increment the layout version in
`og-renderer.ts` whenever changing layout. Asset changes also change its digest.
