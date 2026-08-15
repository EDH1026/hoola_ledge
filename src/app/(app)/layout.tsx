import Link from "next/link";
import { cookies } from "next/headers";
import { logoutAction } from "../login/actions";
import { adminLogoutAction } from "../admin-login/actions";
import { ADMIN_COOKIE_NAME, verifyAdminCookie } from "@/lib/auth";

const NAV_ITEMS = [
  { href: "/", label: "대시보드" },
  { href: "/games", label: "게임" },
  { href: "/settlements", label: "정산" },
  { href: "/stats", label: "통계" },
  { href: "/records", label: "통산기록" },
  { href: "/participants", label: "참가자", admin: true },
  { href: "/adjustments", label: "과거기록", admin: true },
  { href: "/rollback", label: "롤백", admin: true },
];

async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return verifyAdminCookie(store.get(ADMIN_COOKIE_NAME)?.value);
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const admin = await isAdmin();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line bg-surface sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 flex items-center justify-between h-14 gap-3">
          {/* v2.19 (배치 B, PRD §24.11) — 관리자 8탭이 폰에서 2개만 보이는데
              가로로 더 있다는 신호가 없었다. 오른쪽 가장자리 그라데이션
              페이드로 "더 있음"을 표시한다(스크롤 위치에 반응하진 않는
              정적 신호지만, 별도 스크립트 없이 목적은 충분히 달성한다). */}
          <div className="relative min-w-0 flex-1">
            <nav className="flex items-center gap-1 overflow-x-auto">
              {NAV_ITEMS.filter((item) => !item.admin || admin).map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="min-h-11 inline-flex items-center px-3 rounded-lg text-sm font-medium text-content-sub hover:bg-slate-700 hover:text-content whitespace-nowrap transition"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div
              aria-hidden
              className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-surface to-transparent"
            />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {admin ? (
              <form action={adminLogoutAction} className="flex items-center gap-1">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-300 text-xs font-medium px-2.5 py-1 whitespace-nowrap">
                  관리자 모드
                </span>
                <button
                  type="submit"
                  className="min-h-11 min-w-11 inline-flex items-center justify-center px-2 text-xs text-content-sub hover:text-content whitespace-nowrap rounded-lg hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  관리자 종료
                </button>
              </form>
            ) : (
              <Link
                href="/admin-login"
                className="min-h-11 inline-flex items-center px-2 text-xs text-content-sub hover:text-content whitespace-nowrap rounded-lg hover:bg-slate-700"
              >
                관리자 모드
              </Link>
            )}
            <form action={logoutAction}>
              <button
                type="submit"
                className="min-h-11 min-w-11 inline-flex items-center justify-center px-2 text-xs text-content-sub hover:text-content whitespace-nowrap rounded-lg hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                로그아웃
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
