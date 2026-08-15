"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  ReferenceArea,
  LabelList,
} from "recharts";
import { GAME_TYPE_LABELS, GAME_TYPES, GameResult } from "@/lib/types";
import { TierBadge } from "@/components/badges";
import { Card } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { FilterChip } from "@/components/ui/FilterChip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { useQueryParams } from "@/components/ui/useQueryParams";
import { currentQuarterKey, formatQuarterKey } from "@/lib/time";
import {
  computeQuarterlyTiers,
  computeStyleMap,
  computeRecords,
  GameTypeFilter,
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

// "통합"을 맨 앞에 두는 건 표본이 가장 크고(PRD §16.7) 대표 티어로 쓰기
// 좋기 때문. /stats의 종목 필터 "전체"와 라벨이 다른 건 의도적 — 여긴
// 종목을 "합산"한다는 뜻이라 "통합"이 더 정확하다.
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
const STYLE_MAP_X_DOMAIN: [number, number] = [0.2, 1.8];
const STYLE_MAP_X_TICKS = [0.2, 0.6, 1.0, 1.4, 1.8];
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

export default function RecordsClient({
  participants,
  games,
}: {
  participants: ParticipantLite[];
  games: GameResult[];
}) {
  // v2.19 (배치 B, PRD §24.12) — 필터를 URL로 동기화한다. 티어와 성향 맵의
  // 종목 탭은 의도적으로 독립 유지한다(둘이 서로 다른 종목을 보고 싶을
  // 이유가 있다 — 예: 훌라 티어를 보면서 전체 성향은 그대로 보기) — 그래서
  // PRD가 제안한 단일 `type` 대신 `type`(티어)/`styleType`(성향 맵) 두
  // 파라미터를 쓴다.
  const { searchParams, set } = useQueryParams();
  const tierGameType = (searchParams.get("type") as GameTypeFilter | null) ?? "all";
  const tierQuarterParam = searchParams.get("q");
  const styleMapGameType = (searchParams.get("styleType") as GameTypeFilter | null) ?? "all";

  // 분기 티어는 항상 원본 games 전체를 넘긴다 — 종목 탭 4개를 한 번에
  // 계산해두고 탭 전환은 계산된 맵에서 골라 쓰기만 한다.
  const tiersByGameType = useMemo(() => {
    const map = new Map<GameTypeFilter, Map<string, TierRow[]>>();
    for (const tab of TIER_GAME_TYPE_TABS) {
      map.set(tab.value, computeQuarterlyTiers(participants, games, tab.value));
    }
    return map;
  }, [participants, games]);

  const tierQuartersForType: Map<string, TierRow[]> =
    tiersByGameType.get(tierGameType) ?? new Map();
  const availableTierQuarters = Array.from(tierQuartersForType.keys())
    .sort()
    .reverse(); // most recent first
  const effectiveTierQuarter: string | null =
    (tierQuarterParam && tierQuartersForType.has(tierQuarterParam) ? tierQuarterParam : null) ??
    (tierQuartersForType.has(currentQuarterKey()) ? currentQuarterKey() : null) ??
    availableTierQuarters[0] ??
    null;

  // v2.19 — 종목 탭을 바꿨을 때 저장된 분기가 새 종목엔 없으면 URL에서
  // 지운다. 예전엔 상태(tierQuarter)는 그대로 남아 있는데 <select> 표시값만
  // effectiveTierQuarter의 폴백으로 조용히 바뀌어, 상태와 화면이 서로
  // 다른 분기를 가리키는 채로 어긋났다 — q를 함께 지우면 둘이 항상 같다.
  function setTierGameType(v: GameTypeFilter) {
    const nextQuarters = tiersByGameType.get(v) ?? new Map();
    const patch: Record<string, string | null> = { type: v === "all" ? null : v };
    if (tierQuarterParam && !nextQuarters.has(tierQuarterParam)) {
      patch.q = null;
    }
    set(patch);
  }
  const setTierQuarter = (v: string) => set({ q: v });
  const setStyleMapGameType = (v: GameTypeFilter) =>
    set({ styleType: v === "all" ? null : v });

  const tierRows = effectiveTierQuarter
    ? tierQuartersForType.get(effectiveTierQuarter) ?? []
    : [];
  // Inactive participants are hidden by default, but still shown if they
  // actually played in the selected quarter.
  const activeParticipantById = new Map(participants.map((p) => [p.id, p.active]));
  const visibleTierRows = tierRows.filter(
    (r) => activeParticipantById.get(r.id) !== false || r.games > 0
  );

  // 성향 맵은 항상 최근 90일 롤링 — 분기 선택 자체가 없다. 종목 탭은 티어
  // 섹션과 동일한 4개를 재사용하되 상태는 독립적이다.
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

  // 명예의 전당은 항상 통산(전체 기간·전체 종목) 기준 — 필터를 타지 않는다.
  const records = useMemo(() => computeRecords(participants, games), [participants, games]);

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle
          description="이번 분기 기준 — 승 지수·패 지수는 1.00이 기대치입니다."
          action={
            availableTierQuarters.length > 0 && (
              <select
                value={effectiveTierQuarter ?? ""}
                onChange={(e) => setTierQuarter(e.target.value)}
                className="bg-surface rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-content"
              >
                {availableTierQuarters.map((q) => (
                  <option key={q} value={q}>
                    {formatQuarterKey(q)}
                  </option>
                ))}
              </select>
            )
          }
        >
          분기 티어
        </SectionTitle>

        <div className="flex gap-2 my-4 flex-wrap">
          {TIER_GAME_TYPE_TABS.map((tab) => (
            <FilterChip
              key={tab.value}
              selected={tierGameType === tab.value}
              onClick={() => setTierGameType(tab.value)}
            >
              {tab.label}
            </FilterChip>
          ))}
        </div>

        {!effectiveTierQuarter || visibleTierRows.length === 0 ? (
          <EmptyState
            title="이 종목으로는 아직 분기 티어를 계산할 만한 기록이 없습니다."
            action={
              tierGameType !== "all" && (
                <Button variant="neutral" size="sm" onClick={() => setTierGameType("all")}>
                  통합 종목으로 보기
                </Button>
              )
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleTierRows.map((row) => (
              <TierCard key={row.id} row={row} />
            ))}
          </div>
        )}

        <p className="text-xs text-content-muted mt-4">
          참석 인원수로 계산한 기대 승·패 대비 성과로 매깁니다 — 4인전 기대
          승률 25%, 5인전 20%. 판돈(점수)과 표본 크기도 반영되며, 분기마다
          리셋되되 직전 분기 성적이 35% 이어집니다.
        </p>
      </Card>

      <Card>
        <SectionTitle description="항상 최근 3개월(90일 롤링) 기준입니다. 등급이나 뱃지가 아니라 좌표 위 위치로만 성향을 보여줍니다.">
          성향 맵
        </SectionTitle>

        <div className="flex gap-2 my-4 flex-wrap">
          {TIER_GAME_TYPE_TABS.map((tab) => (
            <FilterChip
              key={tab.value}
              selected={styleMapGameType === tab.value}
              onClick={() => setStyleMapGameType(tab.value)}
            >
              {tab.label}
            </FilterChip>
          ))}
        </div>

        {styleMapPoints.length === 0 ? (
          <EmptyState
            title="이 종목으로는 최근 90일 내 기록이 없습니다."
            action={
              styleMapGameType !== "all" && (
                <Button variant="neutral" size="sm" onClick={() => setStyleMapGameType("all")}>
                  통합 종목으로 보기
                </Button>
              )
            }
          />
        ) : (
          <StyleMapChart points={styleMapPoints} />
        )}

        <p className="text-xs text-content-muted mt-4">
          가로 = 적극성(1.00 = 기대치. 오른쪽일수록 Win 아니면 Lose로 끝나는
          판이 많고, 왼쪽일수록 무로 지나가는 판이 많습니다) / 세로 = 손익(0 =
          본전). 판수가 적을수록 점이 크게 튈 수 있어 작고 흐리게 표시됩니다.
        </p>
      </Card>

      <Card>
        <SectionTitle description="항상 통산(전체 기간·전체 종목) 기준입니다.">
          명예의 전당
        </SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mt-4">
          <RecordCategory label="최장 연승" tiers={records.longestWinStreak} unit="연승" />
          <RecordCategory label="최장 연패" tiers={records.longestLossStreak} unit="연패" />
          <RecordCategory
            label="하루 최다 승리"
            tiers={records.mostWinsInOneDay}
            unit="승"
          />
          <RecordCategory
            label="하루 최다 패배"
            tiers={records.mostLossesInOneDay}
            unit="패"
          />
          <RecordCategory
            label="최다 참석 (개근왕)"
            tiers={records.mostAppearances}
            unit="회"
          />
          <RecordCategory
            label="최고 순득점"
            tiers={records.highestNetPoints}
            unit="점"
            signed
          />
          <RecordCategory
            label="최저 순득점"
            tiers={records.lowestNetPoints}
            unit="점"
            signed
          />
          <RecordCategory
            label="하루 최다 게임수 (팀 기록)"
            tiers={records.mostGamesInOneDay}
            unit="게임"
          />
        </div>
      </Card>
    </div>
  );
}

/** One participant's quarterly tier card — placement-in-progress and ranked participants render differently. */
function TierCard({ row }: { row: TierRow }) {
  const delta = tierDelta(row);
  const placementProgress = Math.min(1, row.weight / TIER_MIN_WEIGHT);

  return (
    <Card padding="sm" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm truncate text-content">{row.name}</span>
        <DeltaArrow delta={delta} />
      </div>

      {row.tier === "unranked" ? (
        <div>
          <p className="text-xs text-content-muted mb-1 tabular-nums">
            배치 중 ({row.weight.toFixed(1)}/{TIER_MIN_WEIGHT.toFixed(1)}판)
          </p>
          <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden">
            <div
              className="h-full bg-win"
              style={{ width: `${placementProgress * 100}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <TierBadge tier={row.tier} />
          <span className="text-sm font-semibold text-content tabular-nums">
            {Math.round(row.tr)} TR
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-content-muted tabular-nums">
        <span>승 지수 {row.winIndex.toFixed(2)}</span>
        <span>패 지수 {row.lossIndex.toFixed(2)}</span>
        <span>{row.games}판 참여</span>
        <span>신뢰도 {(row.confidence * 100).toFixed(0)}%</span>
      </div>
    </Card>
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
      stroke={payload.clamped ? "#f8fafc" : "none"}
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
    <div className="bg-surface border border-line rounded-lg shadow-sm px-3 py-2 text-xs space-y-0.5 tabular-nums">
      <p className="font-semibold text-content">{p.name}</p>
      <p className="text-content-muted">적극성 {p.engagement.toFixed(2)}</p>
      <p className="text-content-muted">손익 {p.performance >= 0 ? "+" : ""}{p.performance.toFixed(2)}</p>
      <p className="text-content-muted">승 지수 {p.winIndex.toFixed(2)} · 패 지수 {p.lossIndex.toFixed(2)}</p>
      <p className="text-content-muted">최근 90일 {p.games}판</p>
      {p.clamped && <p className="text-amber-400">* 실제 값은 표시 범위를 벗어남</p>}
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
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            type="number"
            dataKey="x"
            domain={STYLE_MAP_X_DOMAIN}
            ticks={STYLE_MAP_X_TICKS}
            allowDataOverflow
            tick={{ fontSize: 12, fill: "#94a3b8" }}
            label={{ value: "적극성 (ENG)", position: "insideBottom", offset: -10, fontSize: 12, fill: "#94a3b8" }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={STYLE_MAP_Y_DOMAIN}
            ticks={STYLE_MAP_Y_TICKS}
            allowDataOverflow
            tick={{ fontSize: 12, fill: "#94a3b8" }}
            label={{ value: "손익 (PERF)", angle: -90, position: "insideLeft", fontSize: 12, fill: "#94a3b8" }}
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
            <LabelList dataKey="name" position="top" style={{ fontSize: 10, fill: "#cbd5e1" }} />
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
      <span className="text-xs font-semibold text-emerald-400 whitespace-nowrap">
        ▲ 상승
      </span>
    );
  }
  if (delta === "down") {
    return (
      <span className="text-xs font-semibold text-lose whitespace-nowrap">
        ▼ 하락
      </span>
    );
  }
  return (
    <span className="text-xs font-medium text-content-muted whitespace-nowrap">
      − 유지
    </span>
  );
}

function formatRecordEntry(e: RecordTierEntry, unit: string, signed: boolean): string {
  const range =
    e.startDate && e.endDate
      ? e.startDate === e.endDate
        ? ` (${e.startDate})`
        : ` (${e.startDate} ~ ${e.endDate})`
      : "";
  const sign = signed && e.value > 0 ? "+" : "";
  // v2.19 — a blank name marks a team-level (not per-participant) entry like
  // 하루 최다 게임수: omit the "이름 · " prefix entirely rather than render a
  // leading separator with nothing before it.
  const namePart = e.name ? `${e.name} · ` : "";
  return `${namePart}${sign}${e.value}${unit}${range}`;
}

/** Renders the top-3-by-rank tiers (from computeRecords' topTiers — 1224 competition ranking, capped by rank number rather than band count, so a big tie can leave fewer than 3 bands or even just one), each tier possibly holding several tied entries shown as "공동 N위". `signed` prefixes positive values with "+" (for netPoints categories, where the sign matters). */
function RecordCategory({
  label,
  tiers,
  unit,
  signed = false,
}: {
  label: string;
  tiers: RecordTier[];
  unit: string;
  signed?: boolean;
}) {
  return (
    <Card padding="sm">
      <p className="text-xs text-content-muted mb-1.5">{label}</p>
      {tiers.length === 0 ? (
        <EmptyState title="아직 없음" />
      ) : (
        <ul className="space-y-1 tabular-nums">
          {tiers.map((tier) => (
            <li key={tier.rank} className="text-sm">
              <span className="text-content-faint mr-1.5 whitespace-nowrap">
                {tier.entries.length > 1 ? `공동 ${tier.rank}위` : `${tier.rank}위`}
              </span>
              <span className="font-semibold text-content">
                {tier.entries.map((e) => formatRecordEntry(e, unit, signed)).join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
