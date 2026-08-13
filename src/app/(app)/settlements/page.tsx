import Link from "next/link";
import { format } from "date-fns";
import { getFullDB } from "@/lib/storage";
import { computeNetBalances, simplifyDebts } from "@/lib/settle";
import { deleteSettlement } from "@/lib/actions";
import { SettlementTypeBadge, LedgerAdjustmentBadge } from "@/components/badges";
import { normalizeSettlementType } from "@/lib/types";
import { filterByDatePreset, RangePreset } from "@/lib/stats";
import SettlementsClient from "./SettlementsClient";

export const dynamic = "force-dynamic";

type HistoryFilter = "all" | "payment" | "donation" | "adjustment";

const FILTER_OPTIONS: { value: HistoryFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "payment", label: "실제 정산" },
  { value: "donation", label: "기부" },
  { value: "adjustment", label: "과거 기록" },
];

const DONATION_RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "30d", label: "최근 30일" },
  { value: "90d", label: "최근 90일" },
  { value: "year", label: "올해" },
  { value: "all", label: "전체" },
];

export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; donationRange?: string }>;
}) {
  const { filter: rawFilter, donationRange: rawDonationRange } = await searchParams;
  const filter: HistoryFilter = FILTER_OPTIONS.some((o) => o.value === rawFilter)
    ? (rawFilter as HistoryFilter)
    : "all";
  const donationRange: RangePreset = DONATION_RANGE_OPTIONS.some(
    (o) => o.value === rawDonationRange
  )
    ? (rawDonationRange as RangePreset)
    : "all";

  const db = await getFullDB();
  const participants = [...db.participants].sort((a, b) =>
    a.name.localeCompare(b.name, "ko")
  );
  const nameMap = new Map(db.participants.map((p) => [p.id, p.name]));
  const nameOf = (id: string) => nameMap.get(id) ?? "(삭제됨)";
  const balances = computeNetBalances(db.games, db.settlements, db.adjustments);
  const transactions = simplifyDebts(balances);

  const balanceList = Array.from(balances.entries())
    .map(([id, amount]) => ({ id, amount, name: nameOf(id) }))
    .sort((a, b) => b.amount - a.amount);

  // Combine settlements and legacy adjustments into one chronological history
  // so it's clear at a glance why a balance moved — adjustments carry no
  // win/lose, so they're visually tagged distinctly from real settlements.
  type HistoryRow =
    | {
        kind: "settlement";
        id: string;
        date: string;
        createdAt: string;
        fromId: string;
        toId: string;
        amount: number;
        note?: string;
        type: "payment" | "donation";
      }
    | {
        kind: "adjustment";
        id: string;
        date: string;
        createdAt: string;
        fromId: string;
        toId: string;
        amount: number;
        note?: string;
      };

  const settlementRows: HistoryRow[] = db.settlements.map((s) => ({
    kind: "settlement",
    id: s.id,
    date: s.date,
    createdAt: s.createdAt,
    fromId: s.fromId,
    toId: s.toId,
    amount: s.amount,
    note: s.note,
    type: normalizeSettlementType(s.type),
  }));
  const adjustmentRows: HistoryRow[] = db.adjustments.map((a) => ({
    kind: "adjustment",
    id: a.id,
    date: a.date,
    createdAt: a.createdAt,
    fromId: a.fromId,
    toId: a.toId,
    amount: a.amount,
    note: a.note,
  }));

  const history = [...settlementRows, ...adjustmentRows]
    .filter((row) => {
      if (filter === "all") return true;
      if (filter === "adjustment") return row.kind === "adjustment";
      return row.kind === "settlement" && row.type === filter;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Donation ranking: total given / received per participant, from
  // donation-type settlements only (legacy "waiver" counts as donation too).
  const donationSettlements = filterByDatePreset(
    db.settlements.filter((s) => normalizeSettlementType(s.type) === "donation"),
    donationRange
  );
  const given = new Map<string, number>();
  const received = new Map<string, number>();
  for (const s of donationSettlements) {
    given.set(s.fromId, (given.get(s.fromId) ?? 0) + s.amount);
    received.set(s.toId, (received.get(s.toId) ?? 0) + s.amount);
  }
  const topGivers = Array.from(given.entries())
    .map(([id, amount]) => ({ id, amount, name: nameOf(id) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
  const topReceivers = Array.from(received.entries())
    .map(([id, amount]) => ({ id, amount, name: nameOf(id) }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">정산</h1>
        <p className="text-sm text-slate-500 mt-1">
          그동안 쌓인 채권-채무 관계를 최소 거래 수로 간소화해서 보여줍니다. 실제로
          점수를 상품으로 교환했다면 아래에서 정산 완료 처리를, 그냥 누군가에게
          점수를 주고 싶다면 기부로 기록해주세요.
        </p>
      </div>

      <SettlementsClient
        transactions={transactions}
        participants={participants.map((p) => ({ id: p.id, name: p.name }))}
      />

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">참가자별 순 잔액</h2>
        {balanceList.length === 0 ? (
          <p className="text-sm text-slate-400">잔액이 없습니다.</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {balanceList.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
              >
                <span>{b.name}</span>
                <span
                  className={`font-semibold ${
                    b.amount > 0 ? "text-emerald-600" : "text-red-500"
                  }`}
                >
                  {b.amount > 0 ? "+" : ""}
                  {b.amount}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-400 mt-3">
          양수(+)는 받을 점수, 음수(-)는 줘야 할 점수입니다. 게임·정산·기부·
          <Link href="/adjustments" className="underline">
            과거 누적기록
          </Link>
          이 모두 반영된 값입니다.
        </p>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-semibold">기부 랭킹</h2>
          <div className="flex gap-1">
            {DONATION_RANGE_OPTIONS.map((opt) => {
              const params = new URLSearchParams();
              if (filter !== "all") params.set("filter", filter);
              if (opt.value !== "all") params.set("donationRange", opt.value);
              const qs = params.toString();
              return (
                <Link
                  key={opt.value}
                  href={qs ? `/settlements?${qs}` : "/settlements"}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition ${
                    donationRange === opt.value
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {opt.label}
                </Link>
              );
            })}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium text-slate-400 mb-2">
              가장 많이 기부한 사람
            </h3>
            {topGivers.length === 0 ? (
              <p className="text-sm text-slate-400">기부 기록이 없습니다.</p>
            ) : (
              <ul className="space-y-1.5">
                {topGivers.map((g, i) => (
                  <li key={g.id} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className="w-4 text-slate-400">{i + 1}</span>
                      <span className="font-medium">{g.name}</span>
                    </span>
                    <span className="font-semibold text-amber-700">{g.amount}점</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-xs font-medium text-slate-400 mb-2">
              가장 많이 받은 사람
            </h3>
            {topReceivers.length === 0 ? (
              <p className="text-sm text-slate-400">기부 기록이 없습니다.</p>
            ) : (
              <ul className="space-y-1.5">
                {topReceivers.map((r, i) => (
                  <li key={r.id} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className="w-4 text-slate-400">{i + 1}</span>
                      <span className="font-medium">{r.name}</span>
                    </span>
                    <span className="font-semibold text-amber-700">{r.amount}점</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-semibold">정산 & 조정 이력 ({history.length}건)</h2>
          <div className="flex gap-1">
            {FILTER_OPTIONS.map((opt) => (
              <Link
                key={opt.value}
                href={
                  opt.value === "all"
                    ? "/settlements"
                    : `/settlements?filter=${opt.value}`
                }
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition ${
                  filter === opt.value
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {opt.label}
              </Link>
            ))}
          </div>
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-slate-400">해당하는 이력이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {history.map((row) => (
              <li
                key={`${row.kind}-${row.id}`}
                className="py-2.5 flex flex-wrap items-center gap-3 text-sm"
              >
                <span className="text-slate-400 w-24 shrink-0">
                  {format(new Date(row.date), "yyyy-MM-dd")}
                </span>
                {row.kind === "settlement" ? (
                  <SettlementTypeBadge type={row.type} />
                ) : (
                  <LedgerAdjustmentBadge />
                )}
                <span className="flex-1 min-w-[140px]">
                  <span className="font-medium">{nameOf(row.fromId)}</span>
                  <span className="text-slate-400 mx-1">→</span>
                  <span className="font-medium">{nameOf(row.toId)}</span>
                  <span className="text-slate-500 ml-2">{row.amount}점</span>
                  {row.note && (
                    <span className="text-xs text-slate-400 ml-2">
                      ({row.note})
                    </span>
                  )}
                </span>
                {row.kind === "settlement" && (
                  <form action={deleteSettlement.bind(null, row.id)}>
                    <button
                      type="submit"
                      className="text-xs text-slate-300 hover:text-red-600"
                    >
                      취소
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
