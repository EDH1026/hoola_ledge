import Link from "next/link";
import { cookies } from "next/headers";
import { logoutAction } from "../login/actions";
import { adminLogoutAction } from "../admin-login/actions";
import { ADMIN_COOKIE_NAME, verifyAdminCookie } from "@/lib/auth";

const NAV_ITEMS = [
  { href: "/", label: "대시보드" },
  { href: "/games", label: "게임" },
  { href: "/settlements", label: "배출권" },
  { href: "/stats", label: "통계" },
  { href: "/records", label: "통산기록" },
  { href: "/principles", label: "운영원칙" },
];

// v2.23 (PRD §32.5) — 관리자 전용 화면 3개는 헤더 탭에서 내려가고 푸터에서만
// 링크된다. 헤더 NAV_ITEMS와 분리해 두는 이유는 헤더는 이제 admin 여부와
// 무관하게 고정된 일반 탭 6개만 보여주기 때문 — 필터링 로직 자체가 필요 없다.
const ADMIN_NAV_ITEMS = [
  { href: "/participants", label: "참가자" },
  { href: "/adjustments", label: "이월 기록" },
  { href: "/rollback", label: "롤백" },
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
        {/* v2.23 (PRD §32.5) — 탭이 6개로 늘면서 390px 폭에서 가로 스크롤로는
            다 안 들어간다. 예전엔 overflow-x-auto + 페이드 그라데이션으로
            "더 있음"을 알렸지만, 스크롤은 신호가 약해 탭을 놓치기 쉽다.
            flex-wrap으로 안 들어가면 2줄로 감기게 하고, 그에 맞춰 높이도
            h-14 고정 대신 min-h-14 py-2로 풀었다. 관리자·로그아웃 버튼은
            거의 안 쓰는데 우측을 고정 점유하고 있었으므로 푸터로 옮겼다. */}
        <div className="max-w-5xl mx-auto px-4 py-2 min-h-14 flex items-center">
          <nav className="flex items-center gap-1 flex-wrap">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="min-h-11 inline-flex items-center px-3 rounded-lg text-sm font-medium text-content-sub hover:bg-slate-700 hover:text-content whitespace-nowrap transition"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">
        {children}
      </main>
      <footer className="border-t border-line">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-1 flex-wrap text-xs text-content-muted">
          {admin ? (
            <>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-300 text-xs font-medium px-2.5 py-1 whitespace-nowrap">
                Admin
              </span>
              {ADMIN_NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="min-h-11 inline-flex items-center px-2 whitespace-nowrap rounded-lg hover:bg-slate-700 hover:text-content"
                >
                  {item.label}
                </Link>
              ))}
              <form action={adminLogoutAction}>
                <button
                  type="submit"
                  className="min-h-11 inline-flex items-center px-2 whitespace-nowrap rounded-lg hover:bg-slate-700 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  관리자 종료
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/admin-login"
              className="min-h-11 inline-flex items-center px-2 whitespace-nowrap rounded-lg hover:bg-slate-700 hover:text-content"
            >
              관리자 모드
            </Link>
          )}
          <form action={logoutAction} className="ml-auto">
            <button
              type="submit"
              className="min-h-11 inline-flex items-center px-2 whitespace-nowrap rounded-lg hover:bg-slate-700 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              로그아웃
            </button>
          </form>
        </div>
      </footer>
    </div>
  );
}
