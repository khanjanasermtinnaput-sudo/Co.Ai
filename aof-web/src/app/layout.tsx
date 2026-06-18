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

export const metadata: Metadata = {
  title: {
    default: "CoAgentix — The professional AI platform",
    template: "%s · CoAgentix",
  },
  description:
    "CoAgentix is a professional AI platform. Chat with CoAI, build software with CoAgentix Code, and manage your Projects — all in one premium workspace.",
  applicationName: "CoAgentix",
  keywords: ["CoAgentix", "AI platform", "CoAgentix Code", "AI assistant", "AI coding"],
  authors: [{ name: "CoAgentix" }],
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
    title: "CoAgentix",
  },
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
