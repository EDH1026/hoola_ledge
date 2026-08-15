"use client";

import { useEffect, useState } from "react";
import { Button } from "./Button";

// v2.19 (배치 B, PRD §24.11) — generalizes SettlementsClient's old
// single-slot "방금 기록됨 · 취소" banner into a small stack (max `max`
// entries, oldest dropped first) so back-to-back actions (기록 2건, 삭제
// 여러 건 등) don't clobber each other's undo affordance. Each entry expires
// on its own timer at `expiresAt` (typically now + EDIT_WINDOW_MS, PRD §15),
// matching the existing 2시간 유예시간 rule rather than a generic toast
// auto-dismiss — this is an undo *window*, not a transient notification.
export interface UndoEntry {
  id: string;
  message: string;
  expiresAt: number; // Date.now()-comparable ms timestamp
  onUndo: () => Promise<void> | void;
}

export function useUndoStack(max = 3) {
  const [entries, setEntries] = useState<UndoEntry[]>([]);

  function push(entry: UndoEntry) {
    setEntries((prev) => [entry, ...prev.filter((e) => e.id !== entry.id)].slice(0, max));
  }
  function remove(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  return { entries, push, remove };
}

export function UndoStack({
  entries,
  onRemove,
}: {
  entries: UndoEntry[];
  onRemove: (id: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <UndoRow key={entry.id} entry={entry} onRemove={onRemove} />
      ))}
    </div>
  );
}

function UndoRow({
  entry,
  onRemove,
}: {
  entry: UndoEntry;
  onRemove: (id: string) => void;
}) {
  // Starts optimistic (not expired) — the clock read that could prove
  // otherwise only happens inside the effect below, never during render
  // (Date.now() is impure and effects are where impure reads belong). An
  // entry that's already expired the instant it's pushed corrects itself on
  // the first effect run a moment later; in practice every entry here is
  // pushed with a fresh multi-hour expiry, so that flash never happens.
  const [expired, setExpired] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const remaining = Math.max(0, entry.expiresAt - Date.now());
    const timer = setTimeout(() => setExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [entry.expiresAt]);

  async function handleUndo() {
    setUndoing(true);
    setError(null);
    try {
      await entry.onUndo();
      onRemove(entry.id);
    } catch (e) {
      setUndoing(false);
      setError(e instanceof Error ? e.message : "되돌리기에 실패했습니다.");
    }
  }

  return (
    <div className="rounded-xl bg-emerald-500/10 border border-emerald-800 text-emerald-300 text-sm px-4 py-3 space-y-1">
      <div className="flex items-center justify-between gap-3">
        <span>{entry.message}</span>
        {!expired ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleUndo}
            disabled={undoing}
            pending={undoing}
            pendingText="되돌리는 중..."
            className="text-emerald-300 hover:bg-emerald-500/20 hover:text-emerald-200 whitespace-nowrap shrink-0"
          >
            되돌리기
          </Button>
        ) : (
          <span className="text-emerald-400/70 text-xs whitespace-nowrap shrink-0">
            되돌릴 수 있는 시간이 지났습니다
          </span>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
