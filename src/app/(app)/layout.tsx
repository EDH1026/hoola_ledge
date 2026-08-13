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
  { href: "/participants", label: "참가자", admin: true },
  { href: "/adjustments", label: "과거기록", admin: true },
];

function LockIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-3 h-3 fill-current"
      aria-hidden
    >
      <path d="M4 7V5a4 4 0 1 1 8 0v2h.5A1.5 1.5 0 0 1 14 8.5v5A1.5 1.5 0 0 1 12.5 15h-9A1.5 1.5 0 0 1 2 13.5v-5A1.5 1.5 0 0 1 3.5 7H4Zm1.5-2v2h5V5a2.5 2.5 0 0 0-5 0Z" />
    </svg>
  );
}

async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return verifyAdminCookie(store.get(ADMIN_COOKIE_NAME)?.value);
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const admin = await isAdmin();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 flex items-center justify-between h-14 gap-3">
          <nav className="flex items-center gap-1 overflow-x-auto">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap transition inline-flex items-center gap-1"
              >
                {item.label}
                {item.admin && !admin && (
                  <span className="text-slate-300">
                    <LockIcon />
                  </span>
                )}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 shrink-0">
            {admin ? (
              <form action={adminLogoutAction} className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 text-xs font-medium px-2.5 py-1 whitespace-nowrap">
                  관리자 모드
                </span>
                <button
                  type="submit"
                  className="text-xs text-slate-400 hover:text-slate-700 whitespace-nowrap"
                >
                  관리자 종료
                </button>
              </form>
            ) : (
              <Link
                href="/admin-login"
                className="text-xs text-slate-400 hover:text-slate-700 whitespace-nowrap"
              >
                관리자 모드
              </Link>
            )}
            <form action={logoutAction}>
              <button
                type="submit"
                className="text-xs text-slate-400 hover:text-slate-700 whitespace-nowrap"
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
