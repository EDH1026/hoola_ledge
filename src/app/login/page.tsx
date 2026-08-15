import { loginAction } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = params.next ?? "/";

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-800 px-4">
      <div className="w-full max-w-sm bg-slate-900 rounded-2xl shadow-sm border border-slate-800 p-8">
        <h1 className="text-xl font-semibold text-slate-100 mb-1">게임 장부</h1>
        <p className="text-sm text-slate-400 mb-6">
          공유 비밀번호를 입력해 주세요.
        </p>
        <form action={loginAction} className="space-y-4">
          <input type="hidden" name="next" value={next} />
          <input
            type="password"
            name="password"
            placeholder="비밀번호"
            autoFocus
            required
            className="bg-slate-900 w-full rounded-lg border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-100"
          />
          {params.error && (
            <p className="text-sm text-red-400">비밀번호가 올바르지 않습니다.</p>
          )}
          <button
            type="submit"
            className="w-full rounded-lg bg-slate-100 text-slate-900 text-sm font-medium py-2 hover:bg-slate-300 transition"
          >
            입장하기
          </button>
        </form>
      </div>
    </main>
  );
}
