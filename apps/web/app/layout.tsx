import type { Metadata, Viewport } from "next";
import { Toaster } from "@quagga/ui/components/toast";
import { Providers } from "./providers";
import "@quagga/ui/styles.css";

const SITE_DESCRIPTION =
  "Register your theme camp, artwork, or mutant vehicle with AfrikaBurn — and earn the entitlements that come with it.";

export const metadata: Metadata = {
  title: "AfrikaBurn Contributors",
  description: SITE_DESCRIPTION,
  applicationName: "AfrikaBurn Contributors",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#141210",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Dark-mode-first: the `dark` class pins the dusty dark palette. Light is
  // opt-in via a `light` class (see @quagga/ui globals.css).
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
