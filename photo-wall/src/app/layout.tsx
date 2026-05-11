import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Photo Wall",
  description: "Real-time photo wall from Telegram groups",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
