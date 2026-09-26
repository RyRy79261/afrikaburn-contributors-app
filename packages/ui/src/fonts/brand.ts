import localFont from "next/font/local";

// AfrikaBurn's brand face, exposed as --font-brand; globals.css falls through
// to it from --font-sans. Body 500, headings up to 800.
//
// Self-hosted (packages/ui/fonts/montserrat/, provenance in its README) rather
// than `next/font/google`, so `next build` makes no Google Fonts request — a
// network blip there failed the whole build, in CI and in e2e:local.
export const brandFont = localFont({
  src: [
    {
      path: "../../fonts/montserrat/montserrat-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../fonts/montserrat/montserrat-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../fonts/montserrat/montserrat-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../../fonts/montserrat/montserrat-latin-800-normal.woff2",
      weight: "800",
      style: "normal",
    },
  ],
  variable: "--font-brand",
  display: "swap",
});
