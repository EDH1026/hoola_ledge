"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  TouchSensor,
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

function todayIso() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function nowHm() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function Chip({ participant }: { participant: ParticipantLite }) {
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
      className={`select-none cursor-grab active:cursor-grabbing rounded-xl border px-4 py-3 text-sm font-medium text-center transition
        ${isDragging ? "opacity-40" : ""}
        ${
          isOver
            ? "border-emerald-500 bg-emerald-50 scale-105"
            : "border-slate-200 bg-slate-50 hover:bg-slate-100"
        }
      `}
    >
      {participant.name}
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
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState(nowHm());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSaving, startTransition] = useTransition();

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 8 },
    })
  );

  const nameMap = useMemo(
    () => new Map(participants.map((p) => [p.id, p.name])),
    [participants]
  );

  const selectedParticipants = attendeeIds
    .map((id) => participants.find((p) => p.id === id))
    .filter((p): p is ParticipantLite => !!p);

  function toggleAttendee(id: string) {
    setPendingResult(null);
    setSuccessMsg(null);
    setAttendeeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setError(null);
    setSuccessMsg(null);
    setPendingResult({ loserId: String(active.id), winnerId: String(over.id) });
  }

  function handleConfirm() {
    if (!pending) return;
    setError(null);
    startTransition(async () => {
      try {
        await createGame({
          date,
          time,
          gameType,
          attendeeIds,
          winnerId: pending.winnerId,
          loserId: pending.loserId,
          note,
        });
        setSuccessMsg(
          `기록 완료: ${nameMap.get(pending.loserId)} → ${nameMap.get(
            pending.winnerId
          )}에게 1점 (${GAME_TYPE_LABELS[gameType]})`
        );
        setPendingResult(null);
        setNote("");
        setTime(nowHm());
      } catch (e) {
        setError(e instanceof Error ? e.message : "기록에 실패했습니다.");
      }
    });
  }

  return (
    <div className="space-y-6">
      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-3">1. 종목 선택</h2>
        <div className="grid grid-cols-3 gap-2">
          {GAME_TYPES.map((gt) => (
            <button
              key={gt}
              type="button"
              onClick={() => setGameType(gt)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                gameType === gt
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              {GAME_TYPE_LABELS[gt]}
            </button>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-5">
        <h2 className="font-semibold mb-3">
          2. 참가자 선택 ({attendeeIds.length}명)
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {participants.map((p) => {
            const checked = attendeeIds.includes(p.id);
            return (
              <label
                key={p.id}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition ${
                  checked
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={checked}
                  onChange={() => toggleAttendee(p.id)}
                />
                {p.name}
              </label>
            );
          })}
        </div>
        <p className="text-xs text-slate-400 mt-3">
          기본값은 이전 게임 참가자와 동일합니다. 필요하면 체크를 바꿔주세요.
        </p>
      </section>

      {attendeeIds.length >= 2 && (
        <section className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="font-semibold mb-1">3. 결과 입력</h2>
          <p className="text-xs text-slate-400 mb-4">
            Lose를 Win 위로 드래그하세요 (Lose가 Win에게 1점을 지급합니다).
          </p>
          {mounted ? (
            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {selectedParticipants.map((p) => (
                  <Chip key={p.id} participant={p} />
                ))}
              </div>
            </DndContext>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {selectedParticipants.map((p) => (
                <div
                  key={p.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-center text-slate-400"
                >
                  {p.name}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {pending && (
        <section className="bg-white rounded-2xl border-2 border-slate-900 p-5 space-y-4">
          <h2 className="font-semibold">4. 확인 및 기록</h2>
          <p className="text-sm">
            <span className="font-semibold text-red-500">
              {nameMap.get(pending.loserId)}
            </span>
            (Lose) →{" "}
            <span className="font-semibold text-emerald-600">
              {nameMap.get(pending.winnerId)}
            </span>
            (Win)에게{" "}
            <span className="font-semibold">1점</span> 지급 ·{" "}
            <span className="font-semibold">{GAME_TYPE_LABELS[gameType]}</span>
          </p>
          <div className="flex gap-3 flex-wrap">
            <div>
              <label className="block text-xs text-slate-500 mb-1">날짜</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">시간</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs text-slate-500 mb-1">
                메모 (선택)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="예: 재대결"
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleConfirm}
              disabled={isSaving}
              className="rounded-lg bg-slate-900 text-white text-sm font-medium px-4 py-2 hover:bg-slate-800 transition disabled:opacity-50"
            >
              {isSaving ? "기록 중..." : "이 결과로 기록하기"}
            </button>
            <button
              onClick={() => setPendingResult(null)}
              disabled={isSaving}
              className="rounded-lg bg-slate-100 text-slate-600 text-sm font-medium px-4 py-2 hover:bg-slate-200 transition"
            >
              취소
            </button>
          </div>
        </section>
      )}

      {successMsg && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3">
          {successMsg} — 같은 참가자로 다음 게임을 이어서 기록할 수 있습니다.
        </div>
      )}
    </div>
  );
}
