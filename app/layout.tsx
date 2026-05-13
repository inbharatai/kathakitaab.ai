import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KathaKitaab — A Living Storybook Powered by AI",
  description: "Read it. Play it. Shape it. KathaKitaab is a clean AI-powered playable storybook where readers can enter a world, choose what happens next, and watch the story come alive.",
  keywords: ["interactive storybook", "AI storytelling", "playable book", "Ramayana", "story worlds"],
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
      </body>
    </html>
  );
}
