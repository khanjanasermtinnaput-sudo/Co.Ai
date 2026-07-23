import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { AppProviders } from "@/components/providers/app-providers";
import { PwaInstaller } from "@/components/pwa/pwa-installer";
import "./globals.css";
import "katex/dist/katex.min.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const SITE_URL = "https://coagentix.app";
const OG_IMAGE = `${SITE_URL}/og-image.png`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Co.AI – Multi-Agent AI Platform",
    template: "%s · Co.AI",
  },
  description:
    "Co.AI is an advanced multi-agent AI platform with intelligent routing, RAA, TMAP orchestration, memory, and multi-agent workflows — built by CoAgentix.",
  applicationName: "Co.AI",
  keywords: [
    "Co.AI", "CoAI", "CoCode", "AI platform", "AI assistant",
    "AI coding", "multi-agent AI", "AI development platform",
  ],
  authors: [{ name: "Coagentix", url: SITE_URL }],
  creator: "Coagentix",
  publisher: "Coagentix",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Co.AI",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "Co.AI",
    title: "Co.AI – Multi-Agent AI Platform",
    description:
      "Chat with Co.AI, build software with CoCode, and manage your Projects — all in one advanced multi-agent AI workspace.",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Co.AI" }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@coagentix",
    creator: "@coagentix",
    title: "Co.AI – Multi-Agent AI Platform",
    description:
      "Chat with Co.AI, build software with CoCode, and manage your Projects — all in one advanced multi-agent AI workspace.",
    images: [OG_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  alternates: { canonical: SITE_URL },
};

export const viewport: Viewport = {
  themeColor: "#131519",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh bg-background font-sans">
        <AppProviders>{children}</AppProviders>
        <PwaInstaller />
      </body>
    </html>
  );
}
