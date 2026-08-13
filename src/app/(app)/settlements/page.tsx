import Link from "next/link";
import { format } from "date-fns";
import { readDB } from "@/lib/storage";
import { computeNetBalances, simplifyDebts } from "@/lib/settle";
import { recordSettlement, deleteSettlement } from "@/lib/actions";
import { SettlementTypeBadge, LedgerAdjustmentBadge } from "@/components/badges";
import { SettlementType } from "@/lib/types";

export const dynamic = "force-dynamic";

type HistoryFilter = "all" | "payment" | "waiver" | "adjustment";

const FILTER_OPTIONS: { value: HistoryFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "payment", label: "실제 정산" },
  { value: "waiver", label: "탕감" },
  { value: "adjustment", label: "과거 기록" },
];

export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter: rawFilter } = await searchParams;
  const filter: HistoryFilter = FILTER_OPTIONS.some((o) => o.value === rawFilter)
    ? (rawFilter as HistoryFilter)
    : "all";

  const db = await readDB();
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
    | { kind: "settlement"; id: string; date: string; createdAt: string; fromId: string; toId: string; amount: number; note?: string; type: SettlementType }
    | { kind: "adjustment"; id: string; date: string; createdAt: string; fromId: string; toId: string; amount: number; note?: string };

  const settlementRows: HistoryRow[] = db.settlements.map((s) => ({
    kind: "settlement",
    id: s.id,
    date: s.date,
    createdAt: s.createdAt,
    fromId: s.fromId,
    toId: s.toId,
    amount: s.amount,
    note: s.note,
    type: s.type ?? "payment",
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">정산</h1>
        <p className="text-sm text-slate-500 mt-1">
          그동안 쌓인 채권-채무 관계를 최소 거래 수로 간소화해서 보여줍니다. 실제로
          점수를 상품으로 교환했다면, 또는 그냥 탕감해주기로 했다면 아래에서
          처리해주세요.
        </p>
      </div>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">
          정리된 채권-채무 관계 ({transactions.length}건)
        </h2>
        {transactions.length === 0 ? (
          <p className="text-sm text-slate-400">정산할 내역이 없습니다. 모두 정산 완료 상태입니다.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {transactions.map((t, i) => (
              <div
                key={i}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3"
              >
                <div className="flex items-center justify-center gap-2 text-sm">
                  <span className="font-semibold text-red-500 truncate">
                    {nameOf(t.fromId)}
                  </span>
                  <span className="flex items-center gap-1 text-slate-400">
                    <span aria-hidden>→</span>
                  </span>
                  <span className="font-semibold text-emerald-600 truncate">
                    {nameOf(t.toId)}
                  </span>
                  <span className="ml-auto rounded-full bg-slate-900 text-white text-xs font-semibold px-2.5 py-1 whitespace-nowrap">
                    {t.amount}점
                  </span>
                </div>
                <form
                  action={async (formData: FormData) => {
                    "use server";
                    const amount = Number(formData.get("amount"));
                    const type = formData.get("type") === "waiver" ? "waiver" : "payment";
                    await recordSettlement({
                      fromId: t.fromId,
                      toId: t.toId,
                      amount,
                      type,
                    });
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    type="number"
                    name="amount"
                    defaultValue={t.amount}
                    min={1}
                    max={t.amount}
                    step={1}
                    className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm bg-white"
                  />
                  <select
                    name="type"
                    defaultValue="payment"
                    className="rounded-lg border border-slate-300 px-2 py-1 text-sm bg-white"
                  >
                    <option value="payment">실제 정산</option>
                    <option value="waiver">탕감</option>
                  </select>
                  <button
                    type="submit"
                    className="rounded-lg bg-slate-900 text-white text-xs font-medium px-3 py-1.5 hover:bg-slate-800 transition whitespace-nowrap ml-auto"
                  >
                    처리
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

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
          양수(+)는 받을 점수, 음수(-)는 줘야 할 점수입니다. 게임·정산·
          <Link href="/adjustments" className="underline">
            과거 누적기록
          </Link>
          이 모두 반영된 값입니다.
        </p>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-semibold">정산 & 조정 이력 ({history.length}건)</h2>
          <div className="flex gap-1">
            {FILTER_OPTIONS.map((opt) => (
              <Link
                key={opt.value}
                href={opt.value === "all" ? "/settlements" : `/settlements?filter=${opt.value}`}
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
