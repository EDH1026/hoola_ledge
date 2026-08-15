"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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

interface ParticipantLite {
  id: string;
  name: string;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-4 h-4 fill-current shrink-0">
      <path d="M13.7 3.3a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0l-3-3a1 1 0 1 1 1.4-1.4L6 9.6l6.3-6.3a1 1 0 0 1 1.4 0Z" />
    </svg>
  );
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
        : "border-slate-800 bg-slate-800 hover:bg-slate-700"
    }
  `;
}

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
      {isTapSelected && (
        <span className="block text-[10px] font-semibold text-red-500 mb-0.5">
          Lose 선택됨 · Win을 탭하세요
        </span>
      )}
      {participant.name}
    </div>
  );
}

function ChipOverlay({ name }: { name: string }) {
  return (
    <div className="select-none rounded-xl border-2 border-slate-100 bg-slate-900 px-4 py-3 text-sm font-medium text-center shadow-lg cursor-grabbing">
      {name}
    </div>
  );
}

export default function NewGameForm({
  participants,
  defaultAttendeeIds,
}: {
  participants: ParticipantLite[];
  defaultAttendeeIds: string[];
}) {
  const validDefaults = defaultAttendeeIds.filter((id) =>
    participants.some((p) => p.id === id)
  );
  const [attendeeIds, setAttendeeIds] = useState<string[]>(
    validDefaults.length >= 2 ? validDefaults : participants.map((p) => p.id)
  );
  const [gameType, setGameType] = useState<GameType>("hoola");
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
        // 기록이 끝나면 곧바로 게임 기록 탭으로 이동해 방금 쓴 게 제대로
        // 반영됐는지 바로 확인할 수 있게 한다 — createGame이 이미
        // revalidatePath("/games")를 호출하므로 이 push는 최신 데이터를
        // 그대로 불러온다. refresh()는 그걸 한 번 더 보장하기 위한 안전장치.
        router.push("/games");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "기록에 실패했습니다.");
      }
    });
  }

  return (
    <div className="space-y-6">
      <section className="bg-slate-900 rounded-2xl border border-slate-800 p-5">
        <h2 className="font-semibold mb-3">1. 종목 선택</h2>
        <div className="grid grid-cols-3 gap-2">
          {GAME_TYPES.map((gt) => {
            const selected = gameType === gt;
            return (
              <button
                key={gt}
                type="button"
                onClick={() => setGameType(gt)}
                className={`flex items-center justify-center gap-1.5 rounded-lg border-2 px-3 py-2 text-sm font-medium transition ${
                  selected
                    ? "border-emerald-600 bg-emerald-500/10 text-emerald-200"
                    : "border-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {selected && <CheckIcon />}
                {GAME_TYPE_LABELS[gt]}
              </button>
            );
          })}
        </div>
      </section>

      <section className="bg-slate-900 rounded-2xl border border-slate-800 p-5">
        <h2 className="font-semibold mb-3">
          2. 참가자 선택 ({attendeeIds.length}명)
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {participants.map((p) => {
            const checked = attendeeIds.includes(p.id);
            return (
              <label
                key={p.id}
                className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm cursor-pointer transition ${
                  checked
                    ? "border-emerald-600 bg-emerald-500/10 text-emerald-200"
                    : "border-slate-800 text-slate-300 hover:bg-slate-700"
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
                      : "border-slate-700 bg-slate-900"
                  }`}
                >
                  {checked && <CheckIcon />}
                </span>
                {p.name}
              </label>
            );
          })}
        </div>
        <p className="text-xs text-slate-500 mt-3">
          기본값은 이전 게임 참가자와 동일합니다. 필요하면 체크를 바꿔주세요.
        </p>
      </section>

      {attendeeIds.length >= 2 && (
        <section className="bg-slate-900 rounded-2xl border border-slate-800 p-5">
          <h2 className="font-semibold mb-1">3. 결과 입력</h2>
          <p className="text-xs text-slate-500 mb-4">
            드래그하거나, Lose → Win 순서로 탭하세요 (Lose가 Win에게 점수를
            지급합니다).
          </p>
          {mounted ? (
            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {selectedParticipants.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-slate-800 bg-slate-800 px-4 py-3 text-sm font-medium text-center text-slate-500"
                >
                  {p.name}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {pending && (
        <section className="bg-slate-900 rounded-2xl border-2 border-slate-100 p-5 space-y-4">
          <h2 className="font-semibold">4. 확인 및 기록</h2>
          <p className="text-sm">
            <span className="font-semibold text-red-500">
              {nameMap.get(pending.loserId)}
            </span>
            (Lose) →{" "}
            <span className="font-semibold text-emerald-400">
              {nameMap.get(pending.winnerId)}
            </span>
            (Win)에게{" "}
            <span className="font-semibold">{points}점</span> 지급 ·{" "}
            <span className="font-semibold">{GAME_TYPE_LABELS[gameType]}</span>
          </p>
          <div className="flex gap-3 flex-wrap items-end">
            <div>
              <label className="block text-xs text-slate-400 mb-1">점수</label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPoints((p) => Math.max(1, p - 1))}
                  className="w-8 h-8 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-700 flex items-center justify-center"
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
                  className="bg-slate-900 w-14 rounded-lg border border-slate-700 px-2 py-1.5 text-sm text-center"
                />
                <button
                  type="button"
                  onClick={() => setPoints((p) => p + 1)}
                  className="w-8 h-8 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-700 flex items-center justify-center"
                  aria-label="점수 증가"
                >
                  +
                </button>
              </div>
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs text-slate-400 mb-1">
                메모 (선택)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="예: 재대결"
                className="bg-slate-900 w-full rounded-lg border border-slate-700 px-3 py-1.5 text-sm"
              />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            날짜·시간은 기록하는 지금 이 순간으로 자동 저장됩니다.
          </p>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={isSaving}
              className="rounded-lg bg-slate-100 text-slate-900 text-sm font-medium px-4 py-2 hover:bg-slate-300 transition disabled:opacity-50"
            >
              {isSaving ? "기록 중..." : "이 결과로 기록하기"}
            </button>
            <button
              onClick={() => setPendingResult(null)}
              disabled={isSaving}
              className="rounded-lg bg-slate-800 text-slate-300 text-sm font-medium px-4 py-2 hover:bg-slate-600 transition"
            >
              취소
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
