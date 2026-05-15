import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SWRegister } from "./SWRegister";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.kathakitaab.com"),
  title: "KathaKitaab — A Living Storybook Powered by AI",
  description: "Read it. Play it. Shape it. KathaKitaab is a clean AI-powered playable storybook where readers can enter a world, choose what happens next, and watch the story come alive.",
  keywords: ["interactive storybook", "AI storytelling", "playable book", "Ramayana", "story worlds"],
  applicationName: "KathaKitaab",
  // Next.js folds these into the rendered <head>. The manifest link
  // is what makes Chrome's Add-to-Home-Screen + Lighthouse PWA audit
  // recognise the app as installable, and Bubblewrap reads it to
  // build the Trusted Web Activity for the Play Store wrap.
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "KathaKitaab",
    statusBarStyle: "black-translucent",
  },
};

// Viewport metadata is its own export in Next 15 — the manifest's
// theme_color needs a matching <meta name="theme-color"> for both
// Chrome's address bar tint and the Android task switcher card.
export const viewport: Viewport = {
  themeColor: "#E8832A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body suppressHydrationWarning>
        {children}
        <SWRegister />
      </body>
    </html>
  );
}
