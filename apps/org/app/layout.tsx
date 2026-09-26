import type { Metadata, Viewport } from "next";
import { brandFont } from "@quagga/ui/fonts/brand";
import { Toaster } from "@quagga/ui/components/toast";
import { ClientErrorCapture } from "@quagga/ui/components/client-error-capture";
import { QuiltBand } from "@quagga/ui/components/quilt-band";
import "@quagga/ui/styles.css";

export const metadata: Metadata = {
  title: "AfrikaBurn Organiser Console",
  description:
    "The AfrikaBurn organiser console — review registrations and manage accounts. Restricted to org staff.",
  applicationName: "AfrikaBurn Organiser Console",
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
  // Dark-mode-first, same surfaces as apps/web — but the console wears the
  // `.org-accent` skin (interactive colour → apricot) plus the quilt band so it
  // is never mistaken for the participant app.
  return (
    <html lang="en" className={`dark org-accent ${brandFont.variable}`}>
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
