"use client";

import { Fragment, useMemo } from "react";
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
import { ChevronDown } from "lucide-react";
import { GAME_TYPE_LABELS, GAME_TYPES, GameResult, Settlement, LedgerAdjustment } from "@/lib/types";
import { TierBadge } from "@/components/badges";
import { Card } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { FilterChip } from "@/components/ui/FilterChip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { useQueryParams } from "@/components/ui/useQueryParams";
import { currentQuarterKey, formatQuarterKey } from "@/lib/time";
import { buildParticipantColorMap, PARTICIPANT_COLOR_FALLBACK } from "@/lib/participant-colors";
import {
  computeQuarterlyTiers,
  computeStyleMap,
  computeStyleMapDomain,
  computeRecords,
  computeHighestBalanceRecord,
  GameTypeFilter,
  RecordTier,
  RecordTierEntry,
  StyleMapDomain,
  StyleMapPoint,
  Tier,
  TierRow,
  TIER_MIN_WEIGHT,
  TIER_CUTS,
  TIER_ORDER,
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

// v2.24 (PRD §34.4) — TR 구간표를 TIER_CUTS/TIER_ORDER에서 생성한다(하드코딩
// 금지 — 컷을 조정하면 화면이 그대로 따라오도록). TIER_ORDER[i]는
// "tr < TIER_CUTS[i]"에 해당하는 티어이므로, 구간의 하한은 바로 앞 컷
// (TIER_CUTS[i-1]), 상한은 TIER_CUTS[i]-1이다. "배치 중"은 TR 구간이 아니라
// 표본 가중치 게이트라 별도 행으로 앞에 둔다.
const TIER_RANGE_ROWS: { tier: Tier; range: string }[] = [
  { tier: "unranked", range: `표본 부족 (분기 누적 가중치 ${TIER_MIN_WEIGHT.toFixed(1)} 미만, 약 9판)` },
  ...TIER_ORDER.map((tier, i) => {
    const range =
      i === 0
        ? `${TIER_CUTS[0]} 미만`
        : i === TIER_ORDER.length - 1
        ? `${TIER_CUTS[i - 1]} 이상`
        : `${TIER_CUTS[i - 1]} ~ ${TIER_CUTS[i] - 1}`;
    return { tier, range };
  }),
];

// v2.25 (PRD §36.2) — the domain used to be a fixed [0.2,1.8]/[-1.6,1.6] pair
// (§16.8's "no auto-scaling" guard). It's now derived per-render from the
// currently-displayed points via computeStyleMapDomain (src/lib/stats.ts),
// which keeps that guard (robust-SD scaling + a clamp whose upper bound is
// this old fixed half-width, so the frame can never end up wider than
// before) while letting it narrow as samples accumulate — see that
// function's doc comment for the full rationale.
const STYLE_MAP_X_CENTER = 1.0;
const STYLE_MAP_Y_CENTER = 0;

function clamp(v: number, [min, max]: [number, number]): number {
  return Math.min(max, Math.max(min, v));
}

// PRD §36.2.4 — capped at ±2σ, not ±3σ: ±2σ already reads as ~the
// theoretical min/max (~95% under a normal-ish null), so a 3rd σ marker
// would just restate the domain edge without adding information. Shared by
// both the tick labels and the reference lines below so the two always agree
// on how far out they go.
const SIGMA_MARKER_MULTIPLES = [1, 2];

/** Tick positions at the center and every ±kσ (k in SIGMA_MARKER_MULTIPLES) that still falls inside the domain — the axis "explains itself" instead of using arbitrary round numbers. */
function sigmaTicks(center: number, sigma: number, halfWidth: number): number[] {
  const ticks = new Set<number>([center]);
  if (sigma > 0) {
    for (const k of SIGMA_MARKER_MULTIPLES) {
      const lo = center - k * sigma;
      const hi = center + k * sigma;
      if (Math.abs(lo - center) <= halfWidth + 1e-9) ticks.add(lo);
      if (Math.abs(hi - center) <= halfWidth + 1e-9) ticks.add(hi);
    }
  }
  return Array.from(ticks).sort((a, b) => a - b);
}

/** ±1σ/±2σ reference-line positions that fall inside the domain (PRD §36.2.4). */
function sigmaLineValues(center: number, sigma: number, halfWidth: number): number[] {
  if (sigma <= 0) return [];
  const out: number[] = [];
  for (const k of SIGMA_MARKER_MULTIPLES) {
    const lo = center - k * sigma;
    const hi = center + k * sigma;
    if (Math.abs(lo - center) <= halfWidth) out.push(lo);
    if (Math.abs(hi - center) <= halfWidth) out.push(hi);
  }
  return out;
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
  settlements,
  adjustments,
}: {
  participants: ParticipantLite[];
  games: GameResult[];
  settlements: Settlement[];
  adjustments: LedgerAdjustment[];
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

  // v2.25 (§36.2.3) — domain derives from the points currently on screen, so
  // it must be recomputed whenever the game-type tab (hence the points)
  // changes, not just when the underlying games/participants change.
  const rawStyleMapPoints: StyleMapPoint[] = useMemo(
    () => styleMapByGameType.get(styleMapGameType) ?? [],
    [styleMapByGameType, styleMapGameType]
  );
  const styleMapDomain: StyleMapDomain = useMemo(
    () => computeStyleMapDomain(rawStyleMapPoints),
    [rawStyleMapPoints]
  );
  const styleMapPoints: StyleMapPlotPoint[] = rawStyleMapPoints.map((p) => {
    const x = clamp(p.engagement, styleMapDomain.xDomain);
    const y = clamp(p.performance, styleMapDomain.yDomain);
    return { ...p, x, y, clamped: x !== p.engagement || y !== p.performance };
  });

  // v2.19 (배치 C, PRD §24.13) — 참가자별 고정 색. 예전엔 손익 부호로만
  // 초록/빨강 2색을 썼는데, 그건 Y축(손익)과 같은 정보를 색으로 한 번 더
  // 인코딩하는 중복이었다. 참가자 색으로 바꾸면 "누구인지"는 색으로,
  // "손익"은 위치로 읽혀 정보량이 늘어난다.
  const participantColorMap = useMemo(() => buildParticipantColorMap(participants), [participants]);

  // 명예의 전당은 항상 통산(전체 기간·전체 종목) 기준 — 필터를 타지 않는다.
  const records = useMemo(() => computeRecords(participants, games), [participants, games]);
  // 역대 최고 채권 보유 — computeRecords와 달리 정산·과거 조정까지 반영해야
  // 하므로 별도 계산. "지금" 잔액이 아니라 "한 번이라도" 도달했던 최고
  // 잔액이라 settlements/adjustments를 시간순으로 재생해야 한다.
  const highestBalance = useMemo(
    () => computeHighestBalanceRecord(participants, games, settlements, adjustments),
    [participants, games, settlements, adjustments]
  );

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
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
            {visibleTierRows.map((row) => (
              <TierCard key={row.id} row={row} />
            ))}
          </div>
        )}

        <p className="text-xs text-content-muted mt-4">
          참석 인원수로 계산한 기대 승·패 대비 성과로 매깁니다 — 4인전 기대
          승률 25%, 5인전 20%. 점수 규모와 표본 크기도 반영되며, 분기마다
          리셋되되 직전 분기 성적이 35% 이어집니다.
        </p>

        <details className="mt-3 group">
          <summary className="min-h-11 flex items-center gap-1.5 cursor-pointer select-none list-none text-xs text-content-sub hover:text-content [&::-webkit-details-marker]:hidden">
            <ChevronDown
              className="w-4 h-4 shrink-0 transition-transform group-open:rotate-180"
              aria-hidden
            />
            <span className="group-open:hidden">티어는 어떻게 매겨지나요?</span>
            <span className="hidden group-open:inline">티어는 어떻게 매겨지나요? (접기)</span>
          </summary>
          <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs items-center">
            {TIER_RANGE_ROWS.map(({ tier, range }) => (
              <Fragment key={tier}>
                <TierBadge tier={tier} size="sm" />
                <span className="text-content-muted">{range}</span>
              </Fragment>
            ))}
          </div>
          <ul className="mt-3 ml-5 space-y-1.5 text-xs text-content-muted list-disc">
            <li><strong className="text-content-sub">TR 1000 = 기대치대로 한 상태.</strong> 참석 인원수로 계산한 기대 성과와 정확히 일치하면 1000입니다.</li>
            <li><strong className="text-content-sub">TR ±100 ≈ 기대 대비 성과가 약 20%p 차이.</strong> 티어 컷 간격이 약 90점이므로 TR 100은 대략 티어 한 계단입니다.</li>
            <li><strong className="text-content-sub">승 지수</strong> = 이긴 판에서 얻은 점수 ÷ 기대 점수. 1.00이면 기대만큼, 1.30이면 기대보다 30% 더 이겼다는 뜻입니다.</li>
            <li><strong className="text-content-sub">패 지수</strong> = 진 판에서 잃은 점수 ÷ 기대 점수. 1.00이면 기대만큼이고 낮을수록 좋습니다.</li>
            <li><strong className="text-content-sub">기대 점수</strong>는 참석 인원수로 정해집니다 — 4인전이면 이길 기대도 질 기대도 25%, 5인전이면 20%입니다.</li>
            <li>표본이 적으면 신뢰도가 낮아 TR이 1000 쪽으로 당겨집니다.</li>
          </ul>
        </details>
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
          <StyleMapChart points={styleMapPoints} colorMap={participantColorMap} domain={styleMapDomain} />
        )}

        <p className="text-xs text-content-muted mt-4">
          가로 = 적극성(1.00 = 기대치. 오른쪽일수록 Win 아니면 Lose로 끝나는
          판이 많고, 왼쪽일수록 무로 지나가는 판이 많습니다) / 세로 = 환경
          영향(0 = 기준선. 위쪽일수록 배출권을 확보하고, 아래쪽일수록 계속
          넘깁니다). 판수가 적을수록 점이 크게 튈 수 있어 작고 흐리게
          표시됩니다.
          <br />
          점선은 실력·성향 차이가 전혀 없어도 순전히 운으로 생길 수 있는
          흔들림의 크기입니다(±1σ, ±2σ). 그 안쪽이면 성향 차이라고 보기
          어렵습니다.
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
            label="하루 최고 득실차"
            tiers={records.bestDailyMargin}
            unit="점"
            signed
          />
          <RecordCategory
            label="하루 최저 득실차"
            tiers={records.worstDailyMargin}
            unit="점"
            signed
          />
          <RecordCategory
            label="하루 최다 게임수 (팀 기록)"
            tiers={records.mostGamesInOneDay}
            unit="게임"
          />
          <RecordCategory
            label="최다 참석 (개근왕)"
            tiers={records.mostAppearances}
            unit="회"
          />
          <RecordCategory
            label="역대 최대 잉여 보유"
            tiers={highestBalance}
            unit="점"
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
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-sm text-content">{row.name}</span>
        <DeltaArrow delta={delta} />
      </div>

      {row.tier === "unranked" ? (
        <div>
          {/* row.weight는 인원수로 보정한 기대값 가중치라 "0.2판"처럼 실제
              참여 판수와 다른 소수 단위로 나온다 — 직관적이지 않으므로
              배치 완료까지의 진행률(%)로 표시한다. 실제 참여 판수는 바로
              아래 통계 줄의 "N판 참여"에 이미 나온다. */}
          <p className="text-xs text-content-muted mb-1 tabular-nums">
            배치 중 (진행률 {(placementProgress * 100).toFixed(0)}%)
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
      </div>
    </Card>
  );
}

// PRD §16.8 — point radius/opacity scale with recent games so a 1-game point
// reads as "small, unreliable" without needing a sample-size gate to hide it.
// v2.19 (배치 C, PRD §24.13): the floors were 4px/35% opacity — a low-sample
// point was both tiny and faint, close to untappable on a phone. Raised to
// 7px/60% so even the least-sampled participant stays visible and tappable;
// the *relative* size/opacity gradient (more games = bigger/more solid) is
// unchanged, just the floor moved up.
const STYLE_MAP_MIN_RADIUS = 7;
const STYLE_MAP_MAX_RADIUS = 14;
const STYLE_MAP_MIN_OPACITY = 0.6;
const STYLE_MAP_MAX_OPACITY = 0.95;

function styleMapRadius(games: number, maxGames: number): number {
  if (maxGames <= 1) return STYLE_MAP_MAX_RADIUS;
  const t = Math.min(1, (games - 1) / (maxGames - 1));
  return STYLE_MAP_MIN_RADIUS + t * (STYLE_MAP_MAX_RADIUS - STYLE_MAP_MIN_RADIUS);
}

function styleMapOpacity(games: number, maxGames: number): number {
  if (maxGames <= 1) return STYLE_MAP_MAX_OPACITY;
  const t = Math.min(1, (games - 1) / (maxGames - 1));
  return STYLE_MAP_MIN_OPACITY + t * (STYLE_MAP_MAX_OPACITY - STYLE_MAP_MIN_OPACITY);
}

/** Custom <Scatter> dot: color is the participant's fixed identity color (not win/lose — that's already the Y position, see the colorMap comment above), size/opacity encode `games`, a dashed ring marks a point clamped to the fixed domain edge (its true value lies outside what's shown). */
function StyleMapDot(props: {
  cx?: number;
  cy?: number;
  payload?: StyleMapPlotPoint;
  maxGames: number;
  colorMap: Map<string, string>;
}) {
  const { cx, cy, payload, maxGames, colorMap } = props;
  if (cx === undefined || cy === undefined || !payload) return null;
  const r = styleMapRadius(payload.games, maxGames);
  const opacity = styleMapOpacity(payload.games, maxGames);
  const fill = colorMap.get(payload.id) ?? PARTICIPANT_COLOR_FALLBACK;
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
      <p className="text-content-muted">환경 영향 {p.performance >= 0 ? "+" : ""}{p.performance.toFixed(2)}</p>
      <p className="text-content-muted">승 지수 {p.winIndex.toFixed(2)} · 패 지수 {p.lossIndex.toFixed(2)}</p>
      <p className="text-content-muted">최근 90일 {p.games}판</p>
      {p.clamped && <p className="text-amber-400">* 실제 값은 표시 범위를 벗어남</p>}
    </div>
  );
}

/**
 * PRD §16.8/§36.2 domain-bounded scatter — X=적극성(ENG), Y=환경 영향(PERF).
 * v2.25부터 도메인은 min/max가 아니라 표시 중인 점들의 robust SD ×
 * 이론 σ_null로 산출되며(computeStyleMapDomain, src/lib/stats.ts), 클램프
 * 상한이 예전 고정 도메인과 같아 예전보다 넓어지는 일은 없다 — "한 명의
 * 극단값에 축 전체가 끌려가지 않는다"는 §16.8의 원래 취지는 그대로다.
 *
 * v2.19 (배치 C, PRD §24.13) 조정:
 *  - 이름 라벨(LabelList)은 점 위에 항상 표시한다. 도메인이 고정이라 값이
 *    대부분 (1.0, 0) 근처에 몰려 라벨 몇 개는 겹칠 수 있지만, 이름을 보려면
 *    매번 탭해야 하는 것보다는 낫다는 피드백에 따라 되돌렸다 — 정확한
 *    수치는 여전히 Tooltip으로 탭해서 본다.
 *  - 사분면 배경 fillOpacity 0.06→0.13(사실상 안 보이던 수준을 올림), 라벨
 *    색을 승/패 색(빨강 쪽 3.7:1로 AA 미달) 대신 content-sub 계열
 *    #cbd5e1(다크 배경 대비 ~11:1)로 통일.
 *  - Y축 left 마진 10→32(‑1.6 틱 라벨 + 회전된 축 제목이 겹치던 문제),
 *    bottom 마진 20→32(X축 제목이 SVG 가장자리에 붙던 문제).
 *  - 높이 420px 고정(폰 화면 절반) → `min(420px, 55vh)`.
 */
function StyleMapChart({
  points,
  colorMap,
  domain,
}: {
  points: StyleMapPlotPoint[];
  colorMap: Map<string, string>;
  domain: StyleMapDomain;
}) {
  const maxGames = points.reduce((max, p) => Math.max(max, p.games), 1);
  const { xDomain, yDomain, xHalfWidth, yHalfWidth, xSigma, ySigma } = domain;
  const xTicks = sigmaTicks(STYLE_MAP_X_CENTER, xSigma, xHalfWidth);
  const yTicks = sigmaTicks(STYLE_MAP_Y_CENTER, ySigma, yHalfWidth);
  const xSigmaLines = sigmaLineValues(STYLE_MAP_X_CENTER, xSigma, xHalfWidth);
  const ySigmaLines = sigmaLineValues(STYLE_MAP_Y_CENTER, ySigma, yHalfWidth);

  return (
    <div style={{ width: "100%", height: "min(420px, 55vh)" }}>
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 20, right: 30, bottom: 32, left: 32 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            type="number"
            dataKey="x"
            domain={xDomain}
            ticks={xTicks}
            tickFormatter={(v: number) => v.toFixed(2)}
            allowDataOverflow
            tick={{ fontSize: 12, fill: "#94a3b8" }}
            label={{ value: "적극성 (ENG, 1.00=기준)", position: "insideBottom", offset: -12, fontSize: 12, fill: "#94a3b8" }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={yDomain}
            ticks={yTicks}
            tickFormatter={(v: number) => v.toFixed(2)}
            allowDataOverflow
            tick={{ fontSize: 12, fill: "#94a3b8" }}
            label={{ value: "환경 영향 (PERF, 0=기준선)", angle: -90, position: "insideLeft", fontSize: 12, fill: "#94a3b8" }}
          />
          {/* v2.25 (§36.2.4) — 순전히 운으로 생기는 흔들림 크기(±1σ, ±2σ)를
              데이터·사분면 배경보다 먼저 그려 뒤로 보낸다. */}
          {xSigmaLines.map((v) => (
            <ReferenceLine key={`xs-${v}`} x={v} stroke="#64748b" strokeDasharray="2 3" strokeOpacity={0.5} ifOverflow="hidden" />
          ))}
          {ySigmaLines.map((v) => (
            <ReferenceLine key={`ys-${v}`} y={v} stroke="#64748b" strokeDasharray="2 3" strokeOpacity={0.5} ifOverflow="hidden" />
          ))}
          <ReferenceArea x1={1.0} x2={xDomain[1]} y1={0} y2={yDomain[1]} fill="#059669" fillOpacity={0.13} label={{ value: "탄소 파수꾼", position: "insideTopRight", fontSize: 11, fill: "#cbd5e1" }} />
          <ReferenceArea x1={1.0} x2={xDomain[1]} y1={yDomain[0]} y2={0} fill="#dc2626" fillOpacity={0.13} label={{ value: "탄소 폭주족", position: "insideBottomRight", fontSize: 11, fill: "#cbd5e1" }} />
          <ReferenceArea x1={xDomain[0]} x2={1.0} y1={0} y2={yDomain[1]} fill="#059669" fillOpacity={0.13} label={{ value: "저탄소 생활자", position: "insideTopLeft", fontSize: 11, fill: "#cbd5e1" }} />
          <ReferenceArea x1={xDomain[0]} x2={1.0} y1={yDomain[0]} y2={0} fill="#dc2626" fillOpacity={0.13} label={{ value: "은근한 굴뚝", position: "insideBottomLeft", fontSize: 11, fill: "#cbd5e1" }} />
          <ReferenceLine x={1.0} stroke="#cbd5e1" />
          <ReferenceLine y={0} stroke="#cbd5e1" />
          <Tooltip content={<StyleMapTooltip />} />
          <Scatter
            data={points}
            shape={(props: unknown) => (
              <StyleMapDot
                {...(props as { cx?: number; cy?: number; payload?: StyleMapPlotPoint })}
                maxGames={maxGames}
                colorMap={colorMap}
              />
            )}
          >
            <LabelList dataKey="name" position="top" style={{ fontSize: 11, fill: "#e2e8f0" }} />
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
        <ul className="space-y-1.5 tabular-nums">
          {tiers.map((tier) => (
            <li key={tier.rank} className="text-sm">
              <span className="text-content-faint mr-1.5 whitespace-nowrap">
                {tier.entries.length > 1 ? `공동 ${tier.rank}위` : `${tier.rank}위`}
              </span>
              {tier.entries.length === 1 ? (
                <span className="font-semibold text-content">
                  {formatRecordEntry(tier.entries[0], unit, signed)}
                </span>
              ) : (
                // v2.19 (배치 C, PRD §24.13) — 공동 순위 값을 join(", ")로
                // 한 줄에 이어붙이면 값 문자열이 길 때(예: "이름 · 5연승
                // (2026-01-02 ~ 2026-01-09)") 줄바꿈이 단어 중간에서
                // 일어난다. 각 값을 별도 줄로 나눈다.
                <ul className="mt-0.5 ml-14 space-y-0.5">
                  {tier.entries.map((e, i) => (
                    <li key={i} className="font-semibold text-content">
                      {formatRecordEntry(e, unit, signed)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
