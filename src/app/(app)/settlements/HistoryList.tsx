"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import { deleteSettlement, recordSettlement } from "@/lib/actions";
import { EDIT_WINDOW_MS, isWithinEditWindow } from "@/lib/time";
import { SettlementTypeBadge, LedgerAdjustmentBadge } from "@/components/badges";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { UndoStack, useUndoStack } from "@/components/ui/UndoStack";

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

// v2.19 (배치 B, PRD §24.11) — the old "취소" was a 12px 2.35:1 text link
// with no confirm step and no pending state, easy to fat-finger. This swaps
// it for a single 44×44 icon action (a dropdown would be overkill — 취소 is
// the only thing a row can do) plus the same "삭제됨 · 되돌리기" undo pattern
// as the games list, instead of a blocking confirm dialog.
export default function HistoryList({
  history,
  isAdmin,
  participants,
  filterActive,
}: {
  history: HistoryRow[];
  isAdmin: boolean;
  participants: ParticipantLite[];
  /** True when a non-default 필터 is applied — gates the empty state's "필터 초기화" action. */
  filterActive: boolean;
}) {
  const nameMap = useMemo(
    () => new Map(participants.map((p) => [p.id, p.name])),
    [participants]
  );
  const nameOf = (id: string) => nameMap.get(id) ?? "(삭제됨)";

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
      <UndoStack entries={undo.entries} onRemove={undo.remove} />
      {history.length === 0 ? (
        <EmptyState
          title="해당하는 이력이 없습니다."
          action={
            filterActive && (
              <Link href="/settlements">
                <Button variant="neutral" size="sm">
                  필터 초기화
                </Button>
              </Link>
            )
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {history.map((row) => {
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
      )}
    </div>
  );
}
