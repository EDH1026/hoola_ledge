import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Self-hosted (not a CDN @import) so the font loads from the same origin as
// everything else — no third-party request, no FOUC waiting on an external
// stylesheet. `display: "swap"` shows the fallback stack immediately and
// swaps in Pretendard once it's ready, so first paint is never blocked on it.
const pretendard = localFont({
  src: "../../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  variable: "--font-pretendard",
  display: "swap",
  weight: "45 920",
});

export const metadata: Metadata = {
  title: "탄소배출저감활동 기록부",
  description: "게임 결과에 따른 탄소배출권 이전을 기록·관리하는 앱",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className={`h-full antialiased ${pretendard.variable}`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
