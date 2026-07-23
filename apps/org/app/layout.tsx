import type { Metadata, Viewport } from "next";
import { Toaster } from "@quagga/ui/components/toast";
import { Providers } from "./providers";
import "@quagga/ui/styles.css";

export const metadata: Metadata = {
  title: "AfrikaBurn Organiser Console",
  description:
    "The AfrikaBurn organiser console — review registrations, manage accounts, and track payment references. Restricted to org staff.",
  applicationName: "AfrikaBurn Organiser Console",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#d98324",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Dark-mode-first, same tokens as apps/web — but the console wears the ochre
  // accent (see the top rule + header) so it is never mistaken for the
  // participant app.
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">
        <div className="h-1 w-full bg-accent" aria-hidden />
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
