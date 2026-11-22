import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { TopBar } from "@/components/shell/top-bar";
import { Splash } from "@/components/shell/splash";
import { Assistant } from "@/components/assistant/assistant";
import { currentTenant } from "@/lib/tenant-server";
import { Install } from "@/components/pwa/install";
import "./globals.css";

// Fonts ship with the app (app/fonts, variable files from Google Fonts, SIL Open Font License), so a
// build never depends on downloading them: a failed download from Google broke the Vercel build.
const inter = localFont({ src: "./fonts/inter.woff2", variable: "--font-sans", weight: "100 900", display: "swap" });
const serif = localFont({ src: "./fonts/source-serif-4.woff2", variable: "--font-source-serif", weight: "600 800", display: "swap" });
const mono = localFont({ src: "./fonts/geist-mono.woff2", variable: "--font-geist-mono", weight: "100 900", display: "swap" });
const dot = localFont({ src: "./fonts/doto.woff2", variable: "--font-dot", weight: "100 900", display: "swap" });
const arabic = localFont({ src: "./fonts/noto-sans-arabic.woff2", variable: "--font-arabic", weight: "400 700", display: "swap" });

export const metadata: Metadata = {
  title: { default: "SEAL", template: "%s · SEAL" },
  description: "SEAL catches insurance claim refusals at the point of care, at claim creation, and after a refusal comes back.",
  applicationName: "SEAL",
  appleWebApp: { capable: true, title: "SEAL", statusBarStyle: "default" },
  icons: { apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }] },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#eef2f0",
  viewportFit: "cover",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const tenant = await currentTenant();
  return (
    <html lang="en">
      <body className={`${inter.variable} ${serif.variable} ${mono.variable} ${arabic.variable} ${dot.variable} font-sans antialiased pb-[calc(68px+env(safe-area-inset-bottom))] md:pb-0`}>
        <Splash />
        <TopBar tenant={tenant.id} />
        {children}
        <Assistant />
        <Install />
      </body>
    </html>
  );
}
