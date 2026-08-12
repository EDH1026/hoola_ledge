import Link from "next/link";
import { readDB } from "@/lib/storage";
import { computeParticipantStats } from "@/lib/stats";
import { simplifiedSettlements } from "@/lib/settle";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

function nameOf(map: Map<string, string>, id: string) {
  return map.get(id) ?? "(알 수 없음)";
}

export default async function DashboardPage() {
  const db = await readDB();
  const nameMap = new Map(db.participants.map((p) => [p.id, p.name]));
  const stats = computeParticipantStats(db.participants, db.games);
  const topRanked = stats.filter((s) => s.appearances > 0).slice(0, 5);
  const recentGames = [...db.games]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);
  const transactions = simplifiedSettlements(db.games, db.settlements);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">대시보드</h1>
          <p className="text-sm text-slate-500 mt-1">
            참가자 {db.participants.length}명 · 게임 {db.games.length}회 기록됨
          </p>
        </div>
        <Link
          href="/games/new"
          className="rounded-lg bg-slate-900 text-white text-sm font-medium px-4 py-2 hover:bg-slate-800 transition"
        >
          + 새 게임 기록
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="font-semibold mb-4">순위 (누적 점수)</h2>
          {topRanked.length === 0 ? (
            <p className="text-sm text-slate-400">아직 기록된 게임이 없습니다.</p>
          ) : (
            <ol className="space-y-2">
              {topRanked.map((s, i) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="w-5 text-slate-400">{i + 1}</span>
                    <span className="font-medium">{s.name}</span>
                  </span>
                  <span className="text-slate-500">
                    {s.wins}승 {s.losses}패
                    <span
                      className={`ml-2 font-semibold ${
                        s.netPoints > 0
                          ? "text-emerald-600"
                          : s.netPoints < 0
                          ? "text-red-500"
                          : "text-slate-400"
                      }`}
                    >
                      {s.netPoints > 0 ? "+" : ""}
                      {s.netPoints}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          <Link
            href="/stats"
            className="inline-block mt-4 text-xs text-slate-500 hover:underline"
          >
            전체 통계 보기 →
          </Link>
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="font-semibold mb-4">
            정리된 채권-채무 관계 ({transactions.length}건)
          </h2>
          {transactions.length === 0 ? (
            <p className="text-sm text-slate-400">정산할 내역이 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {transactions.slice(0, 6).map((t, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span>
                    <span className="font-medium">{nameOf(nameMap, t.fromId)}</span>
                    <span className="text-slate-400 mx-1">→</span>
                    <span className="font-medium">{nameOf(nameMap, t.toId)}</span>
                  </span>
                  <span className="text-slate-600 font-semibold">{t.amount}점</span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/settlements"
            className="inline-block mt-4 text-xs text-slate-500 hover:underline"
          >
            정산 화면으로 →
          </Link>
        </section>
      </div>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">최근 게임</h2>
        {recentGames.length === 0 ? (
          <p className="text-sm text-slate-400">아직 기록된 게임이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recentGames.map((g) => (
              <li key={g.id} className="py-2.5 flex items-center justify-between text-sm">
                <span className="text-slate-500">{format(new Date(g.date), "yyyy-MM-dd")}</span>
                <span>
                  <span className="text-emerald-600 font-medium">
                    {nameOf(nameMap, g.winnerId)}
                  </span>
                  <span className="text-slate-400 mx-1">1등 · 꼴찌</span>
                  <span className="text-red-500 font-medium">
                    {nameOf(nameMap, g.loserId)}
                  </span>
                </span>
                <span className="text-slate-400">참가 {g.attendeeIds.length}명</span>
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/games"
          className="inline-block mt-4 text-xs text-slate-500 hover:underline"
        >
          전체 게임 목록 →
        </Link>
      </section>
    </div>
  );
}
