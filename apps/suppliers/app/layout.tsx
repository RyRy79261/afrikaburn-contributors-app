import type { Metadata, Viewport } from "next";
import { brandFont } from "@quagga/ui/fonts/brand";
import { Toaster } from "@quagga/ui/components/toast";
import { ClientErrorCapture } from "@quagga/ui/components/client-error-capture";
import { QuiltBand } from "@quagga/ui/components/quilt-band";
import "@quagga/ui/styles.css";

export const metadata: Metadata = {
  title: "AfrikaBurn Supplier Portal",
  description:
    "The AfrikaBurn Supplier Portal — register, complete your Supplier Depot onboarding, and check your standing. For registered suppliers to creative projects.",
  applicationName: "AfrikaBurn Supplier Portal",
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
  // Dark-mode-first, same surfaces as apps/web + apps/org — but the portal
  // wears the `.supplier-accent` skin (interactive colour → sage/olive) plus
  // the quilt band, so it is never mistaken for the participant (teal) or
  // organiser (apricot) apps.
  return (
    <html lang="en" className={`dark supplier-accent ${brandFont.variable}`}>
      <body className="font-sans antialiased">
        {/* Renders nothing. Fills the recent-errors buffer the reporter
            attaches. Mounted at the root so it is already collecting by the
            time anybody notices something is wrong. */}
        <ClientErrorCapture />
        <QuiltBand />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
