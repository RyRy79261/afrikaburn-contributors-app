# Montserrat (self-hosted)

AfrikaBurn's brand face, loaded by `src/fonts/brand.ts` through
`next/font/local` so `next build` never fetches from Google Fonts.

- **Source:** `@fontsource/montserrat@5.3.0` (npm), files
  `files/montserrat-latin-{500,600,700,800}-normal.woff2`, copied unmodified.
- **Licence:** SIL Open Font License 1.1 — `OFL.txt`, copied from the same
  package. Copyright 2011 The Montserrat Project Authors
  (https://github.com/JulietaUla/Montserrat).
- **Subset:** latin only, the same subset the `next/font/google` call used.

To update: take the same four files and the licence from a newer Fontsource
release, and change the version above.
