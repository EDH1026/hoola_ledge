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
} from "recharts";
import { GAME_TYPE_LABELS, GAME_TYPES, GameResult } from "@/lib/types";
import { activeGames } from "@/lib/games";
import {
  computeParticipantStats,
  computeHeadToHead,
  computeHeadToHeadMatrix,
  computeNemesisAndVictim,
  computeCumulativeNetPointsTrend,
  groupGamesByPeriod,
  filterByDatePreset,
  filterGamesByType,
  GameTypeFilter,
  PeriodGrouping,
  RangePreset,
} from "@/lib/stats";

interface ParticipantLite {
  id: string;
  name: string;
  active: boolean;
}

const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "today", label: "오늘" },
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
  "#e2e8f0",
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

// Dark-theme chart chrome — recharts' own defaults (light grid lines, a
// near-black tick fill, a white Tooltip content box) assume a white page and
// would otherwise render as stray light artifacts against this app's dark
// theme.
const CHART_GRID_STROKE = "#1e293b"; // slate-800
const CHART_TICK_FILL = "#94a3b8"; // slate-400
const CHART_TOOLTIP_PROPS = {
  contentStyle: {
    backgroundColor: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: 8,
  },
  labelStyle: { color: "#f1f5f9" },
  itemStyle: { color: "#f1f5f9" },
};
const CHART_LEGEND_PROPS = { wrapperStyle: { color: "#cbd5e1" } };

/** Small per-section 종목 filter — v2.16: each stats section gets its own, independent of the others, rather than one filter driving the whole page. */
function GameTypeFilterButtons({
  value,
  onChange,
}: {
  value: GameTypeFilter;
  onChange: (v: GameTypeFilter) => void;
}) {
  return (
    <div className="flex gap-1 flex-wrap">
      {GAME_TYPE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`text-xs px-2.5 py-1 rounded-lg font-medium transition ${
            value === opt.value
              ? "bg-slate-100 text-slate-900"
              : "bg-slate-800 text-slate-300 hover:bg-slate-600"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Small per-section 추이 단위 filter — only used by the two trend sections (v2.16 removed it from the common filter bar). */
function GroupingFilterButtons({
  value,
  onChange,
}: {
  value: PeriodGrouping;
  onChange: (v: PeriodGrouping) => void;
}) {
  return (
    <div className="flex gap-1 flex-wrap">
      {GROUPING_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`text-xs px-2.5 py-1 rounded-lg font-medium transition ${
            value === opt.value
              ? "bg-slate-100 text-slate-900"
              : "bg-slate-800 text-slate-300 hover:bg-slate-600"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export default function StatsClient({
  participants,
  games,
  initialH2hParticipantId = null,
}: {
  participants: ParticipantLite[];
  games: GameResult[];
  initialH2hParticipantId?: string | null;
}) {
  // v2.16: only 기간 is a page-wide filter now. 종목은 섹션마다 따로 걸고,
  // 추이 단위는 실제로 그걸 쓰는 두 추이 섹션에만 있다.
  const [range, setRange] = useState<RangePreset>("30d");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  // Only consulted when range === "custom"; harmless to always pass.
  const customRange = useMemo(
    () => ({ start: customStart || undefined, end: customEnd || undefined }),
    [customStart, customEnd]
  );

  const periodGames = useMemo(
    () => filterByDatePreset(activeGames(games), range, customRange),
    [games, range, customRange]
  );

  // ---------- 1. 순위표 (+ 클릭 시 나오는 상대 전적) ----------
  const [leaderboardGameType, setLeaderboardGameType] = useState<GameTypeFilter>("all");
  const [h2hParticipantId, setH2hParticipantId] = useState<string | null>(
    initialH2hParticipantId
  );
  const leaderboardGames = useMemo(
    () => filterGamesByType(periodGames, leaderboardGameType),
    [periodGames, leaderboardGameType]
  );
  const stats = useMemo(
    () => computeParticipantStats(participants, leaderboardGames),
    [participants, leaderboardGames]
  );
  const activeStats = stats.filter((s) => s.appearances > 0);

  // ---------- 3. 상대 전적 매트릭스 ----------
  const [matrixGameType, setMatrixGameType] = useState<GameTypeFilter>("all");
  const matrixGames = useMemo(
    () => filterGamesByType(periodGames, matrixGameType),
    [periodGames, matrixGameType]
  );
  const matrixParticipants = useMemo(
    () =>
      computeParticipantStats(participants, matrixGames)
        .filter((s) => s.appearances > 0)
        .map((s) => ({ id: s.id, name: s.name })),
    [participants, matrixGames]
  );
  const matrix = useMemo(
    () => computeHeadToHeadMatrix(matrixParticipants, matrixGames),
    [matrixParticipants, matrixGames]
  );
  const matrixMaxAbs = useMemo(
    () => matrix.reduce((max, c) => Math.max(max, Math.abs(c.netPoints)), 0),
    [matrix]
  );

  // ---------- 4. 천적 / 밥 ----------
  const [nemesisGameType, setNemesisGameType] = useState<GameTypeFilter>("all");
  const nemesisGames = useMemo(
    () => filterGamesByType(periodGames, nemesisGameType),
    [periodGames, nemesisGameType]
  );
  const nemesisVictim = useMemo(() => {
    const activeIds = new Set(
      computeParticipantStats(participants, nemesisGames)
        .filter((s) => s.appearances > 0)
        .map((s) => s.id)
    );
    return computeNemesisAndVictim(participants, nemesisGames).filter((nv) =>
      activeIds.has(nv.id)
    );
  }, [participants, nemesisGames]);

  // ---------- 5. 참가자별 승 / 패 ----------
  const [winLossGameType, setWinLossGameType] = useState<GameTypeFilter>("all");
  const winLossGames = useMemo(
    () => filterGamesByType(periodGames, winLossGameType),
    [periodGames, winLossGameType]
  );
  const winLossData = useMemo(
    () =>
      computeParticipantStats(participants, winLossGames)
        .filter((s) => s.appearances > 0)
        .map((s) => ({ name: s.name, 승: s.wins, 패: s.losses })),
    [participants, winLossGames]
  );

  // ---------- 6. 참가자별 누적 순점수 추이 ----------
  const [cumulativeGameType, setCumulativeGameType] = useState<GameTypeFilter>("all");
  const [cumulativeGrouping, setCumulativeGrouping] = useState<PeriodGrouping>("week");
  const cumulativeGames = useMemo(
    () => filterGamesByType(periodGames, cumulativeGameType),
    [periodGames, cumulativeGameType]
  );
  const cumulativeRows = useMemo(
    () => computeCumulativeNetPointsTrend(cumulativeGames, cumulativeGrouping),
    [cumulativeGames, cumulativeGrouping]
  );
  const cumulativeData = useMemo(() => {
    const nameOf = new Map(participants.map((p) => [p.id, p.name]));
    return cumulativeRows.map((row) => {
      const out: Record<string, string | number> = { label: row.label };
      for (const [id, val] of Object.entries(row.values)) {
        out[nameOf.get(id) ?? id] = val;
      }
      return out;
    });
  }, [cumulativeRows, participants]);
  const trackedNames = useMemo(() => {
    const names = new Set<string>();
    for (const row of cumulativeData) {
      for (const key of Object.keys(row)) {
        if (key !== "label") names.add(key);
      }
    }
    return Array.from(names);
  }, [cumulativeData]);

  // ---------- 7. 기간별 게임 수 추이 ----------
  const [trendGameType, setTrendGameType] = useState<GameTypeFilter>("all");
  const [trendGrouping, setTrendGrouping] = useState<PeriodGrouping>("week");
  const trendGames = useMemo(
    () => filterGamesByType(periodGames, trendGameType),
    [periodGames, trendGameType]
  );
  const buckets = useMemo(
    () => groupGamesByPeriod(trendGames, trendGrouping),
    [trendGames, trendGrouping]
  );
  const trendData = buckets.map((b) => ({ label: b.label, 게임수: b.gameCount }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-4 bg-slate-900 rounded-2xl border border-slate-800 p-4">
        <div>
          <span className="text-xs text-slate-500 block mb-1">기간</span>
          <div className="flex gap-1 flex-wrap">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRange(opt.value)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition ${
                  range === opt.value
                    ? "bg-slate-100 text-slate-900"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-600"
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
                className="bg-slate-900 rounded-lg border border-slate-700 px-2 py-1 text-xs"
              />
              <span className="text-xs text-slate-500">~</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="bg-slate-900 rounded-lg border border-slate-700 px-2 py-1 text-xs"
              />
            </div>
          )}
        </div>
      </div>

      <section className="bg-slate-900 rounded-2xl border border-slate-800 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h2 className="font-semibold">순위표 ({leaderboardGames.length}게임 기준)</h2>
          <GameTypeFilterButtons value={leaderboardGameType} onChange={setLeaderboardGameType} />
        </div>
        <div className="h-3" />
        {activeStats.length === 0 ? (
          <p className="text-sm text-slate-500">해당 조건에 게임 기록이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 text-xs">
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
                      className={`border-t border-slate-800 ${
                        h2hParticipantId === s.id ? "bg-slate-800" : ""
                      }`}
                    >
                      <td className="py-2 pr-4 font-medium">{s.name}</td>
                      <td className="py-2 pr-4 text-slate-400">{s.appearances}</td>
                      <td className="py-2 pr-4 text-emerald-400">{s.wins}</td>
                      <td className="py-2 pr-4 text-slate-500">
                        {s.appearances - s.wins - s.losses}
                      </td>
                      <td className="py-2 pr-4 text-red-500">{s.losses}</td>
                      <td className="py-2 pr-4 text-slate-400">
                        {(s.winRate * 100).toFixed(0)}%
                      </td>
                      <td className="py-2 pr-4 text-slate-400">
                        {(s.winRateB * 100).toFixed(0)}%
                      </td>
                      <td
                        className={`py-2 pr-4 font-semibold ${
                          s.netPoints > 0
                            ? "text-emerald-400"
                            : s.netPoints < 0
                            ? "text-red-500"
                            : "text-slate-500"
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
                              ? "bg-slate-100 text-slate-900"
                              : "bg-slate-800 text-slate-300 hover:bg-slate-600"
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

      {h2hParticipantId && (
        <HeadToHeadPanel
          participants={participants}
          games={leaderboardGames}
          participantId={h2hParticipantId}
        />
      )}

      <section className="bg-slate-900 rounded-2xl border border-slate-800 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h2 className="font-semibold">상대 전적 매트릭스</h2>
          <GameTypeFilterButtons value={matrixGameType} onChange={setMatrixGameType} />
        </div>
        <p className="text-xs text-slate-500 mb-4">
          행 참가자가 열 참가자를 상대로 딴 순점수입니다. 초록은 우세, 빨강은
          열세이며 색이 진할수록 격차가 큽니다.
        </p>
        {matrixParticipants.length < 2 ? (
          <p className="text-sm text-slate-500">
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
                      className="p-2 text-xs font-medium text-slate-400 whitespace-nowrap"
                    >
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixParticipants.map((row) => (
                  <tr key={row.id}>
                    <th className="p-2 text-xs font-medium text-slate-400 text-right whitespace-nowrap">
                      {row.name}
                    </th>
                    {matrixParticipants.map((col) => {
                      if (row.id === col.id) {
                        return (
                          <td
                            key={col.id}
                            className="p-2 text-center text-slate-600 bg-slate-800"
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

      <section className="bg-slate-900 rounded-2xl border border-slate-800 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-semibold">천적 / 밥</h2>
          <GameTypeFilterButtons value={nemesisGameType} onChange={setNemesisGameType} />
        </div>
        {nemesisVictim.filter((nv) => nv.nemesis || nv.victim).length === 0 ? (
          <p className="text-sm text-slate-500">
            아직 상대 전적을 계산할 만한 데이터가 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 text-xs">
                  <th className="py-2 pr-4">이름</th>
                  <th className="py-2 pr-4">천적 (가장 많이 짐)</th>
                  <th className="py-2 pr-4">밥 (가장 많이 이김)</th>
                </tr>
              </thead>
              <tbody>
                {nemesisVictim
                  .filter((nv) => nv.nemesis || nv.victim)
                  .map((nv) => (
                    <tr key={nv.id} className="border-t border-slate-800">
                      <td className="py-2 pr-4 font-medium">{nv.name}</td>
                      <td className="py-2 pr-4 text-red-500">
                        {nv.nemesis
                          ? `${nv.nemesis.opponentName} (-${nv.nemesis.pointsLost})`
                          : "-"}
                      </td>
                      <td className="py-2 pr-4 text-emerald-400">
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

      <section className="bg-slate-900 rounded-2xl border border-slate-800 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-semibold">참가자별 승 / 패</h2>
          <GameTypeFilterButtons value={winLossGameType} onChange={setWinLossGameType} />
        </div>
        {winLossData.length === 0 ? (
          <p className="text-sm text-slate-500">데이터가 없습니다.</p>
        ) : (
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={winLossData}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: CHART_TICK_FILL }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: CHART_TICK_FILL }} />
                <Tooltip {...CHART_TOOLTIP_PROPS} />
                <Legend {...CHART_LEGEND_PROPS} />
                <Bar dataKey="승" fill="#059669" radius={[4, 4, 0, 0]} />
                <Bar dataKey="패" fill="#dc2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="bg-slate-900 rounded-2xl border border-slate-800 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-semibold">참가자별 누적 순점수 추이</h2>
          <div className="flex flex-wrap gap-3">
            <GroupingFilterButtons value={cumulativeGrouping} onChange={setCumulativeGrouping} />
            <GameTypeFilterButtons value={cumulativeGameType} onChange={setCumulativeGameType} />
          </div>
        </div>
        {cumulativeData.length === 0 ? (
          <p className="text-sm text-slate-500">데이터가 없습니다.</p>
        ) : (
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <LineChart data={cumulativeData}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: CHART_TICK_FILL }}
                  hide={cumulativeData.length > 20}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: CHART_TICK_FILL }} />
                <Tooltip {...CHART_TOOLTIP_PROPS} />
                <Legend {...CHART_LEGEND_PROPS} />
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

      <section className="bg-slate-900 rounded-2xl border border-slate-800 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-semibold">기간별 게임 수 추이</h2>
          <div className="flex flex-wrap gap-3">
            <GroupingFilterButtons value={trendGrouping} onChange={setTrendGrouping} />
            <GameTypeFilterButtons value={trendGameType} onChange={setTrendGameType} />
          </div>
        </div>
        {trendData.length === 0 ? (
          <p className="text-sm text-slate-500">데이터가 없습니다.</p>
        ) : (
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: CHART_TICK_FILL }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: CHART_TICK_FILL }} />
                <Tooltip {...CHART_TOOLTIP_PROPS} />
                <Bar dataKey="게임수" fill="#e2e8f0" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
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
    <section className="bg-slate-900 rounded-2xl border border-slate-800 p-5">
      <h2 className="font-semibold mb-1">{name}의 상대 전적</h2>
      <p className="text-xs text-slate-500 mb-4">
        위 순위표 섹션의 기간·종목 필터가 그대로 적용됩니다. 게임의 Win/Lose로
        이동한 점수만 집계하며, 정산·기부는 포함하지 않습니다.
      </p>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">해당 조건에 상대 전적이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 text-xs">
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
                  <tr key={e.opponentId} className="border-t border-slate-800">
                    <td className="py-2 pr-4 font-medium">{e.opponentName}</td>
                    <td className="py-2 pr-4 text-emerald-400">{e.pointsWon}</td>
                    <td className="py-2 pr-4 text-red-500">{e.pointsLost}</td>
                    <td
                      className={`py-2 pr-4 font-semibold ${
                        net > 0
                          ? "text-emerald-400"
                          : net < 0
                          ? "text-red-500"
                          : "text-slate-500"
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
