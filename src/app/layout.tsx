import type { Metadata } from "next";
import localFont from "next/font/local";
import { Analytics } from "./Analytics";
import { AnalyticsHeartbeat } from "./AnalyticsHeartbeat";
import { WhatsNewGate } from "@/components/WhatsNewGate";
import "./globals.css";

const monocraft = localFont({
  src: [
    { path: "./fonts/Monocraft-ExtraLight.ttf", weight: "200", style: "normal" },
    { path: "./fonts/Monocraft-Light.ttf", weight: "300", style: "normal" },
    { path: "./fonts/Monocraft.ttf", weight: "400", style: "normal" },
    { path: "./fonts/Monocraft-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/Monocraft-Bold.ttf", weight: "700", style: "normal" },
    { path: "./fonts/Monocraft-Black.ttf", weight: "900", style: "normal" },
  ],
  variable: "--font-minecraft",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://gtnhplanner.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "GTNH Planner",
  title: "GTNH Planner | GregTech New Horizons Factory Calculator",
  description:
    "Plan and optimize GregTech: New Horizons factories on an interactive flowchart. Full recipe data for GTNH 2.8.4 and 2.9, throughput and power calculation, machine ratios, and community-shared plans.",
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  keywords: [
    "GTNH Planner",
    "GregTech New Horizons planner",
    "GTNH factory planner",
    "GTNH recipe calculator",
    "GTNH throughput calculator",
    "GregTech factory calculator",
  ],
  openGraph: {
    title: "GTNH Planner | GregTech New Horizons Factory Calculator",
    description:
      "Free factory planner for GregTech: New Horizons with full recipe data for GTNH 2.8.4 and 2.9. Draw production chains, balance machine ratios, find bottlenecks, and share plans with the community.",
    siteName: "GTNH Planner",
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "GTNH Planner | GregTech New Horizons Factory Calculator",
    description:
      "Free factory planner for GregTech: New Horizons with full recipe data for GTNH 2.8.4 and 2.9. Draw production chains, balance machine ratios, find bottlenecks, and share plans with the community.",
  },
  icons: {
    icon: "/site-icon.png",
    shortcut: "/site-icon.png",
    apple: "/site-icon.png",
  },
  other: {
    // The app is already dark. Without this, the Dark Reader extension
    // darkens it a second time and rewrites inline styles before React
    // hydrates, which both wrecks the palette and throws hydration mismatches.
    // Next drops metadata entries with an empty content value, so this carries
    // one even though Dark Reader only checks that the tag exists.
    "darkreader-lock": "true",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${monocraft.variable} h-full`}>
      <body className="min-h-full">
        {children}
        {/* Above the app rather than inside it: what changed is a fact about
            the whole planner, not about whichever tab happens to be open. */}
        <WhatsNewGate />
        <Analytics />
        <AnalyticsHeartbeat />
      </body>
    </html>
  );
}
