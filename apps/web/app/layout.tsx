import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import { Toaster } from "@quagga/ui/components/toast";
import { ClientErrorCapture } from "@quagga/ui/components/client-error-capture";
import "@quagga/ui/styles.css";

// AfrikaBurn's brand face. Exposed as --font-brand; globals.css falls through
// to it from --font-sans. Body 500, headings up to 800.
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-brand",
  display: "swap",
});

const SITE_DESCRIPTION =
  "Register your theme camp, artwork, or mutant vehicle with AfrikaBurn — and earn the entitlements that come with it.";

export const metadata: Metadata = {
  title: "AfrikaBurn Contributors",
  description: SITE_DESCRIPTION,
  applicationName: "AfrikaBurn Contributors",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#17191b",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Dark-mode-first: the `dark` class pins the dusty dark palette. Light is
  // opt-in via a `light` class (see @quagga/ui globals.css).
  return (
    <html lang="en" className={`dark ${montserrat.variable}`}>
      <body className="font-sans antialiased">
        {/* Renders nothing. Fills the recent-errors buffer the reporter
            attaches — mounted at the root so it is already collecting by the
            time anybody notices something is wrong. */}
        <ClientErrorCapture />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
