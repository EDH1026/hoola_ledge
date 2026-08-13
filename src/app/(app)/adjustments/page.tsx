import { format } from "date-fns";
import { readDB } from "@/lib/storage";
import {
  addLedgerAdjustment,
  updateLedgerAdjustment,
  deleteLedgerAdjustment,
} from "@/lib/actions";
import { LedgerAdjustmentBadge } from "@/components/badges";

export const dynamic = "force-dynamic";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default async function AdjustmentsPage() {
  const db = await readDB();
  const participants = [...db.participants].sort((a, b) =>
    a.name.localeCompare(b.name, "ko")
  );
  const nameMap = new Map(db.participants.map((p) => [p.id, p.name]));
  const adjustments = [...db.adjustments].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );

  return (
    <div className="space-y-8">
      <div>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-700 text-xs font-medium px-2.5 py-1 mb-2">
          관리자 모드
        </div>
        <h1 className="text-2xl font-bold">과거 누적기록</h1>
        <p className="text-sm text-slate-500 mt-1">
          이 앱을 쓰기 전부터 있던 채권-채무 관계를 게임 기록 없이 반영합니다.
          승패 개념이 없고, 채무자가 채권자에게 얼마를 빚졌는지만 기록합니다.
          통계(승/패/참석)에는 영향을 주지 않으며, 정산 잔액 계산에는 반영됩니다.
        </p>
      </div>

      {participants.length < 2 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 text-sm text-slate-500">
          먼저 참가자를 2명 이상 등록해 주세요.
        </div>
      ) : (
        <section className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="font-semibold mb-3">새 과거 기록 추가</h2>
          <form
            action={async (formData: FormData) => {
              "use server";
              await addLedgerAdjustment({
                fromId: String(formData.get("fromId") ?? ""),
                toId: String(formData.get("toId") ?? ""),
                amount: Number(formData.get("amount")),
                note: String(formData.get("note") ?? ""),
                date: String(formData.get("date") ?? ""),
              });
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <div>
              <label className="block text-xs text-slate-500 mb-1">
                채무자 (빚진 사람)
              </label>
              <select
                name="fromId"
                required
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm min-w-[120px]"
              >
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">
                채권자 (받을 사람)
              </label>
              <select
                name="toId"
                required
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm min-w-[120px]"
              >
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">금액</label>
              <input
                type="number"
                name="amount"
                min={1}
                step={1}
                defaultValue={1}
                required
                className="w-20 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">날짜</label>
              <input
                type="date"
                name="date"
                defaultValue={todayIso()}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs text-slate-500 mb-1">
                메모 (선택)
              </label>
              <input
                type="text"
                name="note"
                placeholder="예: 앱 도입 전 카드게임 빚"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-slate-900 text-white text-sm font-medium px-4 py-2 hover:bg-slate-800 transition"
            >
              추가
            </button>
          </form>
        </section>
      )}

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">
          과거 기록 목록 ({adjustments.length}건)
        </h2>
        {adjustments.length === 0 ? (
          <p className="text-sm text-slate-400">등록된 과거 기록이 없습니다.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {adjustments.map((a) => {
              const del = deleteLedgerAdjustment.bind(null, a.id);
              return (
                <li key={a.id} className="py-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <LedgerAdjustmentBadge />
                    <span className="text-xs text-slate-400">
                      {format(new Date(a.date), "yyyy-MM-dd")}
                    </span>
                    <span className="text-sm ml-1">
                      <span className="font-medium">
                        {nameMap.get(a.fromId) ?? "(삭제됨)"}
                      </span>
                      <span className="text-slate-400 mx-1">→</span>
                      <span className="font-medium">
                        {nameMap.get(a.toId) ?? "(삭제됨)"}
                      </span>
                      <span className="text-slate-500 ml-2">{a.amount}점</span>
                      {a.note && (
                        <span className="text-xs text-slate-400 ml-2">
                          ({a.note})
                        </span>
                      )}
                    </span>
                    <form action={del} className="ml-auto">
                      <button
                        type="submit"
                        className="text-xs text-slate-300 hover:text-red-600"
                      >
                        삭제
                      </button>
                    </form>
                  </div>
                  <details className="text-xs text-slate-400">
                    <summary className="cursor-pointer select-none hover:text-slate-700">
                      수정
                    </summary>
                    <form
                      action={async (formData: FormData) => {
                        "use server";
                        await updateLedgerAdjustment(a.id, {
                          fromId: String(formData.get("fromId") ?? ""),
                          toId: String(formData.get("toId") ?? ""),
                          amount: Number(formData.get("amount")),
                          note: String(formData.get("note") ?? ""),
                          date: String(formData.get("date") ?? ""),
                        });
                      }}
                      className="flex flex-wrap items-end gap-2 mt-2"
                    >
                      <select
                        name="fromId"
                        defaultValue={a.fromId}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                      >
                        {participants.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <span>→</span>
                      <select
                        name="toId"
                        defaultValue={a.toId}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                      >
                        {participants.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        name="amount"
                        min={1}
                        step={1}
                        defaultValue={a.amount}
                        className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                      />
                      <input
                        type="date"
                        name="date"
                        defaultValue={a.date}
                        className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                      />
                      <input
                        type="text"
                        name="note"
                        defaultValue={a.note ?? ""}
                        placeholder="메모"
                        className="flex-1 min-w-[100px] rounded-lg border border-slate-300 px-2 py-1 text-xs"
                      />
                      <button
                        type="submit"
                        className="rounded-lg bg-slate-900 text-white text-xs font-medium px-3 py-1 hover:bg-slate-800 transition"
                      >
                        저장
                      </button>
                    </form>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
