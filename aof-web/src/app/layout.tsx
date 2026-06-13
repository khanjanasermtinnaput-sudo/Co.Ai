import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { AppProviders } from "@/components/providers/app-providers";
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
    default: "Aof — The professional AI platform",
    template: "%s · Aof",
  },
  description:
    "Aof is a professional AI platform. Chat with Aof, build software with Aof Code, and manage your Projects — all in one premium workspace.",
  applicationName: "Aof",
  keywords: ["Aof", "AI platform", "Aof Code", "AI assistant", "AI coding"],
  authors: [{ name: "Aof" }],
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
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
      </body>
    </html>
  );
}
