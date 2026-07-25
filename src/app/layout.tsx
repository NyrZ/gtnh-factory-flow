import type { Metadata } from "next";
import localFont from "next/font/local";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { Analytics } from "./Analytics";
import { AnalyticsHeartbeat } from "./AnalyticsHeartbeat";
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

export const metadata: Metadata = {
  metadataBase: new URL("https://gtnh.samiracle.fr"),
  applicationName: "GTNH Planner",
  title: "GTNH Planner | GregTech New Horizons Factory Calculator",
  description:
    "Plan and optimize GregTech: New Horizons factories with a GTNH recipe flowchart, throughput calculator, machine ratios, and dataset-backed production chains.",
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
      "Build GTNH recipe flowcharts, calculate throughput, balance machine ratios, and plan production chains for GregTech: New Horizons.",
    siteName: "GTNH Planner",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "GTNH Planner | GregTech New Horizons Factory Calculator",
    description:
      "Build GTNH recipe flowcharts, calculate throughput, balance machine ratios, and plan production chains for GregTech: New Horizons.",
  },
  icons: {
    icon: "/site-icon.png",
    shortcut: "/site-icon.png",
    apple: "/site-icon.png",
  },
  other: {
    // The app ships its own light and dark themes. Without this, the Dark
    // Reader extension darkens the page a second time and rewrites inline
    // styles before React hydrates, which both wrecks the palette and throws
    // hydration mismatches.
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
    // The theme script below sets data-theme on <html> before hydration, so the
    // server and client markup differ here by design.
    <html lang="en" className={`${monocraft.variable} h-full`} suppressHydrationWarning>
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {children}
        <Analytics />
        <AnalyticsHeartbeat />
      </body>
    </html>
  );
}
