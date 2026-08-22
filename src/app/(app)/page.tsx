import Link from "next/link";
import { getFullDB } from "@/lib/storage";
import {
  computeParticipantStats,
  computeHotColdPlayers,
  computeRecentForm,
  computeCurrentStreaks,
  computeRecentGameDaysSummary,
  computeQuarterlyTiers,
  computeGameDayBoard,
  GameTypeFilter,
} from "@/lib/stats";
import { simplifiedSettlements } from "@/lib/settle";
import { activeGames } from "@/lib/games";
import { currentQuarterKey, formatQuarterKey, nowInSeoul, todayInSeoul } from "@/lib/time";
import { GAME_TYPE_LABELS, GAME_TYPES } from "@/lib/types";
import { ResultBadge, StreakBadge, TierBadge } from "@/components/badges";
import { RecentGameDayCard } from "@/components/RecentGameDayCard";
import { Card } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { EmptyState } from "@/components/ui/EmptyState";
import { buttonClassName } from "@/components/ui/Button";

export const dynamic = "force-dynamic";

function nameOf(map: Map<string, string>, id: string) {
  return map.get(id) ?? "(알 수 없음)";
}

export default async function DashboardPage() {
  const db = await getFullDB();
  const nameMap = new Map(db.participants.map((p) => [p.id, p.name]));
  const gamesActive = activeGames(db.games);
  const today = todayInSeoul();
  // v2.21 (PRD §28.2) — 대상 경기일이 "오늘"이 아니라 "활성 게임이 있는
  // 가장 최근 영업일"이라, 게임이 한 판이라도 기록돼 있으면 카드가 항상
  // 나타난다(v2.20은 오늘 게임이 없으면 통째로 사라졌다). null은 활성
  // 게임이 정말 하나도 없을 때뿐이다.
  const gameDayBoard = computeGameDayBoard(db.participants, db.games, today);
  // 서버에서 미리 포맷 — 클라이언트에서 new Date()로 만들면 hydration
  // 불일치가 나고, 이 앱은 Asia/Seoul 고정 표기라 서버 포맷이 정답이다.
  const updatedAtLabel = nowInSeoul().time;
  const stats = computeParticipantStats(db.participants, db.games);
  // 전원 표시 — 예전엔 상위 5명만 잘라 보여줬는데, 참가자가 많지 않은
  // 그룹이라 전원을 한눈에 보는 게 더 유용하다는 요청으로 상한을 없앴다.
  // computeParticipantStats가 이미 netPoints 내림차순으로 반환하므로 별도
  // 정렬은 필요 없다.
  const rankedStats = stats.filter((s) => s.appearances > 0);
  const transactions = simplifiedSettlements(db.games, db.settlements, db.adjustments);

  const recentDays = computeRecentGameDaysSummary(db.participants, db.games, today);
  const { hot, cold } = computeHotColdPlayers(db.participants, db.games);

  // v2.16 — 통합 + 종목별(훌라/시타델/젝스님트) 이번 분기 티어 상위 3명씩
  // (PRD §16.7 / §18). 각 종목마다 별도로 fold하고, 아직 이번 분기 기록이
  // 없으면(예: 분기 첫날) 데이터가 있는 가장 최근 분기로 대신 보여준다 —
  // /records 분기 선택의 기본값 로직과 동일한 fallback.
  const tierGameTypes: GameTypeFilter[] = ["all", ...GAME_TYPES];
  const tierBlocks = tierGameTypes.map((gt) => {
    const byQuarter = computeQuarterlyTiers(db.participants, db.games, gt);
    const quarters = Array.from(byQuarter.keys()).sort().reverse();
    const quarter = quarters.includes(currentQuarterKey())
      ? currentQuarterKey()
      : quarters[0] ?? null;
    const top3 = quarter
      ? (byQuarter.get(quarter) ?? []).filter((r) => r.tier !== "unranked").slice(0, 3)
      : [];
    return {
      gameType: gt,
      label: gt === "all" ? "통합" : GAME_TYPE_LABELS[gt],
      quarter,
      top3,
    };
  });
  const activeParticipants = db.participants.filter((p) => p.active);
  // v2.21 (PRD §28.8) — 표본 5게임 -> 10게임.
  const formById = new Map(
    computeRecentForm(activeParticipants, db.games, 10).map((f) => [f.id, f])
  );
  const streakById = new Map(
    computeCurrentStreaks(activeParticipants, db.games).map((s) => [s.id, s])
  );
  // Only show the form/streak row for participants who actually have a
  // decisive game — an untouched roster entry has nothing to show here.
  const formRows = stats.filter((s) => s.appearances > 0 && s.wins + s.losses > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-content">대시보드</h1>
          <p className="text-sm text-content-muted mt-1">
            참가자 {db.participants.length}명 · 게임 {gamesActive.length}회 기록됨
          </p>
        </div>
        <Link href="/games/new" className={buttonClassName("primary")}>
          + 새 게임 기록
        </Link>
      </div>

      {/* 1. 최근 경기일 — §28.2, v2.20 게임밤 보드 개편 + "최근 게임" 카드 흡수 */}
      {gameDayBoard && <RecentGameDayCard board={gameDayBoard} updatedAtLabel={updatedAtLabel} />}

      {/* 2·3. 순위 / 정리된 채권-채무 관계 */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <SectionTitle description="게임 승/무/패 기준 — 앱 사용 이전 기록은 반영되지 않습니다.">
            순위 (누적 점수)
          </SectionTitle>
          {rankedStats.length === 0 ? (
            <EmptyState title="아직 기록된 게임이 없습니다." />
          ) : (
            <ol className="space-y-2 mt-4 tabular-nums">
              {rankedStats.map((s, i) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="w-5 text-content-faint">{i + 1}</span>
                    <Link
                      href={`/stats?h2h=${s.id}`}
                      className="font-medium text-content hover:underline"
                    >
                      {s.name}
                    </Link>
                  </span>
                  <span className="text-content-muted">
                    {s.wins}승 {s.appearances - s.wins - s.losses}무 {s.losses}패
                    <span
                      className={`ml-2 font-semibold ${
                        s.netPoints > 0
                          ? "text-emerald-400"
                          : s.netPoints < 0
                          ? "text-lose"
                          : "text-content-muted"
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
            className="inline-block mt-4 text-xs text-content-muted hover:underline"
          >
            전체 통계 보기 →
          </Link>
        </Card>

        <Card>
          <SectionTitle>정리된 이전 계획 ({transactions.length}건)</SectionTitle>
          {transactions.length === 0 ? (
            <EmptyState title="넘길 배출권이 없습니다." />
          ) : (
            <ul className="space-y-2 mt-4 tabular-nums">
              {transactions.slice(0, 6).map((t, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span>
                    <span className="font-medium text-content">{nameOf(nameMap, t.fromId)}</span>
                    <span className="text-content-faint mx-1">→</span>
                    <span className="font-medium text-content">{nameOf(nameMap, t.toId)}</span>
                  </span>
                  <span className="text-content-sub font-semibold">{t.amount}점</span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/settlements"
            className="inline-block mt-4 text-xs text-content-muted hover:underline"
          >
            배출권 화면으로 →
          </Link>
        </Card>
      </div>

      {/* 4. 최근 경기일 요약 — §28.7, 최근 7일 이내 전부(3개 상한 제거) */}
      <Card>
        <SectionTitle description="최근 7일 이내에 게임이 있었던 날">
          최근 경기일 요약
        </SectionTitle>
        {recentDays.length === 0 ? (
          <EmptyState title="최근 7일 이내에 기록된 게임이 없습니다." />
        ) : (
          <ul className="space-y-1 mt-3 tabular-nums">
            {recentDays.map((d) => (
              <li
                key={d.date}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-content-muted"
              >
                <span className="text-content font-medium">{d.date}</span>
                <span>{d.gameCount}게임</span>
                {d.topWinners.length > 0 && (
                  <>
                    <span className="text-content-faint">·</span>
                    <span>
                      최다 승자{" "}
                      <span className="text-content font-medium">
                        {d.topWinners.map((w) => w.name).join(", ")}
                      </span>{" "}
                      (득실차 {d.margin > 0 ? "+" : ""}
                      {d.margin})
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 5. 최근 폼 & 스트릭 — §28.8, 5게임 -> 10게임 */}
      <Card>
        <SectionTitle>최근 폼 & 스트릭</SectionTitle>
        {formRows.length === 0 ? (
          <EmptyState title="아직 기록된 게임이 없습니다." />
        ) : (
          <ul className="divide-y divide-line mt-2">
            {formRows.map((s) => {
              const form = formById.get(s.id);
              const streak = streakById.get(s.id);
              return (
                <li key={s.id} className="py-2.5 space-y-1.5 text-sm">
                  <span className="font-medium text-content">{s.name}</span>
                  {/* v2.21 — 뱃지 10개 + StreakBadge가 이름과 한 줄에 있으면
                      390px에서 폭이 빠듯하다(ResultBadge 20px * 10 +
                      gap-1 = 236px + 이름 + StreakBadge). 뱃지 줄을 이름
                      아래 자기 줄로 내려 확실히 여유를 둔다. */}
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex items-center gap-1">
                      {form?.results.length ? (
                        [...form.results].reverse().map((r, i) => (
                          <ResultBadge key={i} result={r} />
                        ))
                      ) : (
                        <span className="text-xs text-content-muted">-</span>
                      )}
                    </span>
                    <StreakBadge type={streak?.type ?? null} length={streak?.length ?? 0} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-content-muted mt-3">
          최근 폼은 왼쪽이 과거, 오른쪽이 가장 최근 게임입니다 (최근 10게임).
        </p>
      </Card>

      {/* 6. 핫 / 콜드 플레이어 */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <SectionTitle description="최근 14일간 3게임 이상 치른 참가자 중 통산 승률보다 최근 승률이 높은 순">
            핫 플레이어
          </SectionTitle>
          {hot.length === 0 ? (
            <EmptyState title="조건을 만족하는 참가자가 아직 없습니다." />
          ) : (
            <ul className="space-y-2 mt-4 tabular-nums">
              {hot.map((h, i) => (
                <li key={h.id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="w-4 text-content-faint">{i + 1}</span>
                    <span className="font-medium text-content">{h.name}</span>
                  </span>
                  <span className="text-emerald-400 font-semibold">
                    {(h.careerWinRate * 100).toFixed(0)}% → {(h.recentWinRate * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle description="최근 14일간 3게임 이상 치른 참가자 중 통산 승률보다 최근 승률이 낮은 순">
            콜드 플레이어
          </SectionTitle>
          {cold.length === 0 ? (
            <EmptyState title="조건을 만족하는 참가자가 아직 없습니다." />
          ) : (
            <ul className="space-y-2 mt-4 tabular-nums">
              {cold.map((c, i) => (
                <li key={c.id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="w-4 text-content-faint">{i + 1}</span>
                    <span className="font-medium text-content">{c.name}</span>
                  </span>
                  <span className="text-lose font-semibold">
                    {(c.careerWinRate * 100).toFixed(0)}% → {(c.recentWinRate * 100).toFixed(0)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* 7. 이번 분기 티어 — 최상단에서 최하단으로 이동(§28.5) */}
      <Card>
        <SectionTitle
          action={
            <Link href="/records" className="text-xs text-content-muted hover:underline">
              통산기록 전체 보기 →
            </Link>
          }
        >
          이번 분기 티어 (통합 · 종목별)
        </SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2 mt-3">
          {tierBlocks.map((block) => (
            <div key={block.gameType}>
              <p className="text-xs font-medium text-content-muted mb-2">
                {block.label}
                {block.quarter ? ` · ${formatQuarterKey(block.quarter)}` : ""}
              </p>
              {block.top3.length === 0 ? (
                <EmptyState title="아직 배치를 완료한 참가자가 없습니다." />
              ) : (
                <ul className="space-y-1.5 tabular-nums">
                  {block.top3.map((row, i) => (
                    <li key={row.id} className="flex items-center gap-2 text-sm">
                      <span className="w-4 text-content-faint">{i + 1}</span>
                      <span className="font-medium text-content">{row.name}</span>
                      <TierBadge tier={row.tier} size="sm" />
                      <span className="text-content-muted">{Math.round(row.tr)} TR</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
