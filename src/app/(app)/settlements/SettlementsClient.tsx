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
        <SectionTitle>정리된 이전 계획 ({transactions.length}건)</SectionTitle>
        {transactions.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="넘길 배출권이 없습니다. 모두 이전 완료 상태입니다." />
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
        {/* v2.19 (배치 C, PRD §24.13) — 이 폼도 결국 type: "payment"로
            저장되어 이력에는 같은 라벨로 뜬다. 예전엔 이 섹션 제목이
            "변제"였는데, 방금 이 폼으로 기록한 사람이 아래 이력에서
            다른 이름표를 보게 되는 어긋남이 있었다. 제목을 이력의
            표기와 맞춘다. v2.23 — 라벨이 "배출권 이전"으로 바뀌었다
            (PRD §32.2). */}
        <SectionTitle description="위 카드에 제안된 조합과 다르게 실제로 넘겼을 때(예: 다른 사람이 대신 넘겨줬을 때) 자유롭게 기록하는 배출권 이전입니다. 계산 방식은 완전히 같습니다 — 굳이 누구 대신인지를 남기지 않아도, 다음에 이 화면을 열면 정리된 이전 계획이 알아서 새로 계산되어 반영됩니다.">
          배출권 이전 (직접 입력)
        </SectionTitle>
        <div className="mt-4">
          <FreeformSettlementForm
            participants={participants}
            onRecorded={handleRecorded}
            type="payment"
            fromLabel="넘긴 사람"
            toLabel="받은 사람"
            recordingLabel="배출권 이전"
            notePlaceholder="예: 창민이 대신 넘겨줌"
            mismatchError="넘긴 사람과 받은 사람이 같을 수 없습니다."
          />
        </div>
      </Card>

      <Card>
        <SectionTitle description="계산된 배출권 이전 관계와 무관하게, 누구든 원하는 상대의 배출권 부담을 원하는 수량만큼 면죄부로 덜어줄 수 있습니다. 면죄부를 발행하면 발행한 사람의 보유량이 그만큼 줄고, 받는 사람의 보유량이 그만큼 늡니다.">
          면죄부 발행
        </SectionTitle>
        <div className="mt-4">
          <FreeformSettlementForm
            participants={participants}
            onRecorded={handleRecorded}
            type="donation"
            fromLabel="사면하는 사람"
            toLabel="사면받는 사람"
            recordingLabel="면죄부"
            notePlaceholder="예: 딱해 보여서"
            mismatchError="사면하는 사람과 사면받는 사람이 같을 수 없습니다."
          />
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
          summary: `${fromName} → ${toName} ${amount}점 (배출권 이전)`,
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
      {/* v2.19 (배치 C, PRD §24.13) — 이름에 색을 주던 걸 중립으로 바꾸고
          (settlements/page.tsx의 "숫자에 부호·색, 이름은 중립" 규칙과
          통일), justify-center+ml-auto가 섞여 있던 배치를 justify-between
          하나로 정리했다. truncate가 동작하지 않던 것도 같이 고쳤다 —
          flex 자식에 min-w-0이 없으면 truncate가 발동하지 않는다. */}
      <div className="flex items-center justify-between gap-2 text-sm tabular-nums">
        <span className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-content truncate">{fromName}</span>
          <span className="text-content-faint shrink-0" aria-hidden>
            →
          </span>
          <span className="font-semibold text-content truncate">{toName}</span>
        </span>
        <span className="shrink-0 rounded-full bg-slate-700 text-content text-xs font-semibold px-2.5 py-1 whitespace-nowrap">
          {fullAmount}점
        </span>
      </div>

      {step === "idle" ? (
        <div className="space-y-2">
          {/* v2.19 (배치 C, PRD §24.13) — flex-wrap 없이 세 요소가 한 줄에
              들어 있어서 fullAmount가 3~4자리가 되면 카드 폭을 넘쳤다. */}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="number"
              min={1}
              max={fullAmount}
              step={1}
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="수량"
              className="w-20 rounded-lg border border-slate-700 px-2 py-1 text-sm bg-surface text-content tabular-nums"
            />
            <Button
              variant="neutral"
              size="sm"
              onClick={() => setAmountText(String(fullAmount))}
              className="whitespace-nowrap"
            >
              전량 ({fullAmount}점)
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
            <span className="font-semibold">{amount}점</span>을 배출권 이전으로
            기록합니다.
          </p>
          {isLarge && (
            <WarningBanner>
              {isFull
                ? "이 이전의 전량을 처리합니다."
                : `${LARGE_AMOUNT_THRESHOLD}점 이상의 큰 수량입니다.`}{" "}
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

// v2.19 (배치 C, PRD §24.13) — RepaymentForm과 DonationForm은 라벨·에러
// 문구·버튼 색만 다른 ~160줄짜리 쌍둥이였다. 하나로 합치고 차이는 props로
// 받는다. 확인 단계도 이번에 같이 고쳤다: 예전엔 early return으로 폼
// 전체가 언마운트돼서 확인 화면에서 오타를 봐도 뒤로 가야 값을 고칠 수
// 있었다 — 이제 같은 입력 필드를 읽기 전용으로 그대로 보여준다(값이
// "사라지지" 않는다).
function FreeformSettlementForm({
  participants,
  onRecorded,
  type,
  fromLabel,
  toLabel,
  recordingLabel,
  notePlaceholder,
  mismatchError,
}: {
  participants: ParticipantLite[];
  onRecorded: (detail: JustRecorded) => void;
  type: WritableSettlementType;
  fromLabel: string;
  toLabel: string;
  recordingLabel: string;
  notePlaceholder: string;
  mismatchError: string;
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
  const isDonation = type === "donation";

  function goToConfirm() {
    setError(null);
    if (fromId === toId) {
      setError(mismatchError);
      return;
    }
    if (!amountValid) {
      setError("1 이상의 정수 수량을 입력해 주세요.");
      return;
    }
    setStep("confirm");
  }

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      try {
        const { id, createdAt } = await recordSettlement({ fromId, toId, amount, type, note });
        onRecorded({
          id,
          summary: `${nameMap.get(fromId)} → ${nameMap.get(toId)} ${amount}점 (${recordingLabel})`,
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

  const confirming = step === "confirm";

  return (
    <div className="space-y-2">
      {confirming && (
        <p className="text-sm text-content tabular-nums">
          <span className="font-semibold">{nameMap.get(fromId)}</span>가{" "}
          <span className="font-semibold">{nameMap.get(toId)}</span>에게{" "}
          <span className="font-semibold">{amount}점</span>을 {recordingLabel}으로
          기록합니다. 아래 값을 확인해 주세요.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-content-muted mb-1">{fromLabel}</label>
          <select
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
            disabled={confirming}
            className="bg-surface rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-content min-w-[120px] disabled:opacity-70"
          >
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-content-muted mb-1">{toLabel}</label>
          <select
            value={toId}
            onChange={(e) => setToId(e.target.value)}
            disabled={confirming}
            className="bg-surface rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-content min-w-[120px] disabled:opacity-70"
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
            min={1}
            step={1}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            disabled={confirming}
            placeholder="수량"
            className="bg-surface w-20 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-content tabular-nums disabled:opacity-70"
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs text-content-muted mb-1">메모 (선택)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={confirming}
            placeholder={notePlaceholder}
            className="bg-surface w-full rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-content disabled:opacity-70"
          />
        </div>
        {!confirming &&
          (isDonation ? (
            <button
              type="button"
              onClick={goToConfirm}
              className="min-h-11 rounded-lg bg-amber-600 text-white text-sm font-medium px-4 transition active:scale-[0.97] hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              다음
            </button>
          ) : (
            <Button variant="primary" onClick={goToConfirm}>
              다음
            </Button>
          ))}
      </div>

      {confirming && (
        <>
          {isLarge && (
            <WarningBanner>
              {LARGE_AMOUNT_THRESHOLD}점 이상의 큰 수량입니다. 한 번 더 확인해
              주세요.
            </WarningBanner>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            {isDonation ? (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isSaving}
                className="min-h-11 rounded-lg bg-amber-600 text-white text-sm font-medium px-4 transition active:scale-[0.97] hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50 disabled:pointer-events-none"
              >
                {isSaving ? "기록 중..." : `확인 및 ${recordingLabel} 기록`}
              </button>
            ) : (
              <Button
                variant="primary"
                onClick={handleConfirm}
                disabled={isSaving}
                pending={isSaving}
                pendingText="기록 중..."
              >
                확인 및 {recordingLabel} 기록
              </Button>
            )}
            <Button variant="neutral" onClick={() => setStep("idle")} disabled={isSaving}>
              취소
            </Button>
          </div>
        </>
      )}
      {!confirming && error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
