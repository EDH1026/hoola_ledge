"use client";

import { useMemo, useState, useTransition } from "react";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import { deleteSettlement, recordSettlement } from "@/lib/actions";
import { EDIT_WINDOW_MS, isWithinEditWindow } from "@/lib/time";
import { SettlementTypeBadge, LedgerAdjustmentBadge } from "@/components/badges";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { FilterChip } from "@/components/ui/FilterChip";
import { UndoStack, useUndoStack } from "@/components/ui/UndoStack";
import { useQueryParams } from "@/components/ui/useQueryParams";

export interface HistoryRow {
  kind: "settlement" | "adjustment";
  id: string;
  date: string;
  createdAt: string;
  fromId: string;
  toId: string;
  amount: number;
  note?: string;
  type?: "payment" | "donation";
}

interface ParticipantLite {
  id: string;
  name: string;
}

export type HistoryFilterValue = "all" | "payment" | "donation" | "adjustment";

const FILTER_OPTIONS: { value: HistoryFilterValue; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "payment", label: "실제 정산" },
  { value: "donation", label: "기부" },
  { value: "adjustment", label: "과거 기록" },
];

// v2.19 (배치 C, PRD §24.13) — 이력이 상한 없이 전부 한 번에 렌더됐다.
// 게임이 쌓이면 수백 행이 한 번에 그려진다. 50건씩 보여주고 "더 보기"로
// 늘린다(페이지 번호가 있는 진짜 페이지네이션까지는 필요 없어 보여서
// 간단한 로드모어로).
const PAGE_SIZE = 50;

// v2.19 (배치 B에서 다른 화면에 이미 있던 URL 동기화 패턴을 여기 필터
// 탭에도 적용) — 예전엔 필터 탭이 <Link href="?filter=...">로 서버 왕복
// 네비게이션이라 탭 하나 누를 때마다 전체 페이지가 리로드됐다. 클라이언트
// 상태 + URL 동기화로 바꿔 즉시 반응하게 한다.
export default function HistoryList({
  history,
  isAdmin,
  participants,
}: {
  /** 필터 이전의 전체 이력 — 필터링은 이제 이 컴포넌트가 클라이언트에서 한다. */
  history: HistoryRow[];
  isAdmin: boolean;
  participants: ParticipantLite[];
}) {
  const nameMap = useMemo(
    () => new Map(participants.map((p) => [p.id, p.name])),
    [participants]
  );
  const nameOf = (id: string) => nameMap.get(id) ?? "(삭제됨)";

  const { searchParams, set } = useQueryParams();
  const filter = (searchParams.get("filter") as HistoryFilterValue | null) ?? "all";
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  function setFilter(v: HistoryFilterValue) {
    set({ filter: v === "all" ? null : v });
    setVisibleCount(PAGE_SIZE);
  }

  const filtered = useMemo(() => {
    return history.filter((row) => {
      if (filter === "all") return true;
      if (filter === "adjustment") return row.kind === "adjustment";
      return row.kind === "settlement" && row.type === filter;
    });
  }, [history, filter]);
  const visible = filtered.slice(0, visibleCount);
  const hasMore = filtered.length > visibleCount;

  const undo = useUndoStack();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  function handleCancel(row: HistoryRow) {
    setError(null);
    startTransition(async () => {
      try {
        await deleteSettlement(row.id);
        const expiresAt = isAdmin
          ? Date.now() + EDIT_WINDOW_MS
          : new Date(row.createdAt).getTime() + EDIT_WINDOW_MS;
        undo.push({
          id: row.id,
          message: `취소됨: ${nameOf(row.fromId)} → ${nameOf(row.toId)} ${row.amount}점`,
          expiresAt,
          // deleteSettlement은 하드 삭제라(정산 테이블에 소프트 삭제용 컬럼이
          // 없고, 이번 배치는 스키마를 바꾸지 않는다) 진짜 "복원"은 불가능
          // 하다. 대신 같은 fromId/toId/amount/type/note로 recordSettlement를
          // 다시 호출해 잔액 효과는 동일하되 id·createdAt·date는 새로
          // 찍히는 "동등한 재기록"을 되돌리기로 쓴다.
          onUndo: async () => {
            await recordSettlement({
              fromId: row.fromId,
              toId: row.toId,
              amount: row.amount,
              type: row.type === "donation" ? "donation" : "payment",
              note: row.note,
            });
          },
        });
      } catch (e) {
        setError({
          id: row.id,
          message: e instanceof Error ? e.message : "취소에 실패했습니다.",
        });
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {FILTER_OPTIONS.map((opt) => (
          <FilterChip key={opt.value} selected={filter === opt.value} onClick={() => setFilter(opt.value)}>
            {opt.label}
          </FilterChip>
        ))}
      </div>

      <UndoStack entries={undo.entries} onRemove={undo.remove} />

      {filtered.length === 0 ? (
        <EmptyState
          title="해당하는 이력이 없습니다."
          action={
            filter !== "all" && (
              <Button variant="neutral" size="sm" onClick={() => setFilter("all")}>
                필터 초기화
              </Button>
            )
          }
        />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {visible.map((row) => {
              const canCancel =
                row.kind === "settlement" && (isAdmin || isWithinEditWindow(row.createdAt));
              return (
                <li
                  key={`${row.kind}-${row.id}`}
                  className="py-2.5 flex flex-wrap items-center gap-3 text-sm"
                >
                  <span className="text-content-muted w-24 shrink-0 tabular-nums">
                    {format(new Date(row.date), "yyyy-MM-dd")}
                  </span>
                  {row.kind === "settlement" ? (
                    <SettlementTypeBadge type={row.type} />
                  ) : (
                    <LedgerAdjustmentBadge />
                  )}
                  <span className="flex-1 min-w-[140px] tabular-nums">
                    <span className="font-medium text-content">{nameOf(row.fromId)}</span>
                    <span className="text-content-faint mx-1">→</span>
                    <span className="font-medium text-content">{nameOf(row.toId)}</span>
                    <span className="text-content-muted ml-2">{row.amount}점</span>
                    {row.note && (
                      <span className="text-xs text-content-muted ml-2">({row.note})</span>
                    )}
                  </span>
                  {canCancel && (
                    <button
                      type="button"
                      onClick={() => handleCancel(row)}
                      disabled={isPending}
                      aria-label="이 정산 취소"
                      className="w-11 h-11 shrink-0 flex items-center justify-center rounded-lg text-content-sub hover:bg-red-500/15 hover:text-red-300 transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50 disabled:pointer-events-none"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden />
                    </button>
                  )}
                  {error?.id === row.id && (
                    <p className="text-xs text-red-400 w-full">{error.message}</p>
                  )}
                </li>
              );
            })}
          </ul>
          {hasMore && (
            <div className="flex justify-center pt-1">
              <Button
                variant="neutral"
                size="sm"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              >
                더 보기 ({filtered.length - visibleCount}건 더)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
