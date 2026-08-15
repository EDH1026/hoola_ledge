"use client";

import { useMemo, useState, useTransition } from "react";
import { TriangleAlert } from "lucide-react";
import { recordSettlement, deleteSettlement } from "@/lib/actions";
import { WritableSettlementType } from "@/lib/types";
import { EDIT_WINDOW_MS } from "@/lib/time";
import { Card } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { UndoStack, useUndoStack } from "@/components/ui/UndoStack";

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
  createdAt: string;
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

  // v2.19 (배치 B, PRD §24.11) — 이전엔 "방금 기록됨" 배너가 슬롯 1개라
  // 연속으로 2건을 기록하면 첫 번째 취소 버튼이 사라졌다. 공용 UndoStack으로
  // 바꿔 최근 몇 건이든 각자의 되돌리기를 유지한다.
  const undo = useUndoStack();

  function handleRecorded(detail: JustRecorded) {
    undo.push({
      id: detail.id,
      message: `방금 기록됨: ${detail.summary}`,
      expiresAt: new Date(detail.createdAt).getTime() + EDIT_WINDOW_MS,
      onUndo: () => deleteSettlement(detail.id),
    });
  }

  return (
    <div className="space-y-6">
      <UndoStack entries={undo.entries} onRemove={undo.remove} />

      <Card>
        <SectionTitle>정리된 채권-채무 관계 ({transactions.length}건)</SectionTitle>
        {transactions.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="정산할 내역이 없습니다. 모두 정산 완료 상태입니다." />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 mt-4">
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
      </Card>

      <Card>
        <SectionTitle description="위 카드에 제안된 조합과 다르게 실제로 갚았을 때(예: 다른 사람이 대신 내줬을 때) 자유롭게 기록합니다. 실제 정산과 계산 방식은 완전히 같습니다 — 굳이 누구 대신인지를 남기지 않아도, 다음에 이 화면을 열면 정리된 채권-채무 관계가 알아서 새로 계산되어 반영됩니다.">
          변제
        </SectionTitle>
        <div className="mt-4">
          <RepaymentForm participants={participants} onRecorded={handleRecorded} />
        </div>
      </Card>

      <Card>
        <SectionTitle description="계산된 채권-채무 관계와 무관하게, 누구든 원하는 상대에게 원하는 금액을 자유롭게 기부로 기록할 수 있습니다. 기부하는 사람의 잔액은 그만큼 줄고, 받는 사람의 잔액은 그만큼 늡니다.">
          기부 기록
        </SectionTitle>
        <div className="mt-4">
          <DonationForm participants={participants} onRecorded={handleRecorded} />
        </div>
      </Card>
    </div>
  );
}

function WarningBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-red-500/10 border border-red-800 text-red-300 text-xs px-3 py-2 font-medium">
      <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
      {children}
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
          createdAt,
        });
        setStep("idle");
        setAmountText("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "기록에 실패했습니다.");
      }
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface-raised p-4 space-y-3">
      <div className="flex items-center justify-center gap-2 text-sm tabular-nums">
        <span className="font-semibold text-lose truncate">{fromName}</span>
        <span className="text-content-faint" aria-hidden>
          →
        </span>
        <span className="font-semibold text-emerald-400 truncate">{toName}</span>
        <span className="ml-auto rounded-full bg-slate-700 text-content text-xs font-semibold px-2.5 py-1 whitespace-nowrap">
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
              className="w-20 rounded-lg border border-slate-700 px-2 py-1 text-sm bg-surface text-content tabular-nums"
            />
            <Button
              variant="neutral"
              size="sm"
              onClick={() => setAmountText(String(fullAmount))}
              className="whitespace-nowrap"
            >
              전액 ({fullAmount}점)
            </Button>
            <Button variant="primary" size="sm" onClick={goToConfirm} className="ml-auto">
              다음
            </Button>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-content tabular-nums">
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
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={handleConfirm} disabled={isSaving} pending={isSaving} pendingText="기록 중...">
              확인 및 기록
            </Button>
            <Button variant="neutral" size="sm" onClick={() => setStep("idle")} disabled={isSaving}>
              취소
            </Button>
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
          createdAt,
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
        <p className="text-sm text-content tabular-nums">
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
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSaving}
            className="min-h-11 rounded-lg bg-amber-600 text-white text-sm font-medium px-4 transition active:scale-[0.97] hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50 disabled:pointer-events-none"
          >
            {isSaving ? "기록 중..." : "확인 및 기부 기록"}
          </button>
          <Button variant="neutral" onClick={() => setStep("idle")} disabled={isSaving}>
            취소
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-content-muted mb-1">주는 사람</label>
          <select
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
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
          <label className="block text-xs text-content-muted mb-1">받는 사람</label>
          <select
            value={toId}
            onChange={(e) => setToId(e.target.value)}
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
          <label className="block text-xs text-content-muted mb-1">금액</label>
          <input
            type="number"
            min={1}
            step={1}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            placeholder="금액"
            className="bg-surface w-20 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-content tabular-nums"
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs text-content-muted mb-1">메모 (선택)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예: 그냥 기분이라서"
            className="bg-surface w-full rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-content"
          />
        </div>
        <button
          type="button"
          onClick={goToConfirm}
          className="min-h-11 rounded-lg bg-amber-600 text-white text-sm font-medium px-4 transition active:scale-[0.97] hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          다음
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
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
          createdAt,
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
        <p className="text-sm text-content tabular-nums">
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
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="flex gap-2">
          <Button variant="primary" onClick={handleConfirm} disabled={isSaving} pending={isSaving} pendingText="기록 중...">
            확인 및 변제 기록
          </Button>
          <Button variant="neutral" onClick={() => setStep("idle")} disabled={isSaving}>
            취소
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-content-muted mb-1">갚은 사람</label>
          <select
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
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
          <label className="block text-xs text-content-muted mb-1">받은 사람</label>
          <select
            value={toId}
            onChange={(e) => setToId(e.target.value)}
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
          <label className="block text-xs text-content-muted mb-1">금액</label>
          <input
            type="number"
            min={1}
            step={1}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            placeholder="금액"
            className="bg-surface w-20 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-content tabular-nums"
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs text-content-muted mb-1">메모 (선택)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예: 창민이 대신 현금으로 지불"
            className="bg-surface w-full rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-content"
          />
        </div>
        <Button variant="primary" onClick={goToConfirm}>
          다음
        </Button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
