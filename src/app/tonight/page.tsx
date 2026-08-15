import Link from "next/link";
import { listParticipants, listGames } from "@/lib/storage";
import { computeGameNightBoard } from "@/lib/stats";
import { todayInSeoul } from "@/lib/time";
import { GameNightBoardFull } from "@/components/GameNightBoard";
import { GameNightRefresher } from "@/components/GameNightRefresher";
import { WakeLockKeeper } from "@/components/WakeLockKeeper";
import { buttonClassName } from "@/components/ui/Button";

export const dynamic = "force-dynamic";

// v2.20 (PRD §26.5) — a standalone top-level route (sibling to `(app)/`, same
// tier as `/login`/`/admin-login`) rather than nested under `(app)/games/...`.
// `(app)/layout.tsx` unconditionally renders the header nav for everything
// inside it; placing this route outside that group is the simplest way to
// get a nav-free full-screen page without adding a conditional branch to the
// shared layout. Auth still applies — `src/proxy.ts`'s matcher covers every
// path except `_next/static`, `_next/image`, and `favicon.ico`, so the
// regular SITE_PASSWORD session check runs here exactly as it does for every
// other page; nothing route-group-specific was needed to keep that.
export default async function TonightPage() {
  const [participants, games] = await Promise.all([listParticipants(), listGames()]);
  const board = computeGameNightBoard(participants, games, todayInSeoul());

  if (!board) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <p className="text-xl text-content-muted">오늘은 게임 밤이 아닙니다.</p>
          <Link href="/" className={buttonClassName("neutral")}>
            대시보드로 돌아가기
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 sm:px-8 py-8 max-w-3xl mx-auto">
      <WakeLockKeeper />
      <div className="flex items-center justify-between mb-6">
        <Link
          href="/"
          className="text-sm text-content-muted hover:text-content hover:underline"
        >
          ← 대시보드
        </Link>
        {/* 이 화면은 조회 전용이다 — 기록·수정·삭제 진입점을 두지 않는다
            (테이블 위에 둔 폰을 누가 실수로 눌러서 기록이 바뀌면 안 된다).
            "+ 새 게임 기록"만 유일한 예외로 44px 이상 크게 둔다(§26.5). */}
        <Link href="/games/new" className={buttonClassName("primary")}>
          + 새 게임 기록
        </Link>
      </div>
      <GameNightBoardFull board={board} />
      <GameNightRefresher />
    </main>
  );
}
