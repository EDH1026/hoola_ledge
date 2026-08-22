"use client";

import { useState, useTransition } from "react";
import { previewRollback, executeRollback, RollbackCounts } from "@/lib/actions";
import { nowInSeoul, seoulLocalToUtcIso, formatInSeoul } from "@/lib/time";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

const CONFIRM_PHRASE = "삭제합니다";

export default function RollbackForm() {
  const { date, time } = nowInSeoul();
  const [localDateTime, setLocalDateTime] = useState(`${date}T${time}`);
  const [preview, setPreview] = useState<RollbackCounts | null>(null);
  const [previewedFor, setPreviewedFor] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState<RollbackCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const thresholdIso = seoulLocalToUtcIso(localDateTime);
  const previewStale = previewedFor !== thresholdIso;
  const canExecute =
    !!preview &&
    !previewStale &&
    confirmText === CONFIRM_PHRASE &&
    (preview.games + preview.settlements + preview.adjustments) > 0;

  function handlePreview() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const counts = await previewRollback(thresholdIso);
        setPreview(counts);
        setPreviewedFor(thresholdIso);
        setConfirmText("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "미리보기에 실패했습니다.");
      }
    });
  }

  function handleExecute() {
    if (!canExecute) return;
    setError(null);
    startTransition(async () => {
      try {
        const counts = await executeRollback(thresholdIso);
        setResult(counts);
        setPreview(null);
        setPreviewedFor(null);
        setConfirmText("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "롤백 실행에 실패했습니다.");
      }
    });
  }

  return (
    <Card className="space-y-5">
      <div>
        <label className="block text-xs text-content-muted mb-1">
          이 시각(KST) 이후에 생성된 기록을 삭제
        </label>
        <input
          type="datetime-local"
          value={localDateTime}
          onChange={(e) => {
            setLocalDateTime(e.target.value);
            setPreview(null);
            setPreviewedFor(null);
            setConfirmText("");
            setResult(null);
          }}
          className="bg-surface rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-content"
        />
        <p className="text-xs text-content-muted mt-1">
          비교 기준(UTC): {thresholdIso} · 실제로는{" "}
          <span className="font-medium text-content">{formatInSeoul(thresholdIso)} (KST)</span>
          {" "}이후에 생성된(createdAt 기준) 기록이 대상입니다.
        </p>
      </div>

      <Button
        variant="primary"
        onClick={handlePreview}
        disabled={isPending}
        pending={isPending}
        pendingText="확인 중..."
      >
        삭제 대상 미리보기
      </Button>

      {preview && !previewStale && (
        <div className="rounded-xl border border-red-800 bg-red-500/10 p-4 space-y-2">
          <p className="text-sm font-semibold text-red-300">
            아래 기록이 영구적으로 삭제됩니다 (되돌릴 수 없음):
          </p>
          <ul className="text-sm text-red-300 space-y-0.5 tabular-nums">
            <li>게임 기록: {preview.games}건</li>
            <li>배출권 이전/면죄부 기록: {preview.settlements}건</li>
            <li>이월 기록: {preview.adjustments}건</li>
          </ul>
          {preview.games + preview.settlements + preview.adjustments === 0 ? (
            <p className="text-sm text-content-muted">삭제될 대상이 없습니다.</p>
          ) : (
            <div className="pt-2">
              <label className="block text-xs text-red-300 mb-1">
                계속하려면 &ldquo;{CONFIRM_PHRASE}&rdquo;를 정확히 입력하세요
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={CONFIRM_PHRASE}
                className="bg-surface rounded-lg border border-red-700 px-3 py-1.5 text-sm w-48 text-content"
              />
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Deliberately not the standard `danger` token (a soft translucent
          wash meant for routine deletes) — this is the app's only
          irreversible mass-delete, so it keeps a solid, unmistakably alarming
          red rather than being visually downgraded to match routine "삭제"
          buttons elsewhere. */}
      <button
        type="button"
        onClick={handleExecute}
        disabled={!canExecute || isPending}
        className="min-h-11 rounded-lg bg-red-600 text-white text-sm font-medium px-4 transition active:scale-[0.97] hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none"
      >
        {isPending ? "삭제 중..." : "영구 삭제 실행"}
      </button>

      {result && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-800 text-emerald-300 text-sm px-4 py-3 tabular-nums">
          삭제 완료: 게임 {result.games}건, 배출권 이전/면죄부 {result.settlements}건,
          이월 기록 {result.adjustments}건.
        </div>
      )}
    </Card>
  );
}
