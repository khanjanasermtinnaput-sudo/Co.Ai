import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { AppProviders } from "@/components/providers/app-providers";
import { PwaInstaller } from "@/components/pwa/pwa-installer";
import "./globals.css";

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
    default: "Coagentix — The professional AI platform",
    template: "%s · Coagentix",
  },
  description:
    "Coagentix is a professional AI platform. Chat with CoAI, build software with Coagentix Code, and manage your Projects — all in one premium workspace.",
  applicationName: "Coagentix",
  keywords: [
    "Coagentix", "CoAI", "Coagentix Code", "AI platform", "AI assistant",
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
    title: "Coagentix",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "Coagentix",
    title: "Coagentix — The professional AI platform",
    description:
      "Chat with CoAI, build software with Coagentix Code, and manage your Projects — all in one premium AI workspace.",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: "Coagentix" }],
  },
  twitter: {
    card: "summary_large_image",
    site: "@coagentix",
    creator: "@coagentix",
    title: "Coagentix — The professional AI platform",
    description:
      "Chat with CoAI, build software with Coagentix Code, and manage your Projects — all in one premium AI workspace.",
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
  themeColor: "#0A0A0A",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
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
