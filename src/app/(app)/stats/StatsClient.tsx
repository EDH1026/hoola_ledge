"use client";

import { Fragment, useMemo, type CSSProperties } from "react";
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
  useYAxisScale,
  usePlotArea,
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
  CumulativeGrouping,
  RangePreset,
} from "@/lib/stats";
import { Card } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { FilterChip } from "@/components/ui/FilterChip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { useQueryParams } from "@/components/ui/useQueryParams";
import { buildParticipantColorMap, PARTICIPANT_COLOR_FALLBACK } from "@/lib/participant-colors";
import { HEAT_TIER_COLORS, HEAT_TIER_LABELS, HEAT_TIER_ORDER, heatTier } from "@/lib/heatmap-tiers";

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

// v2.21 (PRD §28.9.1) — 두 차트가 서로 다른 추이 단위 목록/기본값을 쓴다.
// "게임별"은 누적 순점수 추이에만 붙는다 — 기간별 게임 수 추이에 붙이면
// 모든 버킷이 항상 1이 되어 무의미하다.
const CUMULATIVE_GROUPING_OPTIONS: { value: CumulativeGrouping; label: string }[] = [
  { value: "game", label: "게임별" },
  { value: "day", label: "일별" },
  { value: "week", label: "주별" },
  { value: "month", label: "월별" },
  { value: "quarter", label: "분기별" },
  { value: "year", label: "연도별" },
];
const TREND_GROUPING_OPTIONS: { value: PeriodGrouping; label: string }[] = [
  { value: "day", label: "일별" },
  { value: "week", label: "주별" },
  { value: "month", label: "월별" },
  { value: "quarter", label: "분기별" },
  { value: "year", label: "연도별" },
];

const GAME_TYPE_OPTIONS: { value: GameTypeFilter; label: string }[] = [
  { value: "all", label: "전체" },
  ...GAME_TYPES.map((gt) => ({ value: gt, label: GAME_TYPE_LABELS[gt] })),
];

const DEFAULT_RANGE: RangePreset = "30d";
const DEFAULT_CUMULATIVE_GROUPING: CumulativeGrouping = "day";
const DEFAULT_TREND_GROUPING: PeriodGrouping = "week";

// v2.19 (배치 C, PRD §24.13) — the old continuous-alpha heatmap floored at
// 0.12/capped at 0.65, which against --color-surface measured ~1.07-2.7:1 —
// close to invisible at the low end and still weak at the high end, with no
// legend explaining the scale at all. A 5-step discrete scale (강한 열세 /
// 열세 / 호각 / 우세 / 강한 우세) is both easier to read at a glance and
// easier to guarantee contrast for, since there are only 5 fixed colors to
// check instead of a continuous range — every one of them is verified by
// scripts/verify-design-tokens.ts to hit >=1.5:1 against the surrounding
// surface and >=4.5:1 for light text on top of the tier color itself. Colors
// live in src/lib/heatmap-tiers.ts, not here, so that verify script can
// import the exact same values without pulling in a "use client" component.
function heatmapStyle(net: number, maxAbs: number): CSSProperties {
  return { backgroundColor: HEAT_TIER_COLORS[heatTier(net, maxAbs)] };
}

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

/** Shared 종목 filter — each of the 6 섹션 below keeps its own independent state/URL param (see each section's own *type key below); this just renders the chip row. */
function GameTypeFilterButtons({
  value,
  onChange,
}: {
  value: GameTypeFilter;
  onChange: (v: GameTypeFilter) => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {GAME_TYPE_OPTIONS.map((opt) => (
        <FilterChip key={opt.value} selected={value === opt.value} onClick={() => onChange(opt.value)}>
          {opt.label}
        </FilterChip>
      ))}
    </div>
  );
}

/** Shared 추이 단위 filter — used independently by the two trend sections (each keeps its own URL param and its own option list/default, see StatsClient's cbucket/gbucket). */
function GroupingFilterButtons<G extends string>({
  value,
  onChange,
  options,
}: {
  value: G;
  onChange: (v: G) => void;
  options: { value: G; label: string }[];
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((opt) => (
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

const LABEL_MIN_GAP = 14; // px — minimum vertical spacing between two end labels
// v2.22 (PRD §30.1) — 4자였던 걸 조금 더 줄였다. 한글 이름은 대부분
// 2~3자라 실제로 잘리는 경우는 드물고, 상한을 낮출수록 아래
// cumulativeLabelMargin이 회수하는 여백이 커진다.
const LABEL_MAX_NAME_LEN = 4;
// 실측(390px 뷰포트, 2자 한글 이름 기준) 최소로 필요한 값이 32px에
// 가까워, 28px까지만 낮춘다 — 더 내리면 라벨이 잘릴 위험이 생긴다.
const LABEL_MARGIN_MIN = 28; // px
const LABEL_MARGIN_MAX = 64; // px

function truncateName(name: string): string {
  return name.length > LABEL_MAX_NAME_LEN ? `${name.slice(0, LABEL_MAX_NAME_LEN)}…` : name;
}

/**
 * v2.22 (PRD §30.1) — the old fixed `margin.right: 76` assumed worst-case
 * (long) names; most tracked names here are 2-3 Korean characters, so a
 * fixed 76px left most of that margin empty. Sized instead from the actual
 * longest *displayed* (post-truncateName) label, clamped to a sane range —
 * `8 + maxChars * 10` roughly matches CumulativeEndLabels' own `labelX =
 * lineEndX + 6` offset plus per-character text width at fontSize 10.
 */
function cumulativeLabelMargin(trackedNames: string[]): number {
  if (trackedNames.length === 0) return LABEL_MARGIN_MIN;
  const maxChars = Math.max(...trackedNames.map((name) => truncateName(name).length));
  return Math.min(LABEL_MARGIN_MAX, Math.max(LABEL_MARGIN_MIN, 8 + maxChars * 10));
}

/**
 * v2.21 (PRD §28.9.2) — replaces the bottom <Legend> (unreadable once 8
 * lines are stacked: matching a line to a name means glancing back and
 * forth between the plot and a color swatch) with a name label at the right
 * end of each line, colored the same as the line.
 *
 * recharts 3.x deprecated <Customized> ("all charts are able to render
 * arbitrary elements anywhere" per its own doc comment in
 * node_modules/recharts/types/component/Customized.d.ts) — this component
 * is instead rendered directly as a child of <LineChart>, and reads the
 * chart's real pixel geometry via the useYAxisScale/usePlotArea hooks
 * (recharts 3.8+) instead of estimating it.
 */
function CumulativeEndLabels({
  trackedNames,
  data,
  colorOf,
}: {
  trackedNames: string[];
  data: Record<string, string | number>[];
  colorOf: (name: string) => string;
}) {
  const yScale = useYAxisScale();
  const plotArea = usePlotArea();

  if (!yScale || !plotArea || data.length === 0) return null;

  const lastRow = data[data.length - 1];
  type Entry = { name: string; color: string; trueY: number; y: number };
  const entries: Entry[] = [];
  for (const name of trackedNames) {
    const value = lastRow[name];
    if (typeof value !== "number") continue;
    const py = yScale(value);
    if (py === undefined) continue;
    entries.push({ name, color: colorOf(name), trueY: py, y: py });
  }
  if (entries.length === 0) return null;

  // 겹침 방지: y 오름차순 정렬 후 최소 간격을 확보하도록 아래로 밀고,
  // 그 결과 마지막 라벨이 플롯 하단을 넘치면 다시 위로 되밀어 배분한다.
  entries.sort((a, b) => a.y - b.y);
  for (let i = 1; i < entries.length; i++) {
    entries[i].y = Math.max(entries[i].y, entries[i - 1].y + LABEL_MIN_GAP);
  }
  const bottomLimit = plotArea.y + plotArea.height - 2;
  if (entries[entries.length - 1].y > bottomLimit) {
    entries[entries.length - 1].y = bottomLimit;
    for (let i = entries.length - 2; i >= 0; i--) {
      entries[i].y = Math.min(entries[i].y, entries[i + 1].y - LABEL_MIN_GAP);
    }
  }
  const topLimit = plotArea.y + 6;
  for (const e of entries) {
    e.y = Math.min(bottomLimit, Math.max(topLimit, e.y));
  }

  const lineEndX = plotArea.x + plotArea.width;
  const labelX = lineEndX + 6;

  return (
    <g>
      {entries.map((e) => {
        // 실제 선 끝(trueY)에서 라벨이 밀려났으면(겹침 회피로 y가 옮겨진
        // 경우) 같은 색의 짧은 연결선으로 어느 선인지 이어준다.
        const displaced = Math.abs(e.y - e.trueY) > 2;
        return (
          <g key={e.name}>
            {displaced && (
              <line
                x1={lineEndX}
                y1={e.trueY}
                x2={labelX - 2}
                y2={e.y}
                stroke={e.color}
                strokeOpacity={0.4}
                strokeWidth={1}
              />
            )}
            <text x={labelX} y={e.y} fontSize={10} fill={e.color} dominantBaseline="middle">
              {truncateName(e.name)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export default function StatsClient({
  participants,
  games,
}: {
  participants: ParticipantLite[];
  games: GameResult[];
}) {
  // v2.19 (배치 B, PRD §24.12) 때는 종목 필터 6개를 페이지 레벨 1개로
  // 합쳤었지만, 섹션마다 보고 싶은 종목이 다를 수 있다는 피드백에 따라
  // 다시 섹션별 독립 필터로 되돌렸다(기간만 페이지 레벨 공유 유지) — 각
  // 섹션이 자기만의 URL 파라미터(rtype/mtype/ntype/wtype/ctype/ttype)를
  // 갖는다.
  const { searchParams, set } = useQueryParams();
  const range = (searchParams.get("range") as RangePreset | null) ?? DEFAULT_RANGE;
  const customStart = searchParams.get("from") ?? "";
  const customEnd = searchParams.get("to") ?? "";
  const rankGameType = (searchParams.get("rtype") as GameTypeFilter | null) ?? "all";
  const matrixGameType = (searchParams.get("mtype") as GameTypeFilter | null) ?? "all";
  const nemesisGameType = (searchParams.get("ntype") as GameTypeFilter | null) ?? "all";
  const winLossGameType = (searchParams.get("wtype") as GameTypeFilter | null) ?? "all";
  const cumulativeGameType = (searchParams.get("ctype") as GameTypeFilter | null) ?? "all";
  const trendGameType = (searchParams.get("ttype") as GameTypeFilter | null) ?? "all";
  const cumulativeGrouping =
    (searchParams.get("cbucket") as CumulativeGrouping | null) ?? DEFAULT_CUMULATIVE_GROUPING;
  const trendGrouping =
    (searchParams.get("gbucket") as PeriodGrouping | null) ?? DEFAULT_TREND_GROUPING;
  const h2hParticipantId = searchParams.get("h2h");

  const setRange = (v: RangePreset) => set({ range: v === DEFAULT_RANGE ? null : v });
  const setCustomStart = (v: string) => set({ from: v || null });
  const setCustomEnd = (v: string) => set({ to: v || null });
  const setRankGameType = (v: GameTypeFilter) => set({ rtype: v === "all" ? null : v });
  const setMatrixGameType = (v: GameTypeFilter) => set({ mtype: v === "all" ? null : v });
  const setNemesisGameType = (v: GameTypeFilter) => set({ ntype: v === "all" ? null : v });
  const setWinLossGameType = (v: GameTypeFilter) => set({ wtype: v === "all" ? null : v });
  const setCumulativeGameType = (v: GameTypeFilter) => set({ ctype: v === "all" ? null : v });
  const setTrendGameType = (v: GameTypeFilter) => set({ ttype: v === "all" ? null : v });
  // v2.21 — 예전엔 둘 다 같은 DEFAULT_GROUPING과 비교해서, 누적 차트에서
  // "주별"(그쪽 기본값은 이제 "일별")을 고르면 URL이 비워지고 다시
  // "일별"로 읽히는 버그가 있었다. 각자 자기 기본값과 비교하도록 분리.
  const setCumulativeGrouping = (v: CumulativeGrouping) =>
    set({ cbucket: v === DEFAULT_CUMULATIVE_GROUPING ? null : v });
  const setTrendGrouping = (v: PeriodGrouping) =>
    set({ gbucket: v === DEFAULT_TREND_GROUPING ? null : v });
  const setH2h = (id: string | null) => set({ h2h: id });
  // 누적 추이 차트는 (id가 아니라) 참가자 이름을 recharts의 dataKey로 쓰므로
  // — computeCumulativeNetPointsTrend의 id 기반 결과를 이름으로 옮겨 담는
  // 기존 구조를 그대로 둔 채 — 색도 이름으로 조회할 수 있게 한 번 더
  // 매핑한다. 이 화면 안에서 참가자 이름이 겹치지 않는다는 가정은 다른
  // 곳(nameOf 조회 등)에도 이미 있는 기존 전제다.
  const participantColorMap = useMemo(() => buildParticipantColorMap(participants), [participants]);
  const nameToColor = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of participants) {
      map.set(p.name, participantColorMap.get(p.id) ?? PARTICIPANT_COLOR_FALLBACK);
    }
    return map;
  }, [participants, participantColorMap]);
  /** 빈 상태의 "필터 초기화" — 기간은 항상 넓히고, typeKey를 넘기면 그 섹션의 종목 필터도 같이 초기화한다(다른 섹션의 독립 필터는 건드리지 않는다). */
  const resetFilters = (typeKey?: string) =>
    set({ range: null, from: null, to: null, ...(typeKey ? { [typeKey]: null } : {}) });

  // Only consulted when range === "custom"; harmless to always pass.
  const customRange = useMemo(
    () => ({ start: customStart || undefined, end: customEnd || undefined }),
    [customStart, customEnd]
  );

  // 기간은 페이지 레벨로 공유하되, 종목은 섹션마다 독립적으로 적용한다 —
  // "섹션마다 보고 싶은 종목이 다를 수 있다"는 피드백에 따라 되돌린
  // 부분(위 상태 선언부 주석 참고).
  const periodGames = useMemo(
    () => filterByDatePreset(activeGames(games), range, customRange),
    [games, range, customRange]
  );

  // ---------- 1. 순위표 (+ 클릭 시 나오는 상대 전적) ----------
  const rankGames = useMemo(
    () => filterGamesByType(periodGames, rankGameType),
    [periodGames, rankGameType]
  );
  const stats = useMemo(
    () => computeParticipantStats(participants, rankGames),
    [participants, rankGames]
  );
  const activeStats = stats.filter((s) => s.appearances > 0);

  // ---------- 3. 상대 전적 매트릭스 ----------
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
      // "__date"는 실제 참가자 이름과 충돌할 일이 없는 예약 키 — "게임별"
      // 그루핑에서 라벨이 그냥 일련번호("1", "2", …)라 툴팁에 실제 날짜를
      // 보여주려면 행마다 원본 날짜를 함께 담아둬야 한다.
      const out: Record<string, string | number> = { label: row.label };
      if (row.date) out.__date = row.date;
      for (const [id, val] of Object.entries(row.values)) {
        // v2.22 (PRD §30.2) — computeCumulativeNetPointsTrend가 이제
        // attendeeIds도 보므로, 참가자 명단에서 하드 삭제된 id가 옛 게임의
        // attendeeIds에 남아 있으면 여기 나타날 수 있다. 색도 없고
        // (팔레트 조회 실패) 이름도 없어 의미가 없으므로 건너뛴다 — 이
        // 함수는 명단을 모르므로 화면 쪽에서 거른다.
        const name = nameOf.get(id);
        if (!name) continue;
        out[name] = val;
      }
      return out;
    });
  }, [cumulativeRows, participants]);
  const trackedNames = useMemo(() => {
    const names = new Set<string>();
    for (const row of cumulativeData) {
      for (const key of Object.keys(row)) {
        if (key !== "label" && key !== "__date") names.add(key);
      }
    }
    return Array.from(names);
  }, [cumulativeData]);

  // ---------- 7. 기간별 게임 수 추이 ----------
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
      <Card padding="sm">
        <div>
          {/* 종목 필터는 더 이상 여기 없다 — 섹션마다 보고 싶은 종목이 다를
              수 있어 각 섹션 카드 안에 독립적으로 둔다(아래 각 SectionTitle
              바로 밑 GameTypeFilterButtons). 기간만 페이지 전체가 공유. */}
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
      </Card>

      <Card>
        <SectionTitle>순위표 ({rankGames.length}게임 기준)</SectionTitle>
        <div className="mt-3">
          <GameTypeFilterButtons value={rankGameType} onChange={setRankGameType} />
        </div>
        <div className="h-3" />
        {activeStats.length === 0 ? (
          <EmptyState
            title="해당 조건에 게임 기록이 없습니다."
            action={
              <Button variant="neutral" size="sm" onClick={() => resetFilters("rtype")}>
                필터 초기화
              </Button>
            }
          />
        ) : (
          <>
            {/* v2.19 (배치 C, PRD §24.13) — 9열 테이블은 390px에서 w-full이
                오버플로와 싸우며 헤더가 여러 줄로 찌그러진다. /records가
                이미 쓰는 카드 패턴과 일관되게, 좁은 화면은 카드 리스트로
                전환하고 md 이상에서만 원래 테이블을 보여준다. */}
            <div className="md:hidden space-y-2">
              {activeStats
                .slice()
                .sort((a, b) => b.netPoints - a.netPoints)
                .map((s) => (
                  <div
                    key={s.id}
                    className={`rounded-lg border border-line p-3 text-sm ${
                      h2hParticipantId === s.id ? "bg-surface-raised" : "bg-surface"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-content">{s.name}</span>
                      <span
                        className={`font-semibold tabular-nums ${
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
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-content-muted mt-2 tabular-nums">
                      <span>참여 {s.appearances}</span>
                      <span>
                        <span className="text-emerald-400">{s.wins}승</span>{" "}
                        {s.appearances - s.wins - s.losses}무{" "}
                        <span className="text-lose">{s.losses}패</span>
                      </span>
                      <span>승률A {(s.winRate * 100).toFixed(0)}%</span>
                      <span>승률B {(s.winRateB * 100).toFixed(0)}%</span>
                      <span>관여율 {(s.involvementRate * 100).toFixed(0)}%</span>
                    </div>
                    <FilterChip
                      selected={h2hParticipantId === s.id}
                      onClick={() => setH2h(h2hParticipantId === s.id ? null : s.id)}
                      className="w-full justify-center mt-2"
                    >
                      상대 전적
                    </FilterChip>
                    {h2hParticipantId === s.id && (
                      <HeadToHeadInline
                        participants={participants}
                        games={rankGames}
                        participantId={s.id}
                      />
                    )}
                  </div>
                ))}
            </div>

            <div className="hidden md:block overflow-x-auto">
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
                    <th className="py-2 pr-4">관여율</th>
                    <th className="py-2 pr-4">순증감</th>
                    <th className="py-2 pr-4" />
                  </tr>
                </thead>
                <tbody>
                  {activeStats
                    .slice()
                    .sort((a, b) => b.netPoints - a.netPoints)
                    .map((s) => (
                      <Fragment key={s.id}>
                        <tr
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
                          <td className="py-2 pr-4 text-content-muted">
                            {(s.involvementRate * 100).toFixed(0)}%
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
                        {h2hParticipantId === s.id && (
                          <tr className="bg-surface-raised">
                            <td colSpan={10} className="px-4 pb-3">
                              <HeadToHeadInline
                                participants={participants}
                                games={rankGames}
                                participantId={s.id}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-content-muted mt-3">
              승률A = 승 ÷ (승 + 패) · 승률B = 승 ÷ (승 + 무 + 패) · 관여율 = (승 + 패) ÷ (승 + 무 + 패)
              <br />
              <span className="opacity-70">승률B = 승률A × 관여율</span>
            </p>
          </>
        )}
      </Card>

      <Card>
        <SectionTitle description="행 참가자가 열 참가자를 상대로 얻은 순증감입니다. 아래 범례의 5단계로 표시됩니다.">
          상대 전적 매트릭스
        </SectionTitle>
        <div className="mt-3">
          <GameTypeFilterButtons value={matrixGameType} onChange={setMatrixGameType} />
        </div>
        {matrixParticipants.length < 2 ? (
          <div className="mt-4">
            <EmptyState
              title="비교할 참가자가 2명 이상일 때 표시됩니다."
              action={
                <Button variant="neutral" size="sm" onClick={() => resetFilters("mtype")}>
                  필터 초기화
                </Button>
              }
            />
          </div>
        ) : (
          <>
            {/* v2.19 (배치 C, PRD §24.13) — 이산 5단계 범례. 색만으로는
                단계 이름까지 전달할 수 없어 칩 행으로 명시한다. */}
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-4 mb-1 text-xs">
              {HEAT_TIER_ORDER.map((tier) => (
                <span key={tier} className="inline-flex items-center gap-1.5">
                  <span
                    className="w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: HEAT_TIER_COLORS[tier] }}
                    aria-hidden
                  />
                  <span className="text-content-muted">{HEAT_TIER_LABELS[tier]}</span>
                </span>
              ))}
            </div>
            <div className="relative">
              <div className="overflow-x-auto">
                <table className="text-sm border-collapse tabular-nums">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-surface p-2" />
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
                        <th className="sticky left-0 z-10 bg-surface p-2 text-xs font-medium text-content-muted text-right whitespace-nowrap">
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
              {/* 스크롤 가능하다는 시각 신호 — 헤더 내비게이션과 같은 패턴(배치 B). */}
              <div
                aria-hidden
                className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-surface to-transparent"
              />
            </div>
          </>
        )}
      </Card>

      <Card>
        <SectionTitle description="천적 = 마진이 가장 나쁜 상대, 밥 = 마진이 가장 좋은 상대 (마진 = 받은 배출권 − 넘긴 배출권)">
          천적 / 밥
        </SectionTitle>
        <div className="mt-3">
          <GameTypeFilterButtons value={nemesisGameType} onChange={setNemesisGameType} />
        </div>
        {nemesisVictim.filter((nv) => nv.nemesis || nv.victim).length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="아직 상대 전적을 계산할 만한 데이터가 없습니다."
              action={
                <Button variant="neutral" size="sm" onClick={() => resetFilters("ntype")}>
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
                  <th className="py-2 pr-4 whitespace-nowrap">천적</th>
                  <th className="py-2 pr-4 whitespace-nowrap">밥</th>
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
                          ? `${nv.nemesis.opponentName} (${nv.nemesis.margin})`
                          : "-"}
                      </td>
                      <td className="py-2 pr-4 text-emerald-400">
                        {nv.victim
                          ? `${nv.victim.opponentName} (+${nv.victim.margin})`
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
        <div className="mt-3">
          <GameTypeFilterButtons value={winLossGameType} onChange={setWinLossGameType} />
        </div>
        {winLossData.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="데이터가 없습니다."
              action={
                <Button variant="neutral" size="sm" onClick={() => resetFilters("wtype")}>
                  필터 초기화
                </Button>
              }
            />
          </div>
        ) : (
          // v2.22 (PRD §30.1) — -mx-4 sm:-mx-5 전체 블리드로 <Card>의
          // p-4 sm:p-5 패딩 일부를 상쇄한다(공용 패딩 토큰 자체는 그대로).
          <div
            className="mt-4 -mx-4 sm:-mx-5"
            style={{ width: "auto", height: "min(280px, 45vh)" }}
          >
            <ResponsiveContainer>
              <BarChart data={winLossData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="8%" barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: CHART_TICK_FILL }} />
                <YAxis width="auto" allowDecimals={false} tick={{ fontSize: 12, fill: CHART_TICK_FILL }} />
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
          action={
            <GroupingFilterButtons
              value={cumulativeGrouping}
              onChange={setCumulativeGrouping}
              options={CUMULATIVE_GROUPING_OPTIONS}
            />
          }
        >
          참가자별 누적 순증감 추이
        </SectionTitle>
        <div className="mt-3">
          <GameTypeFilterButtons value={cumulativeGameType} onChange={setCumulativeGameType} />
        </div>
        {cumulativeData.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="데이터가 없습니다."
              action={
                <Button variant="neutral" size="sm" onClick={() => resetFilters("ctype")}>
                  필터 초기화
                </Button>
              }
            />
          </div>
        ) : (
          // v2.21 (PRD §28.9.2) — 하단 범례를 없애고 선 오른쪽 끝에 이름을
          // 직접 붙인다(CumulativeEndLabels). margin.right로 라벨 자리를
          // 확보 — 없어진 범례가 돌려준 세로 공간 덕에 390px에서도 순증.
          // v2.22 (PRD §30.1) — margin.right는 이제 실제 표시될 라벨 최대
          // 길이에서 계산한다(고정 76px는 2~3자 한글 이름엔 과했다).
          // -mx-4 sm:-mx-5 전체 블리드로 <Card> 패딩을 전부 상쇄 — 이
          // 차트는 이름 라벨 여백 때문에 셋 중 오버헤드가 가장 커서,
          // -mx-2/-mx-3 부분 블리드로는 390px에서 플롯 비율이 85% 목표에
          // 못 미쳤다(실측 79%). 세 차트 모두 같은 블리드 폭으로 통일.
          <div
            className="mt-4 -mx-4 sm:-mx-5"
            style={{ width: "auto", height: "min(360px, 55vh)" }}
          >
            <ResponsiveContainer>
              <LineChart
                data={cumulativeData}
                margin={{ top: 8, right: cumulativeLabelMargin(trackedNames), bottom: 8, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                <XAxis
                  dataKey="label"
                  scale="point"
                  padding={{ left: 0, right: 0 }}
                  tick={{ fontSize: 10, fill: CHART_TICK_FILL }}
                  interval="preserveStartEnd"
                />
                <YAxis width="auto" allowDecimals={false} tick={{ fontSize: 12, fill: CHART_TICK_FILL }} />
                <Tooltip
                  {...CHART_TOOLTIP_PROPS}
                  labelFormatter={(label, payload) => {
                    const date = payload?.[0]?.payload?.__date;
                    return date ? `${label} (${date})` : label;
                  }}
                />
                {trackedNames.map((name) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    stroke={nameToColor.get(name) ?? PARTICIPANT_COLOR_FALLBACK}
                    dot={false}
                    activeDot={{ r: 6 }}
                    strokeWidth={2}
                  />
                ))}
                <CumulativeEndLabels
                  trackedNames={trackedNames}
                  data={cumulativeData}
                  colorOf={(name) => nameToColor.get(name) ?? PARTICIPANT_COLOR_FALLBACK}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle
          action={
            <GroupingFilterButtons
              value={trendGrouping}
              onChange={setTrendGrouping}
              options={TREND_GROUPING_OPTIONS}
            />
          }
        >
          기간별 게임 수 추이
        </SectionTitle>
        <div className="mt-3">
          <GameTypeFilterButtons value={trendGameType} onChange={setTrendGameType} />
        </div>
        {trendData.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="데이터가 없습니다."
              action={
                <Button variant="neutral" size="sm" onClick={() => resetFilters("ttype")}>
                  필터 초기화
                </Button>
              }
            />
          </div>
        ) : (
          // v2.22 (PRD §30.1) — -mx-4 sm:-mx-5 전체 블리드로 <Card> 패딩
          // 일부를 상쇄.
          <div
            className="mt-4 -mx-4 sm:-mx-5"
            style={{ width: "auto", height: "min(240px, 40vh)" }}
          >
            <ResponsiveContainer>
              <BarChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="8%">
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: CHART_TICK_FILL }} />
                <YAxis width="auto" allowDecimals={false} tick={{ fontSize: 12, fill: CHART_TICK_FILL }} />
                <Tooltip {...CHART_TOOLTIP_PROPS} />
                {/* v2.19 — 예전 #e2e8f0(slate-200)은 본문 텍스트 색과 거의
                    같아 화면에서 가장 밝은 요소가 이 막대였다. 참가자 개인
                    데이터가 아닌 "합계" 지표이므로 참가자 팔레트 대신
                    accent-soft(#818cf8)로 앱의 강조색과 결이 맞게 했다. */}
                <Bar dataKey="게임수" fill="#818cf8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Renders inline inside the participant's own row/card in 순위표 (not a separate section) — so "상대 전적" expands in place instead of jumping the user to a different card. */
function HeadToHeadInline({
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

  if (entries.length === 0) {
    return (
      <div className="mt-3">
        <EmptyState title="해당 조건에 상대 전적이 없습니다." />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto mt-3 border-t border-line pt-3">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="text-left text-content-muted text-xs">
            <th className="py-2 pr-4">상대</th>
            <th className="py-2 pr-4">받은 배출권</th>
            <th className="py-2 pr-4">넘긴 배출권</th>
            <th className="py-2 pr-4">순증감</th>
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
  );
}
