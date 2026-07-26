import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "물수제비 점심",
  description:
    "기준점에서 돌을 던지면 지도 위를 통통 튀며 날아가고, 마지막 바운스에서 오늘 점심이 공개됩니다.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ebefed" },
    { media: "(prefers-color-scheme: dark)", color: "#08110f" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
