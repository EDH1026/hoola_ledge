import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "게임 장부",
  description: "게임 결과와 채권-채무 관계를 기록하고 정산하는 앱",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
