"use client";

import { useEffect, useState } from "react";
import { editWindowRemainingMs } from "@/lib/time";

// v2.19 (배치 B, PRD §24.12) — replaces the old "기록 후 2시간이 지나
// 수정·삭제할 수 없습니다." notice, which only ever appeared *after*
// expiry (so it got noisier the older a row got) with a live countdown that
// only exists *before* expiry — once it's gone, the missing chip (and the
// row action it gated) is the signal. Ticks once a minute; a live-updating
// game night is the target case, not second-level precision.
export function EditWindowChip({ createdAt }: { createdAt: string }) {
  // Starts at `null` ("not measured yet") rather than reading Date.now()
  // during render/the initializer — that's an impure read and belongs in an
  // effect. The first effect run resolves it a moment later; see
  // UndoStack.tsx's identical note for why that's an imperceptible flash in
  // practice, not a real gap.
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(editWindowRemainingMs(createdAt));
    const initial = setTimeout(tick, 0);
    const interval = setInterval(tick, 60_000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [createdAt]);

  if (remaining === null || remaining <= 0) return null;

  const totalMinutes = Math.max(1, Math.ceil(remaining / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const label = hours > 0 ? `수정 가능 ${hours}시간 ${minutes}분` : `수정 가능 ${minutes}분`;

  return (
    <span className="text-[11px] text-content-faint whitespace-nowrap tabular-nums">{label}</span>
  );
}
