"use client";

import { useMemo, type CSSProperties } from "react";
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
import { Card } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { FilterChip } from "@/components/ui/FilterChip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { useQueryParams } from "@/components/ui/useQueryParams";

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

const DEFAULT_RANGE: RangePreset = "30d";
const DEFAULT_GROUPING: PeriodGrouping = "week";

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

/** Shared 추이 단위 filter — used independently by the two trend sections (each keeps its own URL param, see StatsClient's cbucket/gbucket). */
function GroupingFilterButtons({
  value,
  onChange,
}: {
  value: PeriodGrouping;
  onChange: (v: PeriodGrouping) => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {GROUPING_OPTIONS.map((opt) => (
        <FilterChip
          key={opt.value}
          selected={value === opt.value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </FilterChip>
      ))}
    </div>
  );
}

export default function StatsClient({
  participants,
  games,
}: {
  participants: ParticipantLite[];
  games: GameResult[];
}) {
  // v2.19 (배치 B, PRD §24.12) — 9개 필터(기간 1 + 종목 6 + 추이단위 2)를
  // URL 검색 파라미터로 동기화한다. 종목 필터는 섹션마다 따로 있던 6개를
  // 페이지 레벨 1개로 합쳤다 — "훌라만 보기"에 같은 컨트롤을 6번 누를
  // 필요가 없어진다.
  const { searchParams, set } = useQueryParams();
  const range = (searchParams.get("range") as RangePreset | null) ?? DEFAULT_RANGE;
  const customStart = searchParams.get("from") ?? "";
  const customEnd = searchParams.get("to") ?? "";
  const gameType = (searchParams.get("type") as GameTypeFilter | null) ?? "all";
  const cumulativeGrouping =
    (searchParams.get("cbucket") as PeriodGrouping | null) ?? DEFAULT_GROUPING;
  const trendGrouping = (searchParams.get("gbucket") as PeriodGrouping | null) ?? DEFAULT_GROUPING;
  const h2hParticipantId = searchParams.get("h2h");

  const setRange = (v: RangePreset) => set({ range: v === DEFAULT_RANGE ? null : v });
  const setCustomStart = (v: string) => set({ from: v || null });
  const setCustomEnd = (v: string) => set({ to: v || null });
  const setGameType = (v: GameTypeFilter) => set({ type: v === "all" ? null : v });
  const setCumulativeGrouping = (v: PeriodGrouping) =>
    set({ cbucket: v === DEFAULT_GROUPING ? null : v });
  const setTrendGrouping = (v: PeriodGrouping) =>
    set({ gbucket: v === DEFAULT_GROUPING ? null : v });
  const setH2h = (id: string | null) => set({ h2h: id });
  /** 빈 상태의 "필터 초기화" — 기간이 좁아 결과가 없는 경우가 대부분이라 종목·기간 모두 넓힌다. */
  const resetFilters = () => set({ range: null, from: null, to: null, type: null });

  // Only consulted when range === "custom"; harmless to always pass.
  const customRange = useMemo(
    () => ({ start: customStart || undefined, end: customEnd || undefined }),
    [customStart, customEnd]
  );

  const periodGames = useMemo(
    () => filterByDatePreset(activeGames(games), range, customRange),
    [games, range, customRange]
  );
  // v2.19 — 종목 필터가 이제 페이지 레벨 1개이므로 모든 섹션이 같은
  // 필터링된 게임 목록을 공유한다(예전엔 섹션마다 독립적으로 필터링했다).
  const filteredGames = useMemo(
    () => filterGamesByType(periodGames, gameType),
    [periodGames, gameType]
  );

  // ---------- 1. 순위표 (+ 클릭 시 나오는 상대 전적) ----------
  const stats = useMemo(
    () => computeParticipantStats(participants, filteredGames),
    [participants, filteredGames]
  );
  const activeStats = stats.filter((s) => s.appearances > 0);

  // ---------- 3. 상대 전적 매트릭스 ----------
  const matrixParticipants = useMemo(
    () =>
      computeParticipantStats(participants, filteredGames)
        .filter((s) => s.appearances > 0)
        .map((s) => ({ id: s.id, name: s.name })),
    [participants, filteredGames]
  );
  const matrix = useMemo(
    () => computeHeadToHeadMatrix(matrixParticipants, filteredGames),
    [matrixParticipants, filteredGames]
  );
  const matrixMaxAbs = useMemo(
    () => matrix.reduce((max, c) => Math.max(max, Math.abs(c.netPoints)), 0),
    [matrix]
  );

  // ---------- 4. 천적 / 밥 ----------
  const nemesisVictim = useMemo(() => {
    const activeIds = new Set(
      computeParticipantStats(participants, filteredGames)
        .filter((s) => s.appearances > 0)
        .map((s) => s.id)
    );
    return computeNemesisAndVictim(participants, filteredGames).filter((nv) =>
      activeIds.has(nv.id)
    );
  }, [participants, filteredGames]);

  // ---------- 5. 참가자별 승 / 패 ----------
  const winLossData = useMemo(
    () =>
      computeParticipantStats(participants, filteredGames)
        .filter((s) => s.appearances > 0)
        .map((s) => ({ name: s.name, 승: s.wins, 패: s.losses })),
    [participants, filteredGames]
  );

  // ---------- 6. 참가자별 누적 순점수 추이 ----------
  const cumulativeRows = useMemo(
    () => computeCumulativeNetPointsTrend(filteredGames, cumulativeGrouping),
    [filteredGames, cumulativeGrouping]
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
  const buckets = useMemo(
    () => groupGamesByPeriod(filteredGames, trendGrouping),
    [filteredGames, trendGrouping]
  );
  const trendData = buckets.map((b) => ({ label: b.label, 게임수: b.gameCount }));

  return (
    <div className="space-y-6">
      <Card padding="sm">
        <div className="flex flex-wrap gap-4">
          <div>
            <span className="text-xs text-content-muted block mb-1">기간</span>
            <div className="flex gap-2 flex-wrap">
              {RANGE_OPTIONS.map((opt) => (
                <FilterChip
                  key={opt.value}
                  selected={range === opt.value}
                  onClick={() => setRange(opt.value)}
                >
                  {opt.label}
                </FilterChip>
              ))}
            </div>
            {range === "custom" && (
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="bg-surface rounded-lg border border-slate-700 px-2 py-1 text-xs text-content"
                />
                <span className="text-xs text-content-muted">~</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="bg-surface rounded-lg border border-slate-700 px-2 py-1 text-xs text-content"
                />
              </div>
            )}
          </div>
          <div>
            <span className="text-xs text-content-muted block mb-1">종목</span>
            <div className="flex gap-2 flex-wrap">
              {GAME_TYPE_OPTIONS.map((opt) => (
                <FilterChip
                  key={opt.value}
                  selected={gameType === opt.value}
                  onClick={() => setGameType(opt.value)}
                >
                  {opt.label}
                </FilterChip>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle>순위표 ({filteredGames.length}게임 기준)</SectionTitle>
        <div className="h-3" />
        {activeStats.length === 0 ? (
          <EmptyState
            title="해당 조건에 게임 기록이 없습니다."
            action={
              <Button variant="neutral" size="sm" onClick={resetFilters}>
                필터 초기화
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-content-muted text-xs">
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
                      className={`border-t border-line ${
                        h2hParticipantId === s.id ? "bg-surface-raised" : ""
                      }`}
                    >
                      <td className="py-2 pr-4 font-medium text-content">{s.name}</td>
                      <td className="py-2 pr-4 text-content-muted">{s.appearances}</td>
                      <td className="py-2 pr-4 text-emerald-400">{s.wins}</td>
                      <td className="py-2 pr-4 text-content-muted">
                        {s.appearances - s.wins - s.losses}
                      </td>
                      <td className="py-2 pr-4 text-lose">{s.losses}</td>
                      <td className="py-2 pr-4 text-content-muted">
                        {(s.winRate * 100).toFixed(0)}%
                      </td>
                      <td className="py-2 pr-4 text-content-muted">
                        {(s.winRateB * 100).toFixed(0)}%
                      </td>
                      <td
                        className={`py-2 pr-4 font-semibold ${
                          s.netPoints > 0
                            ? "text-emerald-400"
                            : s.netPoints < 0
                            ? "text-lose"
                            : "text-content-muted"
                        }`}
                      >
                        {s.netPoints > 0 ? "+" : ""}
                        {s.netPoints}
                      </td>
                      <td className="py-2 pr-4">
                        <FilterChip
                          selected={h2hParticipantId === s.id}
                          onClick={() => setH2h(h2hParticipantId === s.id ? null : s.id)}
                          className="whitespace-nowrap"
                        >
                          상대 전적
                        </FilterChip>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {h2hParticipantId && (
        <HeadToHeadPanel
          participants={participants}
          games={filteredGames}
          participantId={h2hParticipantId}
        />
      )}

      <Card>
        <SectionTitle description="행 참가자가 열 참가자를 상대로 딴 순점수입니다. 초록은 우세, 빨강은 열세이며 색이 진할수록 격차가 큽니다.">
          상대 전적 매트릭스
        </SectionTitle>
        {matrixParticipants.length < 2 ? (
          <div className="mt-4">
            <EmptyState
              title="비교할 참가자가 2명 이상일 때 표시됩니다."
              action={
                <Button variant="neutral" size="sm" onClick={resetFilters}>
                  필터 초기화
                </Button>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto mt-4">
            <table className="text-sm border-collapse tabular-nums">
              <thead>
                <tr>
                  <th className="p-2" />
                  {matrixParticipants.map((p) => (
                    <th
                      key={p.id}
                      className="p-2 text-xs font-medium text-content-muted whitespace-nowrap"
                    >
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixParticipants.map((row) => (
                  <tr key={row.id}>
                    <th className="p-2 text-xs font-medium text-content-muted text-right whitespace-nowrap">
                      {row.name}
                    </th>
                    {matrixParticipants.map((col) => {
                      if (row.id === col.id) {
                        return (
                          <td
                            key={col.id}
                            className="p-2 text-center text-content-muted bg-surface-raised"
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
                          className="p-2 text-center font-medium text-content"
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
      </Card>

      <Card>
        <SectionTitle>천적 / 밥</SectionTitle>
        {nemesisVictim.filter((nv) => nv.nemesis || nv.victim).length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="아직 상대 전적을 계산할 만한 데이터가 없습니다."
              action={
                <Button variant="neutral" size="sm" onClick={resetFilters}>
                  필터 초기화
                </Button>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-content-muted text-xs">
                  <th className="py-2 pr-4">이름</th>
                  <th className="py-2 pr-4">천적 (가장 많이 짐)</th>
                  <th className="py-2 pr-4">밥 (가장 많이 이김)</th>
                </tr>
              </thead>
              <tbody>
                {nemesisVictim
                  .filter((nv) => nv.nemesis || nv.victim)
                  .map((nv) => (
                    <tr key={nv.id} className="border-t border-line">
                      <td className="py-2 pr-4 font-medium text-content">{nv.name}</td>
                      <td className="py-2 pr-4 text-lose">
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
      </Card>

      <Card>
        <SectionTitle>참가자별 승 / 패</SectionTitle>
        {winLossData.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="데이터가 없습니다."
              action={
                <Button variant="neutral" size="sm" onClick={resetFilters}>
                  필터 초기화
                </Button>
              }
            />
          </div>
        ) : (
          <div style={{ width: "100%", height: 280 }} className="mt-4">
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
      </Card>

      <Card>
        <SectionTitle
          action={<GroupingFilterButtons value={cumulativeGrouping} onChange={setCumulativeGrouping} />}
        >
          참가자별 누적 순점수 추이
        </SectionTitle>
        {cumulativeData.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="데이터가 없습니다."
              action={
                <Button variant="neutral" size="sm" onClick={resetFilters}>
                  필터 초기화
                </Button>
              }
            />
          </div>
        ) : (
          <div style={{ width: "100%", height: 320 }} className="mt-4">
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
      </Card>

      <Card>
        <SectionTitle
          action={<GroupingFilterButtons value={trendGrouping} onChange={setTrendGrouping} />}
        >
          기간별 게임 수 추이
        </SectionTitle>
        {trendData.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="데이터가 없습니다."
              action={
                <Button variant="neutral" size="sm" onClick={resetFilters}>
                  필터 초기화
                </Button>
              }
            />
          </div>
        ) : (
          <div style={{ width: "100%", height: 240 }} className="mt-4">
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
      </Card>
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
    <Card>
      <SectionTitle description="위 순위표 섹션의 기간·종목 필터가 그대로 적용됩니다. 게임의 Win/Lose로 이동한 점수만 집계하며, 정산·기부는 포함하지 않습니다.">
        {name}의 상대 전적
      </SectionTitle>
      {entries.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="해당 조건에 상대 전적이 없습니다." />
        </div>
      ) : (
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-content-muted text-xs">
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
                  <tr key={e.opponentId} className="border-t border-line">
                    <td className="py-2 pr-4 font-medium text-content">{e.opponentName}</td>
                    <td className="py-2 pr-4 text-emerald-400">{e.pointsWon}</td>
                    <td className="py-2 pr-4 text-lose">{e.pointsLost}</td>
                    <td
                      className={`py-2 pr-4 font-semibold ${
                        net > 0
                          ? "text-emerald-400"
                          : net < 0
                          ? "text-lose"
                          : "text-content-muted"
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
    </Card>
  );
}
