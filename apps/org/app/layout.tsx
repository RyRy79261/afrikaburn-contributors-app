import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import { Toaster } from "@quagga/ui/components/toast";
import { QuiltBand } from "@quagga/ui/components/quilt-band";
import { Providers } from "./providers";
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
  title: "AfrikaBurn Organiser Console",
  description:
    "The AfrikaBurn organiser console — review registrations, manage accounts, and track payment references. Restricted to org staff.",
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
    <html lang="en" className={`dark org-accent ${montserrat.variable}`}>
      <body className="font-sans antialiased">
        <QuiltBand />
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
