"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { createGame } from "@/lib/actions";
import { GAME_TYPE_LABELS, GAME_TYPES, GameType } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Button } from "@/components/ui/Button";

interface ParticipantLite {
  id: string;
  name: string;
}

function chipClassName(opts: { isOver?: boolean; isDragging?: boolean; isTapSelected?: boolean }) {
  const { isOver, isDragging, isTapSelected } = opts;
  return `select-none touch-none cursor-grab active:cursor-grabbing rounded-xl border-2 px-4 py-3 text-sm font-medium text-center transition
    ${isDragging ? "opacity-40" : ""}
    ${
      isOver
        ? "border-emerald-500 bg-emerald-500/10 scale-105"
        : isTapSelected
        ? "border-red-500 bg-red-500/10 text-red-300"
        : "border-line bg-surface-raised text-content hover:bg-slate-700"
    }
  `;
}

// v2.19 (배치 B, PRD §24.9) — the "Lose 선택됨" subtitle used to render
// *inside* this chip, which changed its height on selection and reflowed the
// whole grid out from under the next tap. The selection state now shows only
// via border/background color (already handled by chipClassName), and the
// subtitle moved to the section header (see NewGameForm's `resultDescription`)
// where it can't move anything else.
function Chip({
  participant,
  isTapSelected,
  onTap,
}: {
  participant: ParticipantLite;
  isTapSelected: boolean;
  onTap: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } =
    useDraggable({ id: participant.id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: participant.id,
  });

  const setRefs = (el: HTMLElement | null) => {
    setDragRef(el);
    setDropRef(el);
  };

  return (
    <div
      ref={setRefs}
      {...listeners}
      {...attributes}
      onClick={() => onTap(participant.id)}
      className={chipClassName({ isOver, isDragging, isTapSelected })}
    >
      {participant.name}
    </div>
  );
}

function ChipOverlay({ name }: { name: string }) {
  return (
    <div className="select-none rounded-xl border-2 border-line bg-surface px-4 py-3 text-sm font-medium text-center text-content shadow-lg cursor-grabbing">
      {name}
    </div>
  );
}

export default function NewGameForm({
  participants,
  defaultAttendeeIds,
  defaultGameType,
}: {
  participants: ParticipantLite[];
  defaultAttendeeIds: string[];
  defaultGameType: GameType;
}) {
  const validDefaults = defaultAttendeeIds.filter((id) =>
    participants.some((p) => p.id === id)
  );
  const [attendeeIds, setAttendeeIds] = useState<string[]>(
    validDefaults.length >= 2 ? validDefaults : participants.map((p) => p.id)
  );
  const [gameType, setGameType] = useState<GameType>(defaultGameType);
  const [pending, setPendingResult] = useState<{
    winnerId: string;
    loserId: string;
  } | null>(null);
  const [points, setPoints] = useState(1);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startTransition] = useTransition();
  const router = useRouter();

  // dnd-kit assigns internal accessibility ids (aria-describedby) via a
  // module-level counter that isn't guaranteed to match between the server
  // render and the client's first render, which trips a harmless-but-noisy
  // hydration warning. Rendering the drag surface only after mount sidesteps
  // it entirely (drag-and-drop needs JS anyway, so there's nothing lost by
  // not server-rendering it).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Intentional one-time client-mount flag to avoid an SSR/hydration
    // mismatch (dnd-kit assigns internal ids that can differ between the
    // server and client's first render) — not syncing to an external system.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  // A single PointerSensor covers mouse, touch, and pen (it listens on the
  // unified Pointer Events API) — registering TouchSensor alongside it (the
  // previous setup) makes both sensors race to claim the same touchstart,
  // which is exactly what broke dragging on phones. PointerSensor alone is
  // dnd-kit's own recommended combination for "just make it work on touch".
  // The other half of the touch fix is CSS: without `touch-action: none` on
  // the draggable element (applied below via the `touch-none` Tailwind
  // class), the browser's native scroll/pan gesture recognizer intercepts
  // the touch before dnd-kit's JS ever sees pointermove events.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  // Tap-to-select fallback (Lose then Win) for when drag doesn't work or
  // isn't practical — same activation distance means a plain tap (no
  // movement) never triggers dnd-kit's drag, so click and drag coexist.
  const [tapSelectedId, setTapSelectedId] = useState<string | null>(null);
  const justDraggedRef = useRef(false);

  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const nameMap = useMemo(
    () => new Map(participants.map((p) => [p.id, p.name])),
    [participants]
  );

  const selectedParticipants = attendeeIds
    .map((id) => participants.find((p) => p.id === id))
    .filter((p): p is ParticipantLite => !!p);

  function toggleAttendee(id: string) {
    setPendingResult(null);
    setTapSelectedId(null);
    setAttendeeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  // A completed drag fires its own synthetic click right after pointerup on
  // some browsers/touch devices; `justDraggedRef` suppresses exactly that one
  // click so a finished drag doesn't also register as "first tap of a new
  // selection". It self-clears on a short timeout rather than waiting for a
  // click to consume it — otherwise, on a browser/device that never fires
  // that trailing click, the flag would stay stuck true and silently eat the
  // user's next *unrelated* real tap, possibly much later.
  function armJustDraggedGuard() {
    justDraggedRef.current = true;
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 300);
  }

  function handleDragStart(event: DragStartEvent) {
    armJustDraggedGuard();
    setActiveDragId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setError(null);
    setTapSelectedId(null);
    setPendingResult({ loserId: String(active.id), winnerId: String(over.id) });
  }

  function handleDragCancel() {
    setActiveDragId(null);
  }

  function handleTap(id: string) {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    setError(null);
    if (tapSelectedId === null) {
      setTapSelectedId(id);
      return;
    }
    if (tapSelectedId === id) {
      setTapSelectedId(null);
      return;
    }
    setPendingResult({ loserId: tapSelectedId, winnerId: id });
    setTapSelectedId(null);
  }

  function handleConfirm() {
    if (!pending) return;
    setError(null);
    startTransition(async () => {
      try {
        await createGame({
          gameType,
          attendeeIds,
          winnerId: pending.winnerId,
          loserId: pending.loserId,
          points,
          note,
        });

        // 기존 동작(PRD §18.4) 유지: 곧바로 게임 기록 탭으로 이동해 방금
        // 쓴 게 제대로 반영됐는지 바로 확인할 수 있게 한다. createGame이
        // 이미 revalidatePath("/games")를 호출하므로 이 push는 최신
        // 데이터를 그대로 불러온다. refresh()는 그걸 한 번 더 보장하기
        // 위한 안전장치.
        router.push("/games");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "기록에 실패했습니다.");
      }
    });
  }

  const resultDescription = tapSelectedId
    ? `${nameMap.get(tapSelectedId)} 선택됨 (Lose) · Win 상대를 탭하세요`
    : "드래그하거나, Lose → Win 순서로 탭하세요 (Lose가 Win에게 배출권을 넘깁니다).";

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle>1. 종목 선택</SectionTitle>
        <div className="grid grid-cols-3 gap-2 mt-3">
          {GAME_TYPES.map((gt) => {
            const selected = gameType === gt;
            return (
              <button
                key={gt}
                type="button"
                onClick={() => setGameType(gt)}
                className={`flex items-center justify-center gap-1 rounded-lg border-2 px-2 py-2.5 text-xs sm:text-sm font-medium transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                  selected
                    ? "border-emerald-600 bg-emerald-500/10 text-emerald-200"
                    : "border-line text-content-sub hover:bg-slate-700"
                }`}
              >
                {/* 아이콘 자리를 항상 확보 — 선택 시에만 나타나면 그만큼
                    버튼 폭이 바뀌어 그리드가 재배치된다(PRD §24.9). */}
                <Check
                  className={`w-3.5 h-3.5 shrink-0 ${selected ? "" : "opacity-0"}`}
                  aria-hidden
                />
                {GAME_TYPE_LABELS[gt]}
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <SectionTitle>2. 참가자 선택 ({attendeeIds.length}명)</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
          {participants.map((p) => {
            const checked = attendeeIds.includes(p.id);
            return (
              <label
                key={p.id}
                className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm cursor-pointer transition ${
                  checked
                    ? "border-emerald-600 bg-emerald-500/10 text-emerald-200"
                    : "border-line text-content-sub hover:bg-slate-700"
                }`}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={checked}
                  onChange={() => toggleAttendee(p.id)}
                />
                <span
                  className={`flex items-center justify-center w-4 h-4 rounded-full border shrink-0 ${
                    checked
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-slate-700 bg-surface"
                  }`}
                >
                  {checked && <Check className="w-4 h-4 shrink-0" />}
                </span>
                {p.name}
              </label>
            );
          })}
        </div>
        <p className="text-xs text-content-muted mt-3">
          기본값은 이전 게임 참가자와 동일합니다. 필요하면 체크를 바꿔주세요.
        </p>
      </Card>

      {attendeeIds.length >= 2 && (
        <Card>
          <SectionTitle description={resultDescription}>3. 결과 입력</SectionTitle>
          {mounted ? (
            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
                {selectedParticipants.map((p) => (
                  <Chip
                    key={p.id}
                    participant={p}
                    isTapSelected={tapSelectedId === p.id}
                    onTap={handleTap}
                  />
                ))}
              </div>
              <DragOverlay>
                {activeDragId ? (
                  <ChipOverlay name={nameMap.get(activeDragId) ?? ""} />
                ) : null}
              </DragOverlay>
            </DndContext>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
              {selectedParticipants.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm font-medium text-center text-content-muted"
                >
                  {p.name}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {pending && (
        <div className="rounded-2xl bg-surface border border-accent p-4 sm:p-5 space-y-4">
          <SectionTitle>4. 확인 및 기록</SectionTitle>
          <p className="text-sm text-content tabular-nums">
            <span className="font-semibold text-lose">
              {nameMap.get(pending.loserId)}
            </span>
            (Lose) →{" "}
            <span className="font-semibold text-emerald-400">
              {nameMap.get(pending.winnerId)}
            </span>
            (Win)에게{" "}
            <span className="font-semibold">{points}점</span> 이전 ·{" "}
            <span className="font-semibold">{GAME_TYPE_LABELS[gameType]}</span>
          </p>
          <div className="flex gap-3 flex-wrap items-end">
            <div>
              <label className="block text-xs text-content-muted mb-1">점수</label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPoints((p) => Math.max(1, p - 1))}
                  className="w-11 h-11 rounded-lg border border-slate-700 text-content-sub hover:bg-slate-700 flex items-center justify-center transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  aria-label="점수 감소"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={points}
                  onChange={(e) =>
                    setPoints(Math.max(1, Math.round(Number(e.target.value) || 1)))
                  }
                  className="w-14 h-11 rounded-lg border border-slate-700 bg-surface px-2 text-sm text-center text-content tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => setPoints((p) => p + 1)}
                  className="w-11 h-11 rounded-lg border border-slate-700 text-content-sub hover:bg-slate-700 flex items-center justify-center transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  aria-label="점수 증가"
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs text-content-muted mb-1">
                메모 (선택)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="예: 재대결"
                className="bg-surface w-full rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-content"
              />
            </div>
          </div>
          <p className="text-xs text-content-muted">
            날짜·시간은 기록하는 지금 이 순간으로 자동 저장됩니다.
          </p>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="primary"
              onClick={handleConfirm}
              disabled={isSaving}
              pending={isSaving}
              pendingText="기록 중..."
            >
              기록하고 목록으로
            </Button>
            <Button variant="ghost" onClick={() => setPendingResult(null)} disabled={isSaving}>
              취소
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
