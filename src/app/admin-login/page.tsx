import Link from "next/link";
import { adminLoginAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = params.next ?? "/participants";

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium px-2.5 py-1 mb-4">
          관리자 모드
        </div>
        <h1 className="text-xl font-semibold text-slate-900 mb-1">
          관리자 비밀번호
        </h1>
        <p className="text-sm text-slate-500 mb-6">
          참가자 풀 관리와 과거 누적기록 입력은 관리자 인증이 필요합니다.
        </p>
        <form action={adminLoginAction} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <input
            type="password"
            name="password"
            placeholder="관리자 비밀번호"
            autoFocus
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
          {params.error === "unset" && (
            <p className="text-sm text-red-600">
              서버에 ADMIN_PASSWORD 환경변수가 설정되어 있지 않습니다. 배포
              환경변수를 추가한 뒤 다시 시도해 주세요.
            </p>
          )}
          {params.error === "1" && (
            <p className="text-sm text-red-600">비밀번호가 올바르지 않습니다.</p>
          )}
          <button
            type="submit"
            className="w-full rounded-lg bg-slate-900 text-white text-sm font-medium py-2 hover:bg-slate-800 transition"
          >
            관리자로 전환
          </button>
        </form>
        <Link
          href="/"
          className="block mt-4 text-center text-xs text-slate-400 hover:text-slate-700"
        >
          대시보드로 돌아가기
        </Link>
      </div>
    </main>
  );
}
