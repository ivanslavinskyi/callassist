# Next ESLint glob replacement

`@next/eslint-plugin-next@15.5.26` uses `fast-glob` only in `getRootDirs()`.
That dependency introduces `micromatch → braces`, affected by
[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
No fixed `braces` release was available on 2026-10-04.

The version-scoped pnpm override resolves that one dependency to `glob@13.0.6`.
The patch adapts its `globSync()` result to directories only, returning full
paths for Next's root-directory consumers. The existing `brace-expansion`
security override also applies to glob's transitive dependencies. Framework
versions, application dependencies and lint rules are unchanged. The vulnerable
`braces`/`micromatch` chain is absent from the lockfile; no audit exclusions exist.

`apps/web/lib/next-eslint-glob.test.ts` exercises the installed patched plugin,
including explicit roots without descendant expansion, glob/brace patterns,
arrays, relative/Windows paths, symlinks/junctions, nonexistent directories and
file exclusion.
Normal lint and the Next production build verify the actual configuration.

Keep the override and patch together. On a Next lint-plugin update, review its
glob usage and either remove both after the upstream dependency is safe or port
the patch and rerun the compatibility tests, frozen-lockfile install and full
dependency audit. The patch modifies third-party MIT-licensed Next code; its
upstream license continues to apply.
