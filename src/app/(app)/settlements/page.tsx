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
import { balanceVariant, formatBalance } from "@/lib/settlement-display";
import SettlementsClient from "./SettlementsClient";
import HistoryList from "./HistoryList";

export const dynamic = "force-dynamic";

const DONATION_RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "30d", label: "최근 30일" },
  { value: "90d", label: "최근 90일" },
  { value: "year", label: "올해" },
  { value: "all", label: "전체" },
];

export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ donationRange?: string }>;
}) {
  const store = await cookies();
  const isAdmin = await verifyAdminCookie(store.get(ADMIN_COOKIE_NAME)?.value);

  const { donationRange: rawDonationRange } = await searchParams;
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

  // v2.19 (배치 C, PRD §24.13) — 필터링은 이제 HistoryList가 클라이언트에서
  // 한다(서버 왕복 네비게이션 대신 즉시 반응하는 URL 동기화 상태로). 여기선
  // 정렬만 하고 전체를 넘긴다.
  const history = [...settlementRows, ...adjustmentRows].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );

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
        <h1 className="text-2xl font-bold text-content">배출권 이전</h1>
        <p className="text-sm text-content-muted mt-1">
          그동안 쌓인 배출권 이전 관계를 최소 이전 횟수로 간소화해서 보여줍니다.
          감축 행동을 인증했다면 아래에서 이전 완료 처리를, 누군가의 부담을
          덜어주고 싶다면 면죄부로 기록해주세요. 감축 행동 목록은{" "}
          <Link href="/principles" className="underline">
            운영원칙
          </Link>
          에서 확인할 수 있습니다.
        </p>
      </div>

      <Card>
        <SectionTitle>참가자별 순 보유량</SectionTitle>
        {balanceList.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="보유량이 없습니다." />
          </div>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4 tabular-nums">
            {/* v2.19 (배치 C, PRD §24.13, 기능 수정) — 예전엔 `amount > 0`
                하나로만 갈라서 잔액이 정확히 0인 사람이 빨간 "0"으로 표시
                됐다(정산이 끝난 사람이 채무자처럼 보임). 3분기로 나눈다.
                금액 접미사("점")도 이 화면만 빠져 있어 이력·랭킹과 맞춘다.
                v2.23 — kg 병기는 이 카드에서만 한다(PRD §32.2 주석). */}
            {balanceList.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-surface-raised px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate text-content">{b.name}</span>
                <span
                  className={`shrink-0 text-right font-semibold ${
                    balanceVariant(b.amount) === "positive"
                      ? "text-win"
                      : balanceVariant(b.amount) === "negative"
                      ? "text-lose"
                      : "text-content-muted"
                  }`}
                >
                  <span className="block whitespace-nowrap">{formatBalance(b.amount)}</span>
                  {b.amount !== 0 && (
                    <span className="block whitespace-nowrap text-xs font-normal text-content-faint">
                      ({b.amount > 0 ? "+" : ""}
                      {b.amount * 10}kg)
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-content-muted mt-3">
          양수(+)는 받을 배출권, 음수(-)는 넘겨야 할 배출권입니다. 게임·이전·면죄부·
          <Link href="/adjustments" className="underline">
            이월 기록
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
          면죄부 랭킹
        </SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2 mt-4">
          <div>
            <h3 className="text-xs font-medium text-content-muted mb-2">
              가장 많이 죄를 사하여 주신 분
            </h3>
            {topGivers.length === 0 ? (
              <EmptyState title="발행된 면죄부가 없습니다." />
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
              가장 많이 면죄부를 받으신 분
            </h3>
            {topReceivers.length === 0 ? (
              <EmptyState title="발행된 면죄부가 없습니다." />
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
        <SectionTitle description="기록 후 2시간이 지난 항목은 관리자만 취소할 수 있습니다.">
          이전 & 이월 이력 ({history.length}건)
        </SectionTitle>
        <div className="mt-3">
          <HistoryList
            history={history}
            isAdmin={isAdmin}
            participants={participants.map((p) => ({ id: p.id, name: p.name }))}
          />
        </div>
      </Card>
    </div>
  );
}
