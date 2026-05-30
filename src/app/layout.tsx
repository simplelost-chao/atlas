import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Atlas - Map Industries. Find Companies. Discover Value.",
  description: "产业链分析与投资标的挖掘平台",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className={`${inter.className} bg-[#F3F4F6]`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
