# Transcript PDF layout restoration — 2026-09-09

The revision-aware export had introduced a second, minimal PDF renderer. It put
source UUIDs beside each turn and lost the typography, speaker colors, metadata
rows and page footer of the earlier transcript export.

Both PDF entry points now adapt their data into `transcript-pdf-layout.ts`.
The shared A4 layout uses the current `public/brand/logo-light.svg` as actual
vector artwork, the existing dark/green palette, a timestamp gutter, readable
speaker headings, call metadata and page numbering. Browser export loads the
same-origin logo on demand and caches it for subsequent downloads; a failed load
can be retried through the existing export error action.

The translated variant is explicitly labelled, including its text language.
Source revision and SHA-256 remain searchable in a secondary block at the end.
Exact source-segment IDs are embedded as named PDF destinations instead of being
printed in the conversation. A source-revision timestamp is labelled as transcript
creation, never as the time the call ended. Unknown speaker/timestamp data is not
invented. Copy-text exports and filenames are unchanged.

Long turns can continue across pages. The page-break callback keeps speaker
headings with the first text on their page without making a whole turn unbreakable.

## Verification

- 20 tests across the legacy export, derived result projection and shared PDF
  data-contract suites passed; web typecheck and lint passed.
- `apps/web/scripts/verify-transcript-pdf.ts` generates synthetic PDFs through
  the actual builders using the current SVG. Fixtures cover both export paths,
  German UI, Russian translation, Ukrainian text, unknown speakers, null times,
  recordings without segments, and a turn longer than a page.
- Parsed PDFs preserve expected text, exact source destinations, hashes and
  page counters. The long-turn fixture retains every numbered part from 1 to 90
  in sequence, followed by its ending and the next turn.
- A seventh fixture has 40 varied turns across five pages. All 40 speaker
  destinations share a page with the start of their text; there are no orphaned
  headings, missing/duplicate body markers or incorrect page counters. All seven
  PDFs pass non-whitespace glyph-boundary checks against the print margins.
- A new one-page preview was rendered from the transcript in the user's supplied
  September PDF and visually compared with the earlier August PDF. It retains
  all seven turns, speaker attribution, timestamps, source revision and hash.
  The source date comes from the supplied filename; its unknown exact time is
  omitted. The private preview and input renders are in `.tools/pdf-redesign`,
  excluded from Git. The supplied files in Downloads were not overwritten.

No real call, provider request, database change or runtime restart is part of
this change. The running development frontend picks up the updated export code.
