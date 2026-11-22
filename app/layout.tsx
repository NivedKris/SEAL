import type { Metadata, Viewport } from "next";
import { Inter, Source_Serif_4, Geist_Mono, Noto_Sans_Arabic, Doto } from "next/font/google";
import { TopBar } from "@/components/shell/top-bar";
import { Splash } from "@/components/shell/splash";
import { Assistant } from "@/components/assistant/assistant";
import { currentTenant } from "@/lib/tenant-server";
import { Install } from "@/components/pwa/install";
import "./globals.css";

const inter = Inter({ variable: "--font-sans", subsets: ["latin"] });
const serif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"], weight: ["600", "700", "800"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const dot = Doto({ variable: "--font-dot", subsets: ["latin"], weight: ["500", "700", "900"] });
const arabic = Noto_Sans_Arabic({ variable: "--font-arabic", subsets: ["arabic"], weight: ["400", "500", "600", "700"] });

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
