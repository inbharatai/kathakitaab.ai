import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SWRegister } from "./SWRegister";

export const metadata: Metadata = {
  metadataBase: new URL("https://kathakitaab.com"),
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
      // Next.js App Router auto-detects app/favicon.ico, but we keep the
      // explicit reference so Vercel and search engines see it directly.
      { url: "/favicon.ico", sizes: "256x256", type: "image/x-icon" },
      // app/icon.png is the canonical App Router icon (192×192).
      { url: "/icon.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    // app/apple-icon.png is auto-detected by Next.js; we also keep the
    // legacy public/apple-touch-icon.png for backward compatibility.
    apple: [
      { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  openGraph: {
    title: "KathaKitaab — A Living Storybook Powered by AI",
    description: "Read it. Play it. Shape it. KathaKitaab is a clean AI-powered playable storybook where readers can enter a world, choose what happens next, and watch the story come alive.",
    url: "https://kathakitaab.com",
    siteName: "KathaKitaab",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "KathaKitaab — AI-powered interactive Indian storybooks",
      },
    ],
    locale: "en_IN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "KathaKitaab — A Living Storybook Powered by AI",
    description: "Read it. Play it. Shape it. AI-powered Indian storybooks that come alive.",
    images: ["/og-image.png"],
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
