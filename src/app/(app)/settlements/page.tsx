import Link from "next/link";
import { cookies } from "next/headers";
import { getFullDB } from "@/lib/storage";
import { computeNetBalances, simplifyDebts } from "@/lib/settle";
import { normalizeSettlementType } from "@/lib/types";
import { filterByDatePreset, RangePreset } from "@/lib/stats";
import { ADMIN_COOKIE_NAME, verifyAdminCookie } from "@/lib/auth";
import { Card } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { EmptyState } from "@/components/ui/EmptyState";
import { filterChipClassName } from "@/components/ui/FilterChip";
import SettlementsClient from "./SettlementsClient";
import HistoryList from "./HistoryList";

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
  const store = await cookies();
  const isAdmin = await verifyAdminCookie(store.get(ADMIN_COOKIE_NAME)?.value);

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-content">정산</h1>
        <p className="text-sm text-content-muted mt-1">
          그동안 쌓인 채권-채무 관계를 최소 거래 수로 간소화해서 보여줍니다. 실제로
          점수를 상품으로 교환했다면 아래에서 정산 완료 처리를, 그냥 누군가에게
          점수를 주고 싶다면 기부로 기록해주세요.
        </p>
      </div>

      <Card>
        <SectionTitle>참가자별 순 잔액</SectionTitle>
        {balanceList.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="잔액이 없습니다." />
          </div>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4 tabular-nums">
            {balanceList.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between rounded-lg bg-surface-raised px-3 py-2 text-sm"
              >
                <span className="text-content">{b.name}</span>
                <span
                  className={`font-semibold ${
                    b.amount > 0 ? "text-emerald-400" : "text-lose"
                  }`}
                >
                  {b.amount > 0 ? "+" : ""}
                  {b.amount}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-content-muted mt-3">
          양수(+)는 받을 점수, 음수(-)는 줘야 할 점수입니다. 게임·정산·기부·
          <Link href="/adjustments" className="underline">
            과거 누적기록
          </Link>
          이 모두 반영된 값입니다.
        </p>
      </Card>

      <SettlementsClient
        transactions={transactions}
        participants={participants.map((p) => ({ id: p.id, name: p.name }))}
      />

      <Card>
        <SectionTitle
          action={
            <div className="flex gap-2">
              {DONATION_RANGE_OPTIONS.map((opt) => {
                const params = new URLSearchParams();
                if (filter !== "all") params.set("filter", filter);
                if (opt.value !== "all") params.set("donationRange", opt.value);
                const qs = params.toString();
                return (
                  <Link
                    key={opt.value}
                    href={qs ? `/settlements?${qs}` : "/settlements"}
                    className={filterChipClassName(donationRange === opt.value)}
                  >
                    {opt.label}
                  </Link>
                );
              })}
            </div>
          }
        >
          기부 랭킹
        </SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2 mt-4">
          <div>
            <h3 className="text-xs font-medium text-content-muted mb-2">
              가장 많이 기부한 사람
            </h3>
            {topGivers.length === 0 ? (
              <EmptyState title="기부 기록이 없습니다." />
            ) : (
              <ul className="space-y-1.5 tabular-nums">
                {topGivers.map((g, i) => (
                  <li key={g.id} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className="w-4 text-content-faint">{i + 1}</span>
                      <span className="font-medium text-content">{g.name}</span>
                    </span>
                    <span className="font-semibold text-amber-300">{g.amount}점</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-xs font-medium text-content-muted mb-2">
              가장 많이 받은 사람
            </h3>
            {topReceivers.length === 0 ? (
              <EmptyState title="기부 기록이 없습니다." />
            ) : (
              <ul className="space-y-1.5 tabular-nums">
                {topReceivers.map((r, i) => (
                  <li key={r.id} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className="w-4 text-content-faint">{i + 1}</span>
                      <span className="font-medium text-content">{r.name}</span>
                    </span>
                    <span className="font-semibold text-amber-300">{r.amount}점</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle
          description="기록 후 2시간이 지난 항목은 관리자만 취소할 수 있습니다."
          action={
            <div className="flex gap-2">
              {FILTER_OPTIONS.map((opt) => (
                <Link
                  key={opt.value}
                  href={
                    opt.value === "all"
                      ? "/settlements"
                      : `/settlements?filter=${opt.value}`
                  }
                  className={filterChipClassName(filter === opt.value)}
                >
                  {opt.label}
                </Link>
              ))}
            </div>
          }
        >
          정산 & 조정 이력 ({history.length}건)
        </SectionTitle>
        <div className="mt-3">
          <HistoryList
            history={history}
            isAdmin={isAdmin}
            participants={participants.map((p) => ({ id: p.id, name: p.name }))}
            filterActive={filter !== "all"}
          />
        </div>
      </Card>
    </div>
  );
}
