import {
  GAME_TYPE_LABELS,
  GameType,
  SettlementType,
  WritableSettlementType,
  normalizeSettlementType,
} from "@/lib/types";

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

export function LedgerAdjustmentBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 text-slate-600 px-2 py-0.5 text-xs font-medium whitespace-nowrap">
      과거 기록
    </span>
  );
}
