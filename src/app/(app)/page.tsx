import Link from "next/link";
import { getFullDB } from "@/lib/storage";
import {
  computeParticipantStats,
  computeHotColdPlayers,
  computeRecentForm,
  computeCurrentStreaks,
  computeTodaySummary,
  computeQuarterlyTiers,
} from "@/lib/stats";
import { simplifiedSettlements } from "@/lib/settle";
import { activeGames } from "@/lib/games";
import { currentQuarterKey, formatQuarterKey } from "@/lib/time";
import { format } from "date-fns";
import { GameTypeBadge, ResultBadge, StreakBadge, TierBadge } from "@/components/badges";

export const dynamic = "force-dynamic";

function nameOf(map: Map<string, string>, id: string) {
  return map.get(id) ?? "(알 수 없음)";
}

export default async function DashboardPage() {
  const db = await getFullDB();
  const nameMap = new Map(db.participants.map((p) => [p.id, p.name]));
  const gamesActive = activeGames(db.games);
  const stats = computeParticipantStats(db.participants, db.games);
  const topRanked = stats.filter((s) => s.appearances > 0).slice(0, 5);
  const recentGames = [...gamesActive]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);
  const transactions = simplifiedSettlements(db.games, db.settlements, db.adjustments);

  const today = computeTodaySummary(db.participants, db.games);
  const { hot, cold } = computeHotColdPlayers(db.participants, db.games);

  // v2.15 — 이번 분기 통합 티어 상위 3명 (PRD §16.7). 아직 이번 분기 기록이
  // 없으면(예: 분기 첫날) 데이터가 있는 가장 최근 분기로 대신 보여준다 —
  // /stats 분기 선택의 기본값 로직과 동일한 fallback.
  const tierByQuarter = computeQuarterlyTiers(db.participants, db.games, "all");
  const tierQuarters = Array.from(tierByQuarter.keys()).sort().reverse();
  const tierQuarter = tierQuarters.includes(currentQuarterKey())
    ? currentQuarterKey()
    : tierQuarters[0] ?? null;
  const tierTop3 = tierQuarter
    ? (tierByQuarter.get(tierQuarter) ?? [])
        .filter((r) => r.tier !== "unranked")
        .slice(0, 3)
    : [];
  const activeParticipants = db.participants.filter((p) => p.active);
  const formById = new Map(
    computeRecentForm(activeParticipants, db.games, 5).map((f) => [f.id, f])
  );
  const streakById = new Map(
    computeCurrentStreaks(activeParticipants, db.games).map((s) => [s.id, s])
  );
  // Only show the form/streak row for participants who actually have a
  // decisive game — an untouched roster entry has nothing to show here.
  const formRows = stats.filter((s) => s.appearances > 0 && s.wins + s.losses > 0);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">대시보드</h1>
          <p className="text-sm text-slate-500 mt-1">
            참가자 {db.participants.length}명 · 게임 {gamesActive.length}회 기록됨
          </p>
        </div>
        <Link
          href="/games/new"
          className="rounded-lg bg-slate-900 text-white text-sm font-medium px-4 py-2 hover:bg-slate-800 transition"
        >
          + 새 게임 기록
        </Link>
      </div>

      <div className="rounded-xl bg-slate-900 text-white px-4 py-3 text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold">오늘의 요약</span>
        {today.gameCount === 0 ? (
          <span className="text-slate-300">오늘은 아직 기록된 게임이 없습니다.</span>
        ) : (
          <span className="text-slate-300">
            오늘 {today.gameCount}게임 진행
            {today.topWinner && (
              <>
                {" "}
                · 오늘의 최다 승자{" "}
                <span className="text-white font-medium">
                  {today.topWinner.name} ({today.topWinner.wins}승)
                </span>
              </>
            )}
          </span>
        )}
      </div>

      {tierQuarter && (
        <section className="bg-white rounded-2xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">
              {formatQuarterKey(tierQuarter)} 티어 (통합)
            </h2>
            <Link href="/stats" className="text-xs text-slate-500 hover:underline">
              전체 보기 →
            </Link>
          </div>
          {tierTop3.length === 0 ? (
            <p className="text-sm text-slate-400">
              아직 배치를 완료한 참가자가 없습니다.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {tierTop3.map((row, i) => (
                <li key={row.id} className="flex items-center gap-2 text-sm">
                  <span className="w-4 text-slate-400">{i + 1}</span>
                  <span className="font-medium">{row.name}</span>
                  <TierBadge tier={row.tier} size="sm" />
                  <span className="text-slate-400">{Math.round(row.tr)} TR</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="font-semibold">순위 (누적 점수)</h2>
          <p className="text-xs text-slate-400 mb-4">
            게임 승/무/패 기준 — 과거 누적기록(조정)은 반영되지 않습니다.
          </p>
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
                    <Link
                      href={`/stats?h2h=${s.id}`}
                      className="font-medium hover:underline"
                    >
                      {s.name}
                    </Link>
                  </span>
                  <span className="text-slate-500">
                    {s.wins}승 {s.appearances - s.wins - s.losses}무 {s.losses}패
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

      <div className="grid gap-6 md:grid-cols-2">
        <section className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="font-semibold">핫 플레이어</h2>
          <p className="text-xs text-slate-400 mb-4">
            최근 14일간 3경기 이상 치른 참가자 중 통산 승률보다 최근 승률이
            높은 순
          </p>
          {hot.length === 0 ? (
            <p className="text-sm text-slate-400">
              조건을 만족하는 참가자가 아직 없습니다.
            </p>
          ) : (
            <ul className="space-y-2">
              {hot.map((h, i) => (
                <li key={h.id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="w-4 text-slate-400">{i + 1}</span>
                    <span className="font-medium">{h.name}</span>
                  </span>
                  <span className="text-emerald-600 font-semibold">
                    {(h.careerWinRate * 100).toFixed(0)}% → {(h.recentWinRate * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="font-semibold">콜드 플레이어</h2>
          <p className="text-xs text-slate-400 mb-4">
            최근 14일간 3경기 이상 치른 참가자 중 통산 승률보다 최근 승률이
            낮은 순
          </p>
          {cold.length === 0 ? (
            <p className="text-sm text-slate-400">
              조건을 만족하는 참가자가 아직 없습니다.
            </p>
          ) : (
            <ul className="space-y-2">
              {cold.map((c, i) => (
                <li key={c.id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="w-4 text-slate-400">{i + 1}</span>
                    <span className="font-medium">{c.name}</span>
                  </span>
                  <span className="text-red-500 font-semibold">
                    {(c.careerWinRate * 100).toFixed(0)}% → {(c.recentWinRate * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">최근 폼 & 스트릭</h2>
        {formRows.length === 0 ? (
          <p className="text-sm text-slate-400">아직 기록된 게임이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {formRows.map((s) => {
              const form = formById.get(s.id);
              const streak = streakById.get(s.id);
              return (
                <li
                  key={s.id}
                  className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span className="font-medium">{s.name}</span>
                  <span className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      {form?.results.length ? (
                        [...form.results].reverse().map((r, i) => (
                          <ResultBadge key={i} result={r} />
                        ))
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </span>
                    <StreakBadge type={streak?.type ?? null} length={streak?.length ?? 0} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-slate-400 mt-3">
          최근 폼은 왼쪽이 과거, 오른쪽이 가장 최근 경기입니다 (최근 5경기).
        </p>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">최근 게임</h2>
        {recentGames.length === 0 ? (
          <p className="text-sm text-slate-400">아직 기록된 게임이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recentGames.map((g) => (
              <li key={g.id} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  <span className="text-slate-500">{format(new Date(g.date), "yyyy-MM-dd")}</span>
                  <GameTypeBadge gameType={g.gameType} />
                </span>
                <span>
                  <span className="text-emerald-600 font-medium">
                    {nameOf(nameMap, g.winnerId)}
                  </span>
                  <span className="text-slate-400 mx-1">Win · Lose</span>
                  <span className="text-red-500 font-medium">
                    {nameOf(nameMap, g.loserId)}
                  </span>
                  <span className="text-slate-400 ml-1">· {g.points ?? 1}점</span>
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
