import {
  GAME_TYPE_LABELS,
  GameType,
  SettlementType,
  WritableSettlementType,
  normalizeSettlementType,
} from "@/lib/types";
import type { Tier } from "@/lib/stats";

const GAME_TYPE_STYLES: Record<GameType, string> = {
  hoola: "bg-indigo-500/10 text-indigo-300 border-indigo-800",
  citadels: "bg-purple-500/10 text-purple-300 border-purple-800",
  "6nimmt": "bg-orange-500/10 text-orange-300 border-orange-800",
};

export function GameTypeBadge({ gameType }: { gameType?: GameType }) {
  const label = gameType ? GAME_TYPE_LABELS[gameType] : "종목 미지정";
  const style = gameType
    ? GAME_TYPE_STYLES[gameType]
    : "bg-slate-800 text-slate-500 border-slate-800";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${style}`}
    >
      {label}
    </span>
  );
}

const SETTLEMENT_TYPE_STYLES: Record<WritableSettlementType, string> = {
  payment: "bg-emerald-500/10 text-emerald-300 border-emerald-800",
  donation: "bg-amber-500/10 text-amber-300 border-amber-800",
};

const SETTLEMENT_TYPE_LABELS: Record<WritableSettlementType, string> = {
  payment: "실제 정산",
  donation: "기부",
};

// Accepts the legacy "waiver" value too (normalized to "donation" before
// lookup) so old settlement records still render with a correct label.
export function SettlementTypeBadge({ type }: { type?: SettlementType }) {
  const resolved = normalizeSettlementType(type);
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${SETTLEMENT_TYPE_STYLES[resolved]}`}
    >
      {SETTLEMENT_TYPE_LABELS[resolved]}
    </span>
  );
}

/** Marks a soft-deleted (active: false) record in admin-only views — e.g. the games list, where admins (unlike everyone else) can see inactive rows. */
export function InactiveBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-800 text-slate-400 px-2 py-0.5 text-xs font-medium whitespace-nowrap">
      비활성
    </span>
  );
}

/**
 * v2.18 (PRD §22.5) — marks a game row whose displayed calendar timestamp
 * falls on a different date than the business day it's grouped/filtered
 * under (i.e. it was logged past real midnight). Without this, a game
 * showing "2026-08-15 01:00" while sitting in an "8/14" filtered list reads
 * as a bug rather than the intended business-day grouping.
 */
export function GameNightBadge({ businessDate }: { businessDate: string }) {
  const label = `${Number(businessDate.slice(5, 7))}/${Number(businessDate.slice(8, 10))} 게임밤`;
  return (
    <span
      className="inline-flex items-center rounded-full border border-indigo-800 bg-indigo-500/10 text-indigo-300 px-2 py-0.5 text-xs font-medium whitespace-nowrap"
      title={`영업일 기준 ${businessDate}의 게임 밤으로 묶임`}
    >
      {label}
    </span>
  );
}

export function LedgerAdjustmentBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-800 text-slate-300 px-2 py-0.5 text-xs font-medium whitespace-nowrap">
      과거 기록
    </span>
  );
}

/** One W/L result chip, used to render a "recent form" sequence. */
export function ResultBadge({ result }: { result: "W" | "L" }) {
  const style =
    result === "W"
      ? "bg-emerald-500 text-white"
      : "bg-red-400 text-white";
  return (
    <span
      className={`inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${style}`}
    >
      {result}
    </span>
  );
}

export function StreakBadge({
  type,
  length,
}: {
  type: "W" | "L" | null;
  length: number;
}) {
  if (!type || length === 0) {
    return <span className="text-xs text-slate-500">-</span>;
  }
  const style =
    type === "W"
      ? "bg-emerald-500/10 text-emerald-300 border-emerald-800"
      : "bg-red-500/10 text-red-400 border-red-800";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${style}`}
    >
      {length}연{type === "W" ? "승" : "패"}
    </span>
  );
}

// Cutoffs live in computeQuarterlyTiers() (src/lib/stats.ts, PRD §16); this
// only maps the resulting tier to a label/color. Order matches rank
// progression low->high. "master" sits between diamond (sky) and challenger
// (purple) — fuchsia reads as a step up from sky without competing with
// challenger's purple.
const TIER_STYLES: Record<Tier, string> = {
  unranked: "bg-slate-800 text-slate-500 border-slate-800",
  bronze: "bg-orange-500/10 text-orange-300 border-orange-800",
  silver: "bg-slate-800 text-slate-300 border-slate-700",
  gold: "bg-amber-500/10 text-amber-300 border-amber-700",
  platinum: "bg-teal-500/10 text-teal-300 border-teal-800",
  diamond: "bg-sky-500/10 text-sky-300 border-sky-800",
  master: "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-800",
  challenger: "bg-purple-500/10 text-purple-300 border-purple-700",
};

const TIER_LABELS: Record<Tier, string> = {
  unranked: "배치 중",
  bronze: "브론즈",
  silver: "실버",
  gold: "골드",
  platinum: "플래티넘",
  diamond: "다이아몬드",
  master: "마스터",
  challenger: "챌린저",
};

const TIER_BADGE_SIZES = {
  sm: "px-1.5 py-0.5 text-[10px]",
  md: "px-2 py-0.5 text-xs",
} as const;

export function TierBadge({
  tier,
  size = "md",
}: {
  tier: Tier;
  size?: keyof typeof TIER_BADGE_SIZES;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border font-semibold whitespace-nowrap ${TIER_BADGE_SIZES[size]} ${TIER_STYLES[tier]}`}
    >
      {TIER_LABELS[tier]}
    </span>
  );
}
