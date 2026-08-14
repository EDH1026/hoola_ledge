"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { recordSettlement, deleteSettlement } from "@/lib/actions";
import { WritableSettlementType } from "@/lib/types";
import { EDIT_WINDOW_MS } from "@/lib/time";

interface ParticipantLite {
  id: string;
  name: string;
}

interface TransactionLite {
  fromId: string;
  toId: string;
  amount: number;
}

// A settlement at or above this many points, or one that clears an entire
// simplified transaction in one go, gets a strong visual warning at the
// confirm step. Most single games are worth 1-2 points, so 5+ in one
// settlement is unusually large for this app — the exact number is a
// judgment call, not a hard business rule.
const LARGE_AMOUNT_THRESHOLD = 5;

interface JustRecorded {
  id: string;
  summary: string;
  expiresAt: number; // Date.now()-comparable ms timestamp — PRD 15.2's 2-hour undo window
}

export default function SettlementsClient({
  transactions,
  participants,
}: {
  transactions: TransactionLite[];
  participants: ParticipantLite[];
}) {
  const nameMap = useMemo(
    () => new Map(participants.map((p) => [p.id, p.name])),
    [participants]
  );
  const nameOf = (id: string) => nameMap.get(id) ?? "(삭제됨)";

  const [justRecorded, setJustRecorded] = useState<JustRecorded | null>(null);
  const [expired, setExpired] = useState(false);
  const [undoing, startUndoTransition] = useTransition();
  const [undoError, setUndoError] = useState<string | null>(null);

  function handleRecorded(detail: JustRecorded) {
    setUndoError(null);
    setExpired(false);
    setJustRecorded(detail);
  }

  function handleUndo() {
    if (!justRecorded) return;
    const { id } = justRecorded;
    setUndoError(null);
    startUndoTransition(async () => {
      try {
        await deleteSettlement(id);
        setJustRecorded(null);
      } catch (e) {
        // Can happen if the 2-hour window lapsed between the banner
        // rendering and the click, or an admin-only edge case — either way
        // surface it instead of leaving the button silently do nothing.
        setUndoError(e instanceof Error ? e.message : "취소에 실패했습니다.");
      }
    });
  }

  // Flips the undo button off once its window (PRD 15.2) elapses, so it
  // doesn't sit there enabled-looking indefinitely if this tab is just left
  // open. `expired` (not a live Date.now() read at render time) is the only
  // thing render looks at — the impure clock read stays inside the effect.
  useEffect(() => {
    if (!justRecorded) return;
    const remaining = Math.max(0, justRecorded.expiresAt - Date.now());
    const timer = setTimeout(() => setExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [justRecorded]);

  const canUndo = !!justRecorded && !expired;

  return (
    <div className="space-y-8">
      {justRecorded && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3 space-y-1">
          <div className="flex items-center justify-between gap-3">
            <span>방금 기록됨: {justRecorded.summary}</span>
            {canUndo ? (
              <button
                type="button"
                onClick={handleUndo}
                disabled={undoing}
                className="text-emerald-700 font-semibold hover:underline disabled:opacity-50 whitespace-nowrap"
              >
                {undoing ? "취소 중..." : "취소"}
              </button>
            ) : (
              <span className="text-emerald-600/70 text-xs whitespace-nowrap">
                취소 가능 시간이 지났습니다
              </span>
            )}
          </div>
          {undoError && <p className="text-xs text-red-600">{undoError}</p>}
        </div>
      )}

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-4">
          정리된 채권-채무 관계 ({transactions.length}건)
        </h2>
        {transactions.length === 0 ? (
          <p className="text-sm text-slate-400">
            정산할 내역이 없습니다. 모두 정산 완료 상태입니다.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {transactions.map((t, i) => (
              <TransactionCard
                key={`${t.fromId}-${t.toId}-${i}`}
                fromId={t.fromId}
                toId={t.toId}
                fromName={nameOf(t.fromId)}
                toName={nameOf(t.toId)}
                fullAmount={t.amount}
                onRecorded={handleRecorded}
              />
            ))}
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-1">변제</h2>
        <p className="text-xs text-slate-400 mb-4">
          위 카드에 제안된 조합과 다르게 실제로 갚았을 때(예: 다른 사람이 대신
          내줬을 때) 자유롭게 기록합니다. 실제 정산과 계산 방식은 완전히
          같습니다 — 굳이 누구 대신인지를 남기지 않아도, 다음에 이 화면을
          열면 정리된 채권-채무 관계가 알아서 새로 계산되어 반영됩니다.
        </p>
        <RepaymentForm participants={participants} onRecorded={handleRecorded} />
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-1">기부 기록</h2>
        <p className="text-xs text-slate-400 mb-4">
          계산된 채권-채무 관계와 무관하게, 누구든 원하는 상대에게 원하는
          금액을 자유롭게 기부로 기록할 수 있습니다. 기부하는 사람의 잔액은
          그만큼 줄고, 받는 사람의 잔액은 그만큼 늡니다.
        </p>
        <DonationForm participants={participants} onRecorded={handleRecorded} />
      </section>
    </div>
  );
}

function WarningBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 font-medium">
      ⚠ {children}
    </div>
  );
}

function TransactionCard({
  fromId,
  toId,
  fromName,
  toName,
  fullAmount,
  onRecorded,
}: {
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  fullAmount: number;
  onRecorded: (detail: JustRecorded) => void;
}) {
  const [step, setStep] = useState<"idle" | "confirm">("idle");
  const [amountText, setAmountText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startTransition] = useTransition();

  const amount = Number(amountText);
  const amountValid =
    amountText.trim() !== "" &&
    Number.isInteger(amount) &&
    amount >= 1 &&
    amount <= fullAmount;
  const isFull = amountValid && amount === fullAmount;
  const isLarge = amountValid && (isFull || amount >= LARGE_AMOUNT_THRESHOLD);

  function goToConfirm() {
    setError(null);
    if (!amountValid) {
      setError(`1~${fullAmount} 사이의 정수를 입력해 주세요.`);
      return;
    }
    setStep("confirm");
  }

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        const { id, createdAt } = await recordSettlement({
          fromId,
          toId,
          amount,
          type: "payment",
        });
        onRecorded({
          id,
          summary: `${fromName} → ${toName} ${amount}점 (실제 정산)`,
          expiresAt: new Date(createdAt).getTime() + EDIT_WINDOW_MS,
        });
        setStep("idle");
        setAmountText("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "기록에 실패했습니다.");
      }
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
      <div className="flex items-center justify-center gap-2 text-sm">
        <span className="font-semibold text-red-500 truncate">{fromName}</span>
        <span className="text-slate-400" aria-hidden>
          →
        </span>
        <span className="font-semibold text-emerald-600 truncate">{toName}</span>
        <span className="ml-auto rounded-full bg-slate-900 text-white text-xs font-semibold px-2.5 py-1 whitespace-nowrap">
          {fullAmount}점
        </span>
      </div>

      {step === "idle" ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={fullAmount}
              step={1}
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="금액"
              className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm bg-white"
            />
            <button
              type="button"
              onClick={() => setAmountText(String(fullAmount))}
              className="rounded-lg border border-slate-300 bg-white text-xs font-medium px-2.5 py-1.5 hover:bg-slate-100 transition whitespace-nowrap"
            >
              전액 ({fullAmount}점)
            </button>
            <button
              type="button"
              onClick={goToConfirm}
              className="rounded-lg bg-slate-900 text-white text-xs font-medium px-3 py-1.5 hover:bg-slate-800 transition whitespace-nowrap ml-auto"
            >
              다음
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm">
            <span className="font-semibold">{fromName}</span>가{" "}
            <span className="font-semibold">{toName}</span>에게{" "}
            <span className="font-semibold">{amount}점</span>을 실제 정산으로
            기록합니다.
          </p>
          {isLarge && (
            <WarningBanner>
              {isFull
                ? "이 거래의 전액을 정산합니다."
                : `${LARGE_AMOUNT_THRESHOLD}점 이상의 큰 금액입니다.`}{" "}
              한 번 더 확인해 주세요.
            </WarningBanner>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isSaving}
              className="rounded-lg bg-slate-900 text-white text-xs font-medium px-3 py-1.5 hover:bg-slate-800 transition disabled:opacity-50"
            >
              {isSaving ? "기록 중..." : "확인 및 기록"}
            </button>
            <button
              type="button"
              onClick={() => setStep("idle")}
              disabled={isSaving}
              className="rounded-lg bg-white border border-slate-300 text-slate-600 text-xs font-medium px-3 py-1.5 hover:bg-slate-100 transition"
            >
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DonationForm({
  participants,
  onRecorded,
}: {
  participants: ParticipantLite[];
  onRecorded: (detail: JustRecorded) => void;
}) {
  const [fromId, setFromId] = useState(participants[0]?.id ?? "");
  const [toId, setToId] = useState(participants[1]?.id ?? participants[0]?.id ?? "");
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [step, setStep] = useState<"idle" | "confirm">("idle");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startTransition] = useTransition();

  const nameMap = useMemo(
    () => new Map(participants.map((p) => [p.id, p.name])),
    [participants]
  );
  const amount = Number(amountText);
  const amountValid = amountText.trim() !== "" && Number.isInteger(amount) && amount >= 1;
  const isLarge = amountValid && amount >= LARGE_AMOUNT_THRESHOLD;

  function goToConfirm() {
    setError(null);
    if (fromId === toId) {
      setError("주는 사람과 받는 사람이 같을 수 없습니다.");
      return;
    }
    if (!amountValid) {
      setError("1 이상의 정수 금액을 입력해 주세요.");
      return;
    }
    setStep("confirm");
  }

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        const type: WritableSettlementType = "donation";
        const { id, createdAt } = await recordSettlement({ fromId, toId, amount, type, note });
        onRecorded({
          id,
          summary: `${nameMap.get(fromId)} → ${nameMap.get(toId)} ${amount}점 (기부)`,
          expiresAt: new Date(createdAt).getTime() + EDIT_WINDOW_MS,
        });
        setStep("idle");
        setAmountText("");
        setNote("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "기록에 실패했습니다.");
      }
    });
  }

  if (step === "confirm") {
    return (
      <div className="space-y-2">
        <p className="text-sm">
          <span className="font-semibold">{nameMap.get(fromId)}</span>가{" "}
          <span className="font-semibold">{nameMap.get(toId)}</span>에게{" "}
          <span className="font-semibold">{amount}점</span>을 기부로
          기록합니다.
        </p>
        {isLarge && (
          <WarningBanner>
            {LARGE_AMOUNT_THRESHOLD}점 이상의 큰 금액입니다. 한 번 더 확인해
            주세요.
          </WarningBanner>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSaving}
            className="rounded-lg bg-amber-600 text-white text-sm font-medium px-4 py-2 hover:bg-amber-700 transition disabled:opacity-50"
          >
            {isSaving ? "기록 중..." : "확인 및 기부 기록"}
          </button>
          <button
            type="button"
            onClick={() => setStep("idle")}
            disabled={isSaving}
            className="rounded-lg bg-white border border-slate-300 text-slate-600 text-sm font-medium px-4 py-2 hover:bg-slate-100 transition"
          >
            취소
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">주는 사람</label>
          <select
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
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
          <label className="block text-xs text-slate-500 mb-1">받는 사람</label>
          <select
            value={toId}
            onChange={(e) => setToId(e.target.value)}
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
            min={1}
            step={1}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            placeholder="금액"
            className="w-20 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs text-slate-500 mb-1">메모 (선택)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예: 그냥 기분이라서"
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={goToConfirm}
          className="rounded-lg bg-amber-600 text-white text-sm font-medium px-4 py-2 hover:bg-amber-700 transition"
        >
          다음
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

// Free-form counterpart to TransactionCard: same "payment" balance math
// (fromId += amount, toId -= amount, via settle.ts's non-donation branch),
// just not constrained to a specific simplifyDebts()-suggested pair/amount.
// There's deliberately no "on whose behalf" field — who ultimately benefited
// doesn't change anyone's balance (see PRD 13.7), and the next time this
// screen loads, 정리된 채권-채무 관계 recomputes from the updated balances on
// its own. Anyone who wants that context can just write it in the note.
function RepaymentForm({
  participants,
  onRecorded,
}: {
  participants: ParticipantLite[];
  onRecorded: (detail: JustRecorded) => void;
}) {
  const [fromId, setFromId] = useState(participants[0]?.id ?? "");
  const [toId, setToId] = useState(participants[1]?.id ?? participants[0]?.id ?? "");
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [step, setStep] = useState<"idle" | "confirm">("idle");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startTransition] = useTransition();

  const nameMap = useMemo(
    () => new Map(participants.map((p) => [p.id, p.name])),
    [participants]
  );
  const amount = Number(amountText);
  const amountValid = amountText.trim() !== "" && Number.isInteger(amount) && amount >= 1;
  const isLarge = amountValid && amount >= LARGE_AMOUNT_THRESHOLD;

  function goToConfirm() {
    setError(null);
    if (fromId === toId) {
      setError("갚은 사람과 받은 사람이 같을 수 없습니다.");
      return;
    }
    if (!amountValid) {
      setError("1 이상의 정수 금액을 입력해 주세요.");
      return;
    }
    setStep("confirm");
  }

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        const { id, createdAt } = await recordSettlement({
          fromId,
          toId,
          amount,
          type: "payment",
          note,
        });
        onRecorded({
          id,
          summary: `${nameMap.get(fromId)} → ${nameMap.get(toId)} ${amount}점 (변제)`,
          expiresAt: new Date(createdAt).getTime() + EDIT_WINDOW_MS,
        });
        setStep("idle");
        setAmountText("");
        setNote("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "기록에 실패했습니다.");
      }
    });
  }

  if (step === "confirm") {
    return (
      <div className="space-y-2">
        <p className="text-sm">
          <span className="font-semibold">{nameMap.get(fromId)}</span>가{" "}
          <span className="font-semibold">{nameMap.get(toId)}</span>에게{" "}
          <span className="font-semibold">{amount}점</span>을 변제로 기록합니다.
        </p>
        {isLarge && (
          <WarningBanner>
            {LARGE_AMOUNT_THRESHOLD}점 이상의 큰 금액입니다. 한 번 더 확인해
            주세요.
          </WarningBanner>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSaving}
            className="rounded-lg bg-slate-900 text-white text-sm font-medium px-4 py-2 hover:bg-slate-800 transition disabled:opacity-50"
          >
            {isSaving ? "기록 중..." : "확인 및 변제 기록"}
          </button>
          <button
            type="button"
            onClick={() => setStep("idle")}
            disabled={isSaving}
            className="rounded-lg bg-white border border-slate-300 text-slate-600 text-sm font-medium px-4 py-2 hover:bg-slate-100 transition"
          >
            취소
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">갚은 사람</label>
          <select
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
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
          <label className="block text-xs text-slate-500 mb-1">받은 사람</label>
          <select
            value={toId}
            onChange={(e) => setToId(e.target.value)}
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
            min={1}
            step={1}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            placeholder="금액"
            className="w-20 rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs text-slate-500 mb-1">메모 (선택)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예: 창민이 대신 현금으로 지불"
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={goToConfirm}
          className="rounded-lg bg-slate-900 text-white text-sm font-medium px-4 py-2 hover:bg-slate-800 transition"
        >
          다음
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
