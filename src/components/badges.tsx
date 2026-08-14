import {
  GAME_TYPE_LABELS,
  GameType,
  SettlementType,
  WritableSettlementType,
  normalizeSettlementType,
} from "@/lib/types";
import type { Tier } from "@/lib/stats";

const GAME_TYPE_STYLES: Record<GameType, string> = {
  hoola: "bg-indigo-50 text-indigo-700 border-indigo-200",
  citadels: "bg-purple-50 text-purple-700 border-purple-200",
  "6nimmt": "bg-orange-50 text-orange-700 border-orange-200",
};

export function GameTypeBadge({ gameType }: { gameType?: GameType }) {
  const label = gameType ? GAME_TYPE_LABELS[gameType] : "종목 미지정";
  const style = gameType
    ? GAME_TYPE_STYLES[gameType]
    : "bg-slate-50 text-slate-400 border-slate-200";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${style}`}
    >
      {label}
    </span>
  );
}

const SETTLEMENT_TYPE_STYLES: Record<WritableSettlementType, string> = {
  payment: "bg-emerald-50 text-emerald-700 border-emerald-200",
  donation: "bg-amber-50 text-amber-700 border-amber-200",
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
    <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 text-slate-500 px-2 py-0.5 text-xs font-medium whitespace-nowrap">
      비활성
    </span>
  );
}

export function LedgerAdjustmentBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 text-slate-600 px-2 py-0.5 text-xs font-medium whitespace-nowrap">
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
    return <span className="text-xs text-slate-400">-</span>;
  }
  const style =
    type === "W"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-red-50 text-red-600 border-red-200";
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
  unranked: "bg-slate-50 text-slate-400 border-slate-200",
  bronze: "bg-orange-50 text-orange-800 border-orange-200",
  silver: "bg-slate-100 text-slate-600 border-slate-300",
  gold: "bg-amber-50 text-amber-700 border-amber-300",
  platinum: "bg-teal-50 text-teal-700 border-teal-200",
  diamond: "bg-sky-50 text-sky-700 border-sky-200",
  master: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
  challenger: "bg-purple-50 text-purple-700 border-purple-300",
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
