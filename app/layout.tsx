import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import MotionHooks from "@/src/motion/MotionHooks";
import { publicBaseUrl } from "@/lib/server-api";

const geist = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], preload: false }) // QA P2 LCP: only the body font is preloaded;
const serif = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"], preload: false });

export const metadata: Metadata = {
  metadataBase: publicBaseUrl(), // W2: absolute og:image / twitter:image
  title: "Quiver — AI strategy builder for Robinhood Chain",
  description: "Describe a trade in plain English. Quiver drafts it as a node graph across Robinhood Chain, Solana, Hyperliquid and Polymarket, then paper-trades it live.",
};
export const viewport: Viewport = { themeColor: "#0A0A0B", viewportFit: "cover", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${serif.variable} antialiased`}>
      <body className="min-h-dvh">{children}<MotionHooks /></body>
    </html>
  );
}
