import type { Metadata } from "next";
import { Inter, Source_Serif_4, Geist_Mono, Noto_Sans_Arabic } from "next/font/google";
import { TopBar } from "@/components/shell/top-bar";
import { Splash } from "@/components/shell/splash";
import "./globals.css";

const inter = Inter({ variable: "--font-sans", subsets: ["latin"] });
const serif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"], weight: ["600", "700", "800"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const arabic = Noto_Sans_Arabic({ variable: "--font-arabic", subsets: ["arabic"], weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: { default: "SEAL", template: "%s · SEAL" },
  description: "SEAL catches insurance claim refusals at the point of care, at claim creation, and after a refusal comes back.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${serif.variable} ${mono.variable} ${arabic.variable} font-sans antialiased`}>
        <Splash />
        <TopBar />
        {children}
      </body>
    </html>
  );
}
