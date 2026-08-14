"use client";

import { useMemo, useState, type CSSProperties } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  ReferenceLine,
  ReferenceArea,
  LabelList,
} from "recharts";
import { GAME_TYPE_LABELS, GAME_TYPES, GameResult } from "@/lib/types";
import { activeGames } from "@/lib/games";
import { TierBadge } from "@/components/badges";
import { currentQuarterKey, formatQuarterKey } from "@/lib/time";
import {
  computeParticipantStats,
  computeHeadToHead,
  computeHeadToHeadMatrix,
  computeNemesisAndVictim,
  computeGameTypeStats,
  computeRecords,
  computeQuarterlyTiers,
  computeStyleMap,
  groupGamesByPeriod,
  filterGamesByPreset,
  filterGamesByType,
  GameTypeFilter,
  PeriodGrouping,
  RangePreset,
  RecordTier,
  RecordTierEntry,
  StyleMapPoint,
  Tier,
  TierRow,
  TIER_MIN_WEIGHT,
} from "@/lib/stats";

interface ParticipantLite {
  id: string;
  name: string;
  active: boolean;
}

const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "7d", label: "최근 7일" },
  { value: "30d", label: "최근 30일" },
  { value: "90d", label: "최근 90일" },
  { value: "year", label: "올해" },
  { value: "all", label: "전체" },
  { value: "custom", label: "직접 입력" },
];

const GROUPING_OPTIONS: { value: PeriodGrouping; label: string }[] = [
  { value: "day", label: "일별" },
  { value: "week", label: "주별" },
  { value: "month", label: "월별" },
  { value: "year", label: "연도별" },
];

const GAME_TYPE_OPTIONS: { value: GameTypeFilter; label: string }[] = [
  { value: "all", label: "전체" },
  ...GAME_TYPES.map((gt) => ({ value: gt, label: GAME_TYPE_LABELS[gt] })),
];

// v2.15 분기 티어 섹션 — "통합"을 맨 앞에 두는 건 표본이 가장 크고(§16.7)
// 대표 티어로 쓰기 좋기 때문. 위 GAME_TYPE_OPTIONS의 "전체"와 라벨이 다른 건
// 의도적 — 여긴 종목을 "합산"한다는 뜻이라 "통합"이 더 정확하다.
const TIER_GAME_TYPE_TABS: { value: GameTypeFilter; label: string }[] = [
  { value: "all", label: "통합" },
  ...GAME_TYPES.map((gt) => ({ value: gt, label: GAME_TYPE_LABELS[gt] })),
];

// Only used to decide the promotion-arrow direction (current tier's rank vs.
// previous quarter's) — unrelated to the TR cutoffs themselves, which live in
// computeQuarterlyTiers().
const TIER_RANK: Record<Tier, number> = {
  unranked: -1,
  bronze: 0,
  silver: 1,
  gold: 2,
  platinum: 3,
  diamond: 4,
  master: 5,
  challenger: 6,
};

type TierDelta = "up" | "down" | "same" | "new";

// PRD §16.8 — fixed so a single low-sample outlier can't compress everyone
// else toward the center by auto-scaling. Bounds come from the same
// simulation as the tier constants (90-day p1~p99: ENG 0.52~1.56, PERF
// -1.42~+1.29) with headroom, so don't tune these without re-running it.
const STYLE_MAP_X_DOMAIN: [number, number] = [0.4, 1.8];
const STYLE_MAP_X_TICKS = [0.4, 0.7, 1.0, 1.3, 1.6];
const STYLE_MAP_Y_DOMAIN: [number, number] = [-1.6, 1.6];
const STYLE_MAP_Y_TICKS = [-1.6, -0.8, 0, 0.8, 1.6];

function clamp(v: number, [min, max]: [number, number]): number {
  return Math.min(max, Math.max(min, v));
}

interface StyleMapPlotPoint extends StyleMapPoint {
  x: number; // clamped engagement, for plotting
  y: number; // clamped performance, for plotting
  clamped: boolean; // true if the raw point fell outside the fixed domain
}

function tierDelta(row: TierRow): TierDelta {
  if (row.prevTier === null) return "new";
  const prevRank = TIER_RANK[row.prevTier];
  const curRank = TIER_RANK[row.tier];
  if (curRank > prevRank) return "up";
  if (curRank < prevRank) return "down";
  return "same";
}

// Data-driven color intensity can't be expressed as static Tailwind classes
// (the scanner needs literal class strings), so the head-to-head matrix uses
// inline rgba() backgrounds instead. Alpha is floored at 0.12 so even a small
// nonzero net still reads as "slightly colored" rather than invisible, and
// capped at 0.65 so text stays legible without needing a text-color switch.
function heatmapStyle(net: number, maxAbs: number): CSSProperties {
  if (net === 0 || maxAbs === 0) return {};
  const t = Math.min(1, Math.abs(net) / maxAbs);
  const alpha = 0.12 + t * 0.53;
  const [r, g, b] = net > 0 ? [5, 150, 105] : [220, 38, 38]; // emerald-600 / red-600
  return { backgroundColor: `rgba(${r}, ${g}, ${b}, ${alpha})` };
}

const PALETTE = [
  "#0f172a",
  "#059669",
  "#d97706",
  "#dc2626",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#0891b2",
  "#65a30d",
  "#ea580c",
];

export default function StatsClient({
  participants,
  games,
  initialH2hParticipantId = null,
}: {
  participants: ParticipantLite[];
  games: GameResult[];
  initialH2hParticipantId?: string | null;
}) {
  const [range, setRange] = useState<RangePreset>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [grouping, setGrouping] = useState<PeriodGrouping>("week");
  const [gameType, setGameType] = useState<GameTypeFilter>("all");
  const [h2hParticipantId, setH2hParticipantId] = useState<string | null>(
    initialH2hParticipantId
  );

  // v2.15 분기 티어 — 화면 상단의 기간·종목 필터와 완전히 독립이어야 하므로
  // (PRD §16.7) 항상 원본 games 전체를 넘긴다(filteredGames 아님). 종목 탭
  // 4개를 한 번에 계산해두고 탭 전환은 계산된 맵에서 골라 쓰기만 한다 — 탭을
  // 바꿀 때마다 전체 재계산이 일어나지 않도록.
  const [tierGameType, setTierGameType] = useState<GameTypeFilter>("all");
  const [tierQuarter, setTierQuarter] = useState<string | null>(null);
  const [styleMapGameType, setStyleMapGameType] = useState<GameTypeFilter>("all");

  const tiersByGameType = useMemo(() => {
    const map = new Map<GameTypeFilter, Map<string, TierRow[]>>();
    for (const tab of TIER_GAME_TYPE_TABS) {
      map.set(tab.value, computeQuarterlyTiers(participants, games, tab.value));
    }
    return map;
  }, [participants, games]);

  // Everything from here down is cheap (a handful of participants/quarters)
  // and derived synchronously each render — only the fold over the full game
  // history above is worth memoizing.
  const tierQuartersForType: Map<string, TierRow[]> =
    tiersByGameType.get(tierGameType) ?? new Map();
  const availableTierQuarters = Array.from(tierQuartersForType.keys())
    .sort()
    .reverse(); // most recent first
  // Defaults to the current quarter if it has data; otherwise the most
  // recent quarter that does. If the user picked a quarter that doesn't
  // exist for the newly-selected game type tab, this also silently falls
  // back rather than showing an empty screen.
  const effectiveTierQuarter: string | null =
    (tierQuarter && tierQuartersForType.has(tierQuarter) ? tierQuarter : null) ??
    (tierQuartersForType.has(currentQuarterKey()) ? currentQuarterKey() : null) ??
    availableTierQuarters[0] ??
    null;

  const tierRows = effectiveTierQuarter
    ? tierQuartersForType.get(effectiveTierQuarter) ?? []
    : [];
  // Inactive participants are hidden by default, but still shown if they
  // actually played in the selected quarter (PRD §16.7).
  const activeParticipantById = new Map(participants.map((p) => [p.id, p.active]));
  const visibleTierRows = tierRows.filter(
    (r) => activeParticipantById.get(r.id) !== false || r.games > 0
  );

  // v2.15 성향 맵 — 티어와 마찬가지로 화면 상단 필터와 무관하며, 항상 최근
  // 90일 롤링(§16.8)이라 tierQuarter 같은 분기 선택 자체가 없다. 종목 탭은
  // 티어 섹션과 동일한 4개를 재사용하되 상태는 독립적이다.
  const styleMapByGameType = useMemo(() => {
    const map = new Map<GameTypeFilter, StyleMapPoint[]>();
    for (const tab of TIER_GAME_TYPE_TABS) {
      map.set(tab.value, computeStyleMap(participants, games, tab.value));
    }
    return map;
  }, [participants, games]);

  const styleMapPoints: StyleMapPlotPoint[] = (
    styleMapByGameType.get(styleMapGameType) ?? []
  ).map((p) => {
    const x = clamp(p.engagement, STYLE_MAP_X_DOMAIN);
    const y = clamp(p.performance, STYLE_MAP_Y_DOMAIN);
    return { ...p, x, y, clamped: x !== p.engagement || y !== p.performance };
  });

  // Only consulted when range === "custom"; harmless to always pass.
  const customRange = useMemo(
    () => ({ start: customStart || undefined, end: customEnd || undefined }),
    [customStart, customEnd]
  );

  const filteredGames = useMemo(
    () =>
      filterGamesByType(
        filterGamesByPreset(activeGames(games), range, customRange),
        gameType
      ),
    [games, range, customRange, gameType]
  );

  const stats = useMemo(
    () => computeParticipantStats(participants, filteredGames),
    [participants, filteredGames]
  );
  const activeStats = stats.filter((s) => s.appearances > 0);

  const buckets = useMemo(
    () => groupGamesByPeriod(filteredGames, grouping),
    [filteredGames, grouping]
  );

  const trendData = buckets.map((b) => ({
    label: b.label,
    게임수: b.gameCount,
  }));

  const winLossData = activeStats.map((s) => ({
    name: s.name,
    승: s.wins,
    패: s.losses,
  }));

  // cumulative net-points-over-time per participant, sampled at each game
  const sortedGames = useMemo(
    () =>
      [...filteredGames].sort((a, b) =>
        a.date === b.date
          ? a.createdAt.localeCompare(b.createdAt)
          : a.date.localeCompare(b.date)
      ),
    [filteredGames]
  );

  const cumulativeData = useMemo(() => {
    const running = new Map<string, number>();
    const nameOf = new Map(participants.map((p) => [p.id, p.name]));
    return sortedGames.map((g, i) => {
      running.set(g.winnerId, (running.get(g.winnerId) ?? 0) + 1);
      running.set(g.loserId, (running.get(g.loserId) ?? 0) - 1);
      const row: Record<string, string | number> = {
        label: `${g.date} #${i + 1}`,
      };
      for (const [id, val] of running.entries()) {
        row[nameOf.get(id) ?? id] = val;
      }
      return row;
    });
  }, [sortedGames, participants]);

  const trackedNames = useMemo(() => {
    const names = new Set<string>();
    for (const row of cumulativeData) {
      for (const key of Object.keys(row)) {
        if (key !== "label") names.add(key);
      }
    }
    return Array.from(names);
  }, [cumulativeData]);

  // Only participants who actually show up in the current filter's results —
  // otherwise the matrix/nemesis-victim sections would be full of rows for
  // people who never played in the selected period/type.
  const matrixParticipants = useMemo(
    () => activeStats.map((s) => ({ id: s.id, name: s.name })),
    [activeStats]
  );

  const matrix = useMemo(
    () => computeHeadToHeadMatrix(matrixParticipants, filteredGames),
    [matrixParticipants, filteredGames]
  );
  const matrixMaxAbs = useMemo(
    () => matrix.reduce((max, c) => Math.max(max, Math.abs(c.netPoints)), 0),
    [matrix]
  );

  const nemesisVictim = useMemo(() => {
    const activeIds = new Set(matrixParticipants.map((p) => p.id));
    return computeNemesisAndVictim(participants, filteredGames).filter((nv) =>
      activeIds.has(nv.id)
    );
  }, [participants, matrixParticipants, filteredGames]);

  // 종목별 성적 intentionally ignores the page's own 종목 filter (a per-type
  // comparison is meaningless once already narrowed to one type) but still
  // respects the 기간 filter — see the note rendered under its heading.
  const periodOnlyGames = useMemo(
    () => filterGamesByPreset(activeGames(games), range, customRange),
    [games, range, customRange]
  );
  const gameTypeStats = useMemo(
    () => computeGameTypeStats(participants, periodOnlyGames),
    [participants, periodOnlyGames]
  );

  // 기록실은 항상 통산(전체 기간·전체 종목) 기준 — 필터를 타지 않는다는 걸
  // 아래 UI에 명시한다.
  const records = useMemo(
    () => computeRecords(participants, games),
    [participants, games]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 bg-white rounded-2xl border border-slate-200 p-4">
        <div>
          <span className="text-xs text-slate-400 block mb-1">기간</span>
          <div className="flex gap-1 flex-wrap">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRange(opt.value)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition ${
                  range === opt.value
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {range === "custom" && (
            <div className="flex items-center gap-2 mt-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
              />
              <span className="text-xs text-slate-400">~</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
              />
            </div>
          )}
        </div>
        <div>
          <span className="text-xs text-slate-400 block mb-1">추이 단위</span>
          <div className="flex gap-1">
            {GROUPING_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setGrouping(opt.value)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition ${
                  grouping === opt.value
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="text-xs text-slate-400 block mb-1">종목</span>
          <div className="flex gap-1">
            {GAME_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setGameType(opt.value)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition ${
                  gameType === opt.value
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">순위표 ({filteredGames.length}게임 기준)</h2>
        {activeStats.length === 0 ? (
          <p className="text-sm text-slate-400">해당 기간에 게임 기록이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-xs">
                  <th className="py-2 pr-4">이름</th>
                  <th className="py-2 pr-4">참여</th>
                  <th className="py-2 pr-4">승</th>
                  <th className="py-2 pr-4">무</th>
                  <th className="py-2 pr-4">패</th>
                  <th className="py-2 pr-4">승률A</th>
                  <th className="py-2 pr-4">승률B</th>
                  <th className="py-2 pr-4">순점수</th>
                  <th className="py-2 pr-4" />
                </tr>
              </thead>
              <tbody>
                {activeStats
                  .slice()
                  .sort((a, b) => b.netPoints - a.netPoints)
                  .map((s) => (
                    <tr
                      key={s.id}
                      className={`border-t border-slate-100 ${
                        h2hParticipantId === s.id ? "bg-slate-50" : ""
                      }`}
                    >
                      <td className="py-2 pr-4 font-medium">{s.name}</td>
                      <td className="py-2 pr-4 text-slate-500">{s.appearances}</td>
                      <td className="py-2 pr-4 text-emerald-600">{s.wins}</td>
                      <td className="py-2 pr-4 text-slate-400">
                        {s.appearances - s.wins - s.losses}
                      </td>
                      <td className="py-2 pr-4 text-red-500">{s.losses}</td>
                      <td className="py-2 pr-4 text-slate-500">
                        {(s.winRate * 100).toFixed(0)}%
                      </td>
                      <td className="py-2 pr-4 text-slate-500">
                        {(s.winRateB * 100).toFixed(0)}%
                      </td>
                      <td
                        className={`py-2 pr-4 font-semibold ${
                          s.netPoints > 0
                            ? "text-emerald-600"
                            : s.netPoints < 0
                            ? "text-red-500"
                            : "text-slate-400"
                        }`}
                      >
                        {s.netPoints > 0 ? "+" : ""}
                        {s.netPoints}
                      </td>
                      <td className="py-2 pr-4">
                        <button
                          type="button"
                          onClick={() =>
                            setH2hParticipantId((cur) => (cur === s.id ? null : s.id))
                          }
                          className={`text-xs px-2 py-1 rounded-lg font-medium transition whitespace-nowrap ${
                            h2hParticipantId === s.id
                              ? "bg-slate-900 text-white"
                              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                          }`}
                        >
                          상대 전적
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h2 className="font-semibold">분기 티어</h2>
          {availableTierQuarters.length > 0 && (
            <select
              value={effectiveTierQuarter ?? ""}
              onChange={(e) => setTierQuarter(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
            >
              {availableTierQuarters.map((q) => (
                <option key={q} value={q}>
                  {formatQuarterKey(q)}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="text-xs text-slate-400 mb-4">
          위 기간·종목 필터와 무관하게 항상 분기 단위로 계산됩니다. 승
          지수·패 지수는 1.00이 기대치입니다.
        </p>

        <div className="flex gap-1 mb-4 flex-wrap">
          {TIER_GAME_TYPE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setTierGameType(tab.value)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition ${
                tierGameType === tab.value
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {!effectiveTierQuarter || visibleTierRows.length === 0 ? (
          <p className="text-sm text-slate-400">
            이 종목으로는 아직 분기 티어를 계산할 만한 기록이 없습니다.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleTierRows.map((row) => (
              <TierCard key={row.id} row={row} />
            ))}
          </div>
        )}

        <p className="text-xs text-slate-400 mt-4">
          참석 인원수로 계산한 기대 승·패 대비 성과로 매깁니다 — 4인전 기대
          승률 25%, 5인전 20%. 판돈(점수)과 표본 크기도 반영되며, 분기마다
          리셋되되 직전 분기 성적이 35% 이어집니다.
        </p>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-1">성향 맵</h2>
        <p className="text-xs text-slate-400 mb-4">
          위 기간·종목 필터와 무관하게 항상 최근 3개월(90일 롤링) 기준입니다.
          등급이나 뱃지가 아니라 좌표 위 위치로만 성향을 보여줍니다.
        </p>

        <div className="flex gap-1 mb-4 flex-wrap">
          {TIER_GAME_TYPE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStyleMapGameType(tab.value)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium transition ${
                styleMapGameType === tab.value
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {styleMapPoints.length === 0 ? (
          <p className="text-sm text-slate-400">
            이 종목으로는 최근 90일 내 기록이 없습니다.
          </p>
        ) : (
          <StyleMapChart points={styleMapPoints} />
        )}

        <p className="text-xs text-slate-400 mt-4">
          가로 = 적극성(1.00 = 기대치. 오른쪽일수록 Win 아니면 Lose로 끝나는
          판이 많고, 왼쪽일수록 무로 지나가는 판이 많습니다) / 세로 = 손익(0 =
          본전). 판수가 적을수록 점이 크게 튈 수 있어 작고 흐리게 표시됩니다.
        </p>
      </section>

      {h2hParticipantId && (
        <HeadToHeadPanel
          participants={participants}
          games={filteredGames}
          participantId={h2hParticipantId}
        />
      )}

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-1">상대 전적 매트릭스</h2>
        <p className="text-xs text-slate-400 mb-4">
          행 참가자가 열 참가자를 상대로 딴 순점수입니다. 초록은 우세, 빨강은
          열세이며 색이 진할수록 격차가 큽니다.
        </p>
        {matrixParticipants.length < 2 ? (
          <p className="text-sm text-slate-400">
            비교할 참가자가 2명 이상일 때 표시됩니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm border-collapse">
              <thead>
                <tr>
                  <th className="p-2" />
                  {matrixParticipants.map((p) => (
                    <th
                      key={p.id}
                      className="p-2 text-xs font-medium text-slate-500 whitespace-nowrap"
                    >
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixParticipants.map((row) => (
                  <tr key={row.id}>
                    <th className="p-2 text-xs font-medium text-slate-500 text-right whitespace-nowrap">
                      {row.name}
                    </th>
                    {matrixParticipants.map((col) => {
                      if (row.id === col.id) {
                        return (
                          <td
                            key={col.id}
                            className="p-2 text-center text-slate-300 bg-slate-50"
                          >
                            -
                          </td>
                        );
                      }
                      const cell = matrix.find(
                        (c) => c.rowId === row.id && c.colId === col.id
                      );
                      const net = cell?.netPoints ?? 0;
                      return (
                        <td
                          key={col.id}
                          className="p-2 text-center font-medium"
                          style={heatmapStyle(net, matrixMaxAbs)}
                        >
                          {cell && cell.games > 0 ? (net > 0 ? `+${net}` : net) : "-"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">천적 / 밥</h2>
        {nemesisVictim.filter((nv) => nv.nemesis || nv.victim).length === 0 ? (
          <p className="text-sm text-slate-400">
            아직 상대 전적을 계산할 만한 데이터가 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-xs">
                  <th className="py-2 pr-4">이름</th>
                  <th className="py-2 pr-4">천적 (가장 많이 짐)</th>
                  <th className="py-2 pr-4">밥 (가장 많이 이김)</th>
                </tr>
              </thead>
              <tbody>
                {nemesisVictim
                  .filter((nv) => nv.nemesis || nv.victim)
                  .map((nv) => (
                    <tr key={nv.id} className="border-t border-slate-100">
                      <td className="py-2 pr-4 font-medium">{nv.name}</td>
                      <td className="py-2 pr-4 text-red-500">
                        {nv.nemesis
                          ? `${nv.nemesis.opponentName} (-${nv.nemesis.pointsLost})`
                          : "-"}
                      </td>
                      <td className="py-2 pr-4 text-emerald-600">
                        {nv.victim
                          ? `${nv.victim.opponentName} (+${nv.victim.pointsWon})`
                          : "-"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-1">종목별 성적</h2>
        <p className="text-xs text-slate-400 mb-4">
          이 표는 화면 상단의 종목 필터와 무관하게 항상 전체 종목을
          비교합니다 (기간 필터는 적용됩니다).
        </p>
        {gameTypeStats.length === 0 ? (
          <p className="text-sm text-slate-400">
            종목이 지정된 게임 기록이 아직 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-xs">
                  <th className="py-2 pr-4">종목</th>
                  <th className="py-2 pr-4">이름</th>
                  <th className="py-2 pr-4">참여</th>
                  <th className="py-2 pr-4">승</th>
                  <th className="py-2 pr-4">무</th>
                  <th className="py-2 pr-4">패</th>
                  <th className="py-2 pr-4">승률A</th>
                  <th className="py-2 pr-4">승률B</th>
                  <th className="py-2 pr-4">순점수</th>
                </tr>
              </thead>
              <tbody>
                {GAME_TYPES.flatMap((gt) => {
                  const rows = gameTypeStats
                    .filter((s) => s.gameType === gt)
                    .sort((a, b) => b.winRate - a.winRate || b.winRateB - a.winRateB);
                  return rows.map((s, i) => (
                    <tr key={`${gt}-${s.id}`} className="border-t border-slate-100">
                      <td className="py-2 pr-4 text-slate-500">
                        {i === 0 ? GAME_TYPE_LABELS[gt] : ""}
                      </td>
                      <td className="py-2 pr-4 font-medium">{s.name}</td>
                      <td className="py-2 pr-4 text-slate-500">{s.appearances}</td>
                      <td className="py-2 pr-4 text-emerald-600">{s.wins}</td>
                      <td className="py-2 pr-4 text-slate-400">
                        {s.appearances - s.wins - s.losses}
                      </td>
                      <td className="py-2 pr-4 text-red-500">{s.losses}</td>
                      <td className="py-2 pr-4 text-slate-500">
                        {(s.winRate * 100).toFixed(0)}%
                      </td>
                      <td className="py-2 pr-4 text-slate-500">
                        {(s.winRateB * 100).toFixed(0)}%
                      </td>
                      <td
                        className={`py-2 pr-4 font-semibold ${
                          s.netPoints > 0
                            ? "text-emerald-600"
                            : s.netPoints < 0
                            ? "text-red-500"
                            : "text-slate-400"
                        }`}
                      >
                        {s.netPoints > 0 ? "+" : ""}
                        {s.netPoints}
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">참가자별 승 / 패</h2>
        {winLossData.length === 0 ? (
          <p className="text-sm text-slate-400">데이터가 없습니다.</p>
        ) : (
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={winLossData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="승" fill="#059669" radius={[4, 4, 0, 0]} />
                <Bar dataKey="패" fill="#dc2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">기간별 게임 수 추이</h2>
        {trendData.length === 0 ? (
          <p className="text-sm text-slate-400">데이터가 없습니다.</p>
        ) : (
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="게임수" fill="#0f172a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">참가자별 누적 순점수 추이</h2>
        {cumulativeData.length === 0 ? (
          <p className="text-sm text-slate-400">데이터가 없습니다.</p>
        ) : (
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <LineChart data={cumulativeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} hide={cumulativeData.length > 20} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                {trackedNames.map((name, i) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={PALETTE[i % PALETTE.length]}
                    dot={false}
                    strokeWidth={2}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-1">기록실</h2>
        <p className="text-xs text-slate-400 mb-4">
          위 기간·종목 필터와 무관하게 항상 통산 기준입니다.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <RecordCategory label="최장 연승" tiers={records.longestWinStreak} unit="연승" />
          <RecordCategory label="최장 연패" tiers={records.longestLossStreak} unit="연패" />
          <RecordCategory
            label="하루 최다 승리"
            tiers={records.mostWinsInOneDay}
            unit="승"
          />
          <RecordCategory
            label="최다 참석 (개근왕)"
            tiers={records.mostAppearances}
            unit="회"
          />
        </div>
      </section>
    </div>
  );
}

/** One participant's quarterly tier card — placement-in-progress and ranked participants render differently (PRD §16.7). */
function TierCard({ row }: { row: TierRow }) {
  const delta = tierDelta(row);
  const placementProgress = Math.min(1, row.weight / TIER_MIN_WEIGHT);

  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm truncate">{row.name}</span>
        <DeltaArrow delta={delta} />
      </div>

      {row.tier === "unranked" ? (
        <div>
          <p className="text-xs text-slate-500 mb-1">배치 중 ({row.games}판)</p>
          <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full bg-slate-400"
              style={{ width: `${placementProgress * 100}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <TierBadge tier={row.tier} />
          <span className="text-sm font-semibold text-slate-900">
            {Math.round(row.tr)} TR
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-500">
        <span>승 지수 {row.winIndex.toFixed(2)}</span>
        <span>패 지수 {row.lossIndex.toFixed(2)}</span>
        <span>{row.games}판 참여</span>
        <span>신뢰도 {(row.confidence * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}

// PRD §16.8 — point radius/opacity scale with recent games so a 1-game point
// reads as "small, unreliable" without needing a sample-size gate to hide it.
const STYLE_MAP_MIN_RADIUS = 4;
const STYLE_MAP_MAX_RADIUS = 13;

function styleMapRadius(games: number, maxGames: number): number {
  if (maxGames <= 1) return STYLE_MAP_MAX_RADIUS;
  const t = Math.min(1, (games - 1) / (maxGames - 1));
  return STYLE_MAP_MIN_RADIUS + t * (STYLE_MAP_MAX_RADIUS - STYLE_MAP_MIN_RADIUS);
}

function styleMapOpacity(games: number, maxGames: number): number {
  if (maxGames <= 1) return 0.9;
  const t = Math.min(1, (games - 1) / (maxGames - 1));
  return 0.35 + t * 0.55;
}

/** Custom <Scatter> dot: size/opacity encode `games`, a dashed ring marks a point clamped to the fixed domain edge (its true value lies outside what's shown). */
function StyleMapDot(props: {
  cx?: number;
  cy?: number;
  payload?: StyleMapPlotPoint;
  maxGames: number;
}) {
  const { cx, cy, payload, maxGames } = props;
  if (cx === undefined || cy === undefined || !payload) return null;
  const r = styleMapRadius(payload.games, maxGames);
  const opacity = styleMapOpacity(payload.games, maxGames);
  const fill = payload.performance >= 0 ? "#059669" : "#dc2626";
  return (
    <circle
      cx={cx}
      cy={cy}
      r={r}
      fill={fill}
      fillOpacity={opacity}
      stroke={payload.clamped ? "#0f172a" : "none"}
      strokeWidth={payload.clamped ? 1.5 : 0}
      strokeDasharray={payload.clamped ? "3 2" : undefined}
    />
  );
}

function StyleMapTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: StyleMapPlotPoint }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-3 py-2 text-xs space-y-0.5">
      <p className="font-semibold text-slate-900">{p.name}</p>
      <p className="text-slate-500">적극성 {p.engagement.toFixed(2)}</p>
      <p className="text-slate-500">손익 {p.performance >= 0 ? "+" : ""}{p.performance.toFixed(2)}</p>
      <p className="text-slate-500">승 지수 {p.winIndex.toFixed(2)} · 패 지수 {p.lossIndex.toFixed(2)}</p>
      <p className="text-slate-500">최근 90일 {p.games}판</p>
      {p.clamped && <p className="text-amber-600">* 실제 값은 표시 범위를 벗어남</p>}
    </div>
  );
}

/** PRD §16.8 fixed-domain scatter — X=적극성(ENG), Y=손익(PERF), never auto-scales. */
function StyleMapChart({ points }: { points: StyleMapPlotPoint[] }) {
  const maxGames = points.reduce((max, p) => Math.max(max, p.games), 1);

  return (
    <div style={{ width: "100%", height: 420 }}>
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis
            type="number"
            dataKey="x"
            domain={STYLE_MAP_X_DOMAIN}
            ticks={STYLE_MAP_X_TICKS}
            allowDataOverflow
            tick={{ fontSize: 12 }}
            label={{ value: "적극성 (ENG)", position: "insideBottom", offset: -10, fontSize: 12 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={STYLE_MAP_Y_DOMAIN}
            ticks={STYLE_MAP_Y_TICKS}
            allowDataOverflow
            tick={{ fontSize: 12 }}
            label={{ value: "손익 (PERF)", angle: -90, position: "insideLeft", fontSize: 12 }}
          />
          <ReferenceArea x1={1.0} x2={STYLE_MAP_X_DOMAIN[1]} y1={0} y2={STYLE_MAP_Y_DOMAIN[1]} fill="#059669" fillOpacity={0.06} label={{ value: "승부사", position: "insideTopRight", fontSize: 11, fill: "#059669" }} />
          <ReferenceArea x1={1.0} x2={STYLE_MAP_X_DOMAIN[1]} y1={STYLE_MAP_Y_DOMAIN[0]} y2={0} fill="#dc2626" fillOpacity={0.06} label={{ value: "불나방", position: "insideBottomRight", fontSize: 11, fill: "#dc2626" }} />
          <ReferenceArea x1={STYLE_MAP_X_DOMAIN[0]} x2={1.0} y1={0} y2={STYLE_MAP_Y_DOMAIN[1]} fill="#059669" fillOpacity={0.06} label={{ value: "실속파", position: "insideTopLeft", fontSize: 11, fill: "#059669" }} />
          <ReferenceArea x1={STYLE_MAP_X_DOMAIN[0]} x2={1.0} y1={STYLE_MAP_Y_DOMAIN[0]} y2={0} fill="#dc2626" fillOpacity={0.06} label={{ value: "조공러", position: "insideBottomLeft", fontSize: 11, fill: "#dc2626" }} />
          <ReferenceLine x={1.0} stroke="#cbd5e1" />
          <ReferenceLine y={0} stroke="#cbd5e1" />
          <Tooltip content={<StyleMapTooltip />} />
          <Scatter
            data={points}
            shape={(props: unknown) => (
              <StyleMapDot {...(props as { cx?: number; cy?: number; payload?: StyleMapPlotPoint })} maxGames={maxGames} />
            )}
          >
            <LabelList dataKey="name" position="top" style={{ fontSize: 10, fill: "#475569" }} />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function DeltaArrow({ delta }: { delta: TierDelta }) {
  if (delta === "new") {
    return (
      <span className="text-xs font-semibold text-blue-500 whitespace-nowrap">
        NEW
      </span>
    );
  }
  if (delta === "up") {
    return (
      <span className="text-xs font-semibold text-emerald-600 whitespace-nowrap">
        ▲ 상승
      </span>
    );
  }
  if (delta === "down") {
    return (
      <span className="text-xs font-semibold text-red-500 whitespace-nowrap">
        ▼ 하락
      </span>
    );
  }
  return (
    <span className="text-xs font-medium text-slate-300 whitespace-nowrap">
      − 유지
    </span>
  );
}

function formatRecordEntry(e: RecordTierEntry, unit: string): string {
  const range =
    e.startDate && e.endDate
      ? e.startDate === e.endDate
        ? ` (${e.startDate})`
        : ` (${e.startDate} ~ ${e.endDate})`
      : "";
  return `${e.name} · ${e.value}${unit}${range}`;
}

/** Renders up to 3 dense-ranked tiers (from computeRecords' topTiers), each tier possibly holding several tied entries shown as "공동 N위". */
function RecordCategory({
  label,
  tiers,
  unit,
}: {
  label: string;
  tiers: RecordTier[];
  unit: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
      <p className="text-xs text-slate-400 mb-1.5">{label}</p>
      {tiers.length === 0 ? (
        <p className="text-sm text-slate-400">아직 없음</p>
      ) : (
        <ul className="space-y-1">
          {tiers.map((tier) => (
            <li key={tier.rank} className="text-sm">
              <span className="text-slate-400 mr-1.5 whitespace-nowrap">
                {tier.entries.length > 1 ? `공동 ${tier.rank}위` : `${tier.rank}위`}
              </span>
              <span className="font-semibold text-slate-900">
                {tier.entries.map((e) => formatRecordEntry(e, unit)).join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HeadToHeadPanel({
  participants,
  games,
  participantId,
}: {
  participants: ParticipantLite[];
  games: GameResult[];
  participantId: string;
}) {
  const entries = useMemo(
    () => computeHeadToHead(participants, games, participantId),
    [participants, games, participantId]
  );
  const name = participants.find((p) => p.id === participantId)?.name ?? "";

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5">
      <h2 className="font-semibold mb-1">{name}의 상대 전적</h2>
      <p className="text-xs text-slate-400 mb-4">
        위 기간·종목 필터가 그대로 적용됩니다. 게임의 Win/Lose로 이동한 점수만
        집계하며, 정산·기부는 포함하지 않습니다.
      </p>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-400">해당 기간에 상대 전적이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 text-xs">
                <th className="py-2 pr-4">상대</th>
                <th className="py-2 pr-4">딴 점수</th>
                <th className="py-2 pr-4">잃은 점수</th>
                <th className="py-2 pr-4">순점수</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const net = e.pointsWon - e.pointsLost;
                return (
                  <tr key={e.opponentId} className="border-t border-slate-100">
                    <td className="py-2 pr-4 font-medium">{e.opponentName}</td>
                    <td className="py-2 pr-4 text-emerald-600">{e.pointsWon}</td>
                    <td className="py-2 pr-4 text-red-500">{e.pointsLost}</td>
                    <td
                      className={`py-2 pr-4 font-semibold ${
                        net > 0
                          ? "text-emerald-600"
                          : net < 0
                          ? "text-red-500"
                          : "text-slate-400"
                      }`}
                    >
                      {net > 0 ? "+" : ""}
                      {net}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
