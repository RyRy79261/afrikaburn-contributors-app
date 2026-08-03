import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import { Toaster } from "@quagga/ui/components/toast";
import { ClientErrorCapture } from "@quagga/ui/components/client-error-capture";
import { QuiltBand } from "@quagga/ui/components/quilt-band";
import "@quagga/ui/styles.css";

// AfrikaBurn's brand face. Exposed as --font-brand; globals.css falls through
// to it from --font-sans. Body 500, headings up to 800.
const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-brand",
  display: "swap",
});

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
    <html lang="en" className={`dark supplier-accent ${montserrat.variable}`}>
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
