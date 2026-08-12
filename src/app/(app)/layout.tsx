import Link from "next/link";
import { logoutAction } from "../login/actions";

const NAV_ITEMS = [
  { href: "/", label: "대시보드" },
  { href: "/games", label: "게임" },
  { href: "/participants", label: "참가자" },
  { href: "/settlements", label: "정산" },
  { href: "/stats", label: "통계" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 bg-white sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 flex items-center justify-between h-14">
          <nav className="flex items-center gap-1 overflow-x-auto">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 whitespace-nowrap transition"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <form action={logoutAction}>
            <button
              type="submit"
              className="text-xs text-slate-400 hover:text-slate-700 whitespace-nowrap"
            >
              로그아웃
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
