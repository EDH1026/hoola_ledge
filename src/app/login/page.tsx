import { loginAction } from "./actions";
import { Button } from "@/components/ui/Button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = params.next ?? "/";

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-800 px-4">
      <div className="w-full max-w-sm bg-surface rounded-2xl shadow-sm border border-line p-8">
        <h1 className="text-xl font-semibold text-content mb-1">배출권 장부</h1>
        <p className="text-sm text-content-muted mb-6">
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
            className="bg-surface w-full rounded-lg border border-slate-700 px-3 py-2 text-sm text-content focus:outline-none focus:ring-2 focus:ring-accent-soft"
          />
          {params.error && (
            <p className="text-sm text-red-400">비밀번호가 올바르지 않습니다.</p>
          )}
          <Button type="submit" className="w-full">
            입장하기
          </Button>
        </form>
      </div>
    </main>
  );
}
