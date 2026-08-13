"use client";

import { useState, useTransition } from "react";
import { previewRollback, executeRollback, RollbackCounts } from "@/lib/actions";
import { nowInSeoul, seoulLocalToUtcIso, formatInSeoul } from "@/lib/time";

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
    <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-5">
      <div>
        <label className="block text-xs text-slate-500 mb-1">
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
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
        />
        <p className="text-xs text-slate-400 mt-1">
          비교 기준(UTC): {thresholdIso} · 실제로는{" "}
          <span className="font-medium">{formatInSeoul(thresholdIso)} (KST)</span>
          {" "}이후에 생성된(createdAt 기준) 기록이 대상입니다.
        </p>
      </div>

      <button
        type="button"
        onClick={handlePreview}
        disabled={isPending}
        className="rounded-lg bg-slate-900 text-white text-sm font-medium px-4 py-2 hover:bg-slate-800 transition disabled:opacity-50"
      >
        {isPending ? "확인 중..." : "삭제 대상 미리보기"}
      </button>

      {preview && !previewStale && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2">
          <p className="text-sm font-semibold text-red-700">
            아래 기록이 영구적으로 삭제됩니다 (되돌릴 수 없음):
          </p>
          <ul className="text-sm text-red-700 space-y-0.5">
            <li>게임 기록: {preview.games}건</li>
            <li>정산/기부 기록: {preview.settlements}건</li>
            <li>과거 누적기록: {preview.adjustments}건</li>
          </ul>
          {preview.games + preview.settlements + preview.adjustments === 0 ? (
            <p className="text-sm text-slate-500">삭제될 대상이 없습니다.</p>
          ) : (
            <div className="pt-2">
              <label className="block text-xs text-red-700 mb-1">
                계속하려면 &ldquo;{CONFIRM_PHRASE}&rdquo;를 정확히 입력하세요
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={CONFIRM_PHRASE}
                className="rounded-lg border border-red-300 px-3 py-1.5 text-sm w-48"
              />
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={handleExecute}
        disabled={!canExecute || isPending}
        className="rounded-lg bg-red-600 text-white text-sm font-medium px-4 py-2 hover:bg-red-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isPending ? "삭제 중..." : "영구 삭제 실행"}
      </button>

      {result && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3">
          삭제 완료: 게임 {result.games}건, 정산/기부 {result.settlements}건,
          과거 누적기록 {result.adjustments}건.
        </div>
      )}
    </section>
  );
}
