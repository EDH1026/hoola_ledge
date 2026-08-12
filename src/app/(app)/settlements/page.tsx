import { format } from "date-fns";
import { readDB } from "@/lib/storage";
import { computeNetBalances, simplifyDebts } from "@/lib/settle";
import { recordSettlement, deleteSettlement } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function SettlementsPage() {
  const db = await readDB();
  const nameMap = new Map(db.participants.map((p) => [p.id, p.name]));
  const balances = computeNetBalances(db.games, db.settlements);
  const transactions = simplifyDebts(balances);

  const balanceList = Array.from(balances.entries())
    .map(([id, amount]) => ({ id, amount, name: nameMap.get(id) ?? "(삭제됨)" }))
    .sort((a, b) => b.amount - a.amount);

  const history = [...db.settlements].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">정산</h1>
        <p className="text-sm text-slate-500 mt-1">
          그동안 쌓인 채권-채무 관계를 최소 거래 수로 간소화해서 보여줍니다. 실제로
          점수를 상품으로 교환했다면 아래에서 정산 완료 처리를 해주세요.
        </p>
      </div>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">
          정리된 채권-채무 관계 ({transactions.length}건)
        </h2>
        {transactions.length === 0 ? (
          <p className="text-sm text-slate-400">정산할 내역이 없습니다. 모두 정산 완료 상태입니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {transactions.map((t, i) => (
              <li
                key={i}
                className="py-3 flex flex-wrap items-center justify-between gap-3"
              >
                <span className="text-sm">
                  <span className="font-semibold">
                    {nameMap.get(t.fromId) ?? "(삭제됨)"}
                  </span>
                  <span className="text-slate-400 mx-1.5">가</span>
                  <span className="font-semibold">
                    {nameMap.get(t.toId) ?? "(삭제됨)"}
                  </span>
                  <span className="text-slate-400 mx-1.5">에게</span>
                  <span className="font-semibold">{t.amount}점</span>
                  <span className="text-slate-400"> 줄 차례</span>
                </span>
                <form
                  action={async (formData: FormData) => {
                    "use server";
                    const amount = Number(formData.get("amount"));
                    await recordSettlement({
                      fromId: t.fromId,
                      toId: t.toId,
                      amount,
                      note: "정산(상품 교환) 완료",
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
                    className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-slate-900 text-white text-xs font-medium px-3 py-1.5 hover:bg-slate-800 transition whitespace-nowrap"
                  >
                    정산 완료 처리
                  </button>
                </form>
              </li>
            ))}
          </ul>
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
          양수(+)는 받을 점수, 음수(-)는 줘야 할 점수입니다.
        </p>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">정산 이력 ({history.length}건)</h2>
        {history.length === 0 ? (
          <p className="text-sm text-slate-400">정산 이력이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {history.map((s) => {
              const del = deleteSettlement.bind(null, s.id);
              return (
                <li
                  key={s.id}
                  className="py-2.5 flex items-center justify-between gap-3 text-sm"
                >
                  <span className="text-slate-400 w-24">
                    {format(new Date(s.date), "yyyy-MM-dd")}
                  </span>
                  <span className="flex-1">
                    <span className="font-medium">
                      {nameMap.get(s.fromId) ?? "(삭제됨)"}
                    </span>
                    <span className="text-slate-400 mx-1">→</span>
                    <span className="font-medium">
                      {nameMap.get(s.toId) ?? "(삭제됨)"}
                    </span>
                    <span className="text-slate-500 ml-2">{s.amount}점</span>
                    {s.note && (
                      <span className="text-xs text-slate-400 ml-2">
                        ({s.note})
                      </span>
                    )}
                  </span>
                  <form action={del}>
                    <button
                      type="submit"
                      className="text-xs text-slate-300 hover:text-red-600"
                    >
                      취소
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
