import { format } from "date-fns";
import { listParticipants, listAdjustments } from "@/lib/storage";
import {
  addLedgerAdjustment,
  updateLedgerAdjustment,
  deleteLedgerAdjustment,
} from "@/lib/actions";
import { LedgerAdjustmentBadge } from "@/components/badges";
import { todayInSeoul } from "@/lib/time";
import { Card } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { EmptyState } from "@/components/ui/EmptyState";
import { SubmitButton } from "@/components/ui/SubmitButton";

export const dynamic = "force-dynamic";

export default async function AdjustmentsPage() {
  const [allParticipants, allAdjustments] = await Promise.all([
    listParticipants(),
    listAdjustments(),
  ]);
  const participants = [...allParticipants].sort((a, b) =>
    a.name.localeCompare(b.name, "ko")
  );
  const nameMap = new Map(allParticipants.map((p) => [p.id, p.name]));
  const adjustments = [...allAdjustments].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );

  return (
    <div className="space-y-6">
      <div>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 text-amber-300 text-xs font-medium px-2.5 py-1 mb-2">
          관리자 모드
        </div>
        <h1 className="text-2xl font-bold text-content">이월 기록</h1>
        <p className="text-sm text-content-muted mt-1">
          이 앱을 쓰기 전부터 있던 배출권 이전 관계를 게임 기록 없이 반영합니다.
          승패 개념이 없고, 누가 누구에게 얼마를 넘겨야 하는지만 기록합니다.
          통계(승/패/참석)에는 영향을 주지 않으며, 보유량 계산에는 반영됩니다.
        </p>
      </div>

      {participants.length < 2 ? (
        <Card className="text-sm text-content-muted">
          먼저 참가자를 2명 이상 등록해 주세요.
        </Card>
      ) : (
        <Card>
          <SectionTitle>새 이월 기록 추가</SectionTitle>
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
            className="flex flex-wrap items-end gap-3 mt-3"
          >
            <div>
              <label className="block text-xs text-content-muted mb-1">
                넘길 사람 (배출권 부족)
              </label>
              <select
                name="fromId"
                required
                className="bg-surface rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-content min-w-[120px]"
              >
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-content-muted mb-1">
                받을 사람 (배출권 잉여)
              </label>
              <select
                name="toId"
                required
                className="bg-surface rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-content min-w-[120px]"
              >
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-content-muted mb-1">수량</label>
              <input
                type="number"
                name="amount"
                min={1}
                step={1}
                defaultValue={1}
                required
                className="bg-surface w-20 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-content tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs text-content-muted mb-1">날짜</label>
              <input
                type="date"
                name="date"
                defaultValue={todayInSeoul()}
                className="bg-surface rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-content"
              />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs text-content-muted mb-1">
                메모 (선택)
              </label>
              <input
                type="text"
                name="note"
                placeholder="예: 앱 도입 전 이월분"
                className="bg-surface w-full rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-content"
              />
            </div>
            <SubmitButton pendingText="추가 중...">추가</SubmitButton>
          </form>
        </Card>
      )}

      <Card>
        <SectionTitle>이월 기록 목록 ({adjustments.length}건)</SectionTitle>
        {adjustments.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="등록된 이월 기록이 없습니다." />
          </div>
        ) : (
          <ul className="divide-y divide-line mt-3">
            {adjustments.map((a) => {
              const del = deleteLedgerAdjustment.bind(null, a.id);
              return (
                <li key={a.id} className="py-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 tabular-nums">
                    <LedgerAdjustmentBadge />
                    <span className="text-xs text-content-muted">
                      {format(new Date(a.date), "yyyy-MM-dd")}
                    </span>
                    <span className="text-sm ml-1">
                      <span className="font-medium text-content">
                        {nameMap.get(a.fromId) ?? "(삭제됨)"}
                      </span>
                      <span className="text-content-faint mx-1">→</span>
                      <span className="font-medium text-content">
                        {nameMap.get(a.toId) ?? "(삭제됨)"}
                      </span>
                      <span className="text-content-muted ml-2">{a.amount}점</span>
                      {a.note && (
                        <span className="text-xs text-content-muted ml-2">
                          ({a.note})
                        </span>
                      )}
                    </span>
                    <form action={del} className="ml-auto">
                      <SubmitButton variant="danger" size="sm" pendingText="삭제 중...">
                        삭제
                      </SubmitButton>
                    </form>
                  </div>
                  <details className="text-xs text-content-muted">
                    <summary className="cursor-pointer select-none hover:text-content">
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
                        className="bg-surface rounded-lg border border-slate-700 px-2 py-1 text-xs text-content"
                      >
                        {participants.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <span className="text-content-faint">→</span>
                      <select
                        name="toId"
                        defaultValue={a.toId}
                        className="bg-surface rounded-lg border border-slate-700 px-2 py-1 text-xs text-content"
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
                        className="bg-surface w-16 rounded-lg border border-slate-700 px-2 py-1 text-xs text-content tabular-nums"
                      />
                      <input
                        type="date"
                        name="date"
                        defaultValue={a.date}
                        className="bg-surface rounded-lg border border-slate-700 px-2 py-1 text-xs text-content"
                      />
                      <input
                        type="text"
                        name="note"
                        defaultValue={a.note ?? ""}
                        placeholder="메모"
                        className="bg-surface flex-1 min-w-[100px] rounded-lg border border-slate-700 px-2 py-1 text-xs text-content"
                      />
                      <SubmitButton size="sm" pendingText="저장 중...">
                        저장
                      </SubmitButton>
                    </form>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
