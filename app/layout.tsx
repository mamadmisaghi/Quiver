import type { Metadata, Viewport } from "next";
import "./fonts.css";
import "./globals.css";
import "./design.css";
import { DESIGN } from "@/lib/design";
import MotionHooks from "@/src/motion/MotionHooks";
import { publicBaseUrl } from "@/lib/server-api";


export const metadata: Metadata = {
  metadataBase: publicBaseUrl(), // W2: absolute og:image / twitter:image
  title: "Quiver — AI strategy builder for Robinhood Chain",
  description: "Describe a trade in plain English. Quiver drafts it as a node graph across Robinhood Chain, Solana, Hyperliquid and Polymarket, then paper-trades it live.",
};
export const viewport: Viewport = { themeColor: "#0A0A0B", viewportFit: "cover", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html data-design={DESIGN} lang="en" className="antialiased">
      <head><link rel="preload" href="/fonts/geist-98bbbccb.woff2" as="font" type="font/woff2" crossOrigin="anonymous" /></head>
      <body className="min-h-dvh">{children}<MotionHooks /></body>
    </html>
  );
}
