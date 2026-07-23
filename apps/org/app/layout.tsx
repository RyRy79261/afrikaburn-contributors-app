import type { Metadata, Viewport } from "next";
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
  themeColor: "#141210",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
