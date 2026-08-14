"use client";

import { useMemo, useState, useTransition } from "react";
import { format } from "date-fns";
import { deleteGame, hardDeleteGame, updateGame } from "@/lib/actions";
import { isActiveGame, withinDayKey } from "@/lib/games";
import { todayInSeoul, isWithinEditWindow } from "@/lib/time";
import {
  GAME_TYPE_LABELS,
  GAME_TYPES,
  GameResult,
  GameType,
} from "@/lib/types";
import { GameTypeBadge, InactiveBadge } from "@/components/badges";
import { computeParticipantPointTotals } from "@/lib/stats";

interface ParticipantLite {
  id: string;
  name: string;
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

function gameTypeLabel(gt?: GameType): string {
  return gt ? GAME_TYPE_LABELS[gt] : "종목 미지정";
}

export default function GamesListClient({
  games,
  participants,
  sequenceNumbers,
  isAdmin,
}: {
  games: GameResult[];
  participants: ParticipantLite[];
  sequenceNumbers: Record<string, number>;
  isAdmin: boolean;
}) {
  const nameMap = useMemo(
    () => new Map(participants.map((p) => [p.id, p.name])),
    [participants]
  );

  // Defaults the filter to today (Asia/Seoul) rather than "전체" — this
  // screen is mainly used right after a game night, so showing today's
  // games first matches how it's actually used. Unpadded via String(Number())
  // to match the comparison the filter below already does against `month`/
  // `day` ("08" would never equal "8" otherwise).
  const today = todayInSeoul();
  const todayYear = today.slice(0, 4);
  const todayMonth = String(Number(today.slice(5, 7)));
  const todayDay = String(Number(today.slice(8, 10)));

  const years = useMemo(() => {
    const set = new Set(games.map((g) => g.date.slice(0, 4)));
    set.add(todayYear); // so today's year is always a valid, selected option even with no games yet
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [games, todayYear]);

  const [year, setYear] = useState(todayYear);
  const [month, setMonth] = useState(todayMonth);
  const [day, setDay] = useState(todayDay);
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmHardDeleteId, setConfirmHardDeleteId] = useState<string | null>(null);
  const [isHardDeleting, startHardDeleteTransition] = useTransition();

  const filtered = useMemo(() => {
    return games
      .filter((g) => {
        const [y, m, d] = g.date.split("-");
        if (year !== "all" && y !== year) return false;
        if (month !== "all" && String(Number(m)) !== month) return false;
        if (day !== "all" && String(Number(d)) !== day) return false;
        return true;
      })
      .sort((a, b) =>
        b.date === a.date
          ? withinDayKey(b).localeCompare(withinDayKey(a))
          : b.date.localeCompare(a.date)
      );
  }, [games, year, month, day]);

  // `games` includes soft-deleted rows for admins (so they can be viewed and
  // reactivated), but balances/stats must never count them — same contract
  // activeGames() documents for every other consumer of the games table.
  const activeFiltered = useMemo(() => filtered.filter(isActiveGame), [filtered]);
  const inactiveCount = filtered.length - activeFiltered.length;

  const pointsSum = activeFiltered.reduce((sum, g) => sum + (g.points ?? 1), 0);
  const pointTotals = useMemo(
    () => computeParticipantPointTotals(participants, activeFiltered),
    [participants, activeFiltered]
  );

  function handleDelete(id: string) {
    setDeletingId(id);
    setDeleteError(null);
    startTransition(async () => {
      try {
        await deleteGame(id);
      } catch (e) {
        setDeleteError({
          id,
          message: e instanceof Error ? e.message : "삭제에 실패했습니다.",
        });
      }
      setDeletingId(null);
    });
  }

  function handleHardDelete(id: string) {
    startHardDeleteTransition(async () => {
      await hardDeleteGame(id);
      setConfirmHardDeleteId(null);
    });
  }

  return (
    <div className="space-y-4">
      <section className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className="text-xs text-slate-400 block mb-1">연도</span>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="all">전체</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="text-xs text-slate-400 block mb-1">월</span>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="all">전체</option>
              {MONTHS.map((m) => (
                <option key={m} value={String(m)}>
                  {m}월
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="text-xs text-slate-400 block mb-1">일</span>
            <select
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="all">전체</option>
              {DAYS.map((d) => (
                <option key={d} value={String(d)}>
                  {d}일
                </option>
              ))}
            </select>
          </div>
          <div className="ml-auto text-sm text-slate-500 text-right">
            {activeFiltered.length}회 · 점수 합계{" "}
            <span className="font-semibold text-slate-900">{pointsSum}점</span>
            {isAdmin && inactiveCount > 0 && (
              <span className="block text-xs text-slate-400 mt-0.5">
                (비활성 {inactiveCount}건은 집계에서 제외 · 목록에는 표시됨)
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 p-4">
        <h2 className="text-sm font-semibold mb-3">이 구간 인별 점수</h2>
        {pointTotals.length === 0 ? (
          <p className="text-sm text-slate-400">
            이 구간에 집계할 게임이 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-xs">
                  <th className="py-1.5 pr-4">순위</th>
                  <th className="py-1.5 pr-4">이름</th>
                  <th className="py-1.5 pr-4">딴 점수</th>
                  <th className="py-1.5 pr-4">잃은 점수</th>
                  <th className="py-1.5 pr-4">순점수</th>
                </tr>
              </thead>
              <tbody>
                {pointTotals.map((p, i) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-4 text-slate-400">{i + 1}</td>
                    <td className="py-1.5 pr-4 font-medium">{p.name}</td>
                    <td className="py-1.5 pr-4 text-emerald-600">{p.pointsWon}</td>
                    <td className="py-1.5 pr-4 text-red-500">{p.pointsLost}</td>
                    <td
                      className={`py-1.5 pr-4 font-semibold ${
                        p.netPoints > 0
                          ? "text-emerald-600"
                          : p.netPoints < 0
                          ? "text-red-500"
                          : "text-slate-400"
                      }`}
                    >
                      {p.netPoints > 0 ? "+" : ""}
                      {p.netPoints}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-400 p-5">
            조건에 맞는 게임 기록이 없습니다.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((g) => {
              const seq = sequenceNumbers[g.id];
              const attendeeNames = g.attendeeIds.map(
                (id) => nameMap.get(id) ?? "(삭제됨)"
              );
              const points = g.points ?? 1;
              const inactive = g.active === false;
              const isEditing = editingId === g.id;
              // Non-admins only ever see active games (games/page.tsx keeps
              // soft-deleted rows admin-only), so `!inactive` is already
              // guaranteed there — it's included explicitly anyway so this
              // stays correct if that upstream contract ever changes.
              const editableByUser = isWithinEditWindow(g.createdAt);
              const canEdit = isAdmin || (!inactive && editableByUser);
              const canDelete = !inactive && (isAdmin || editableByUser);
              return (
                <li key={g.id} className={`p-4 space-y-2 ${inactive ? "bg-slate-50" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-slate-400 whitespace-nowrap">
                        {format(new Date(g.date), "yyyy-MM-dd")}
                        {g.time ? ` ${g.time}` : ""}
                        {seq ? ` · ${seq}차전` : ""}
                      </span>
                      <GameTypeBadge gameType={g.gameType} />
                      {inactive && <InactiveBadge />}
                    </div>
                    <div className="flex items-center gap-3">
                      {isAdmin && confirmHardDeleteId === g.id ? (
                        <span className="flex items-center gap-2 text-xs">
                          <span className="text-red-700 font-medium">
                            완전 삭제할까요? 되돌릴 수 없습니다.
                          </span>
                          <button
                            type="button"
                            onClick={() => handleHardDelete(g.id)}
                            disabled={isHardDeleting}
                            className="text-red-700 font-semibold hover:underline disabled:opacity-50"
                          >
                            {isHardDeleting ? "삭제 중..." : "확인"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmHardDeleteId(null)}
                            disabled={isHardDeleting}
                            className="text-slate-400 hover:text-slate-700"
                          >
                            취소
                          </button>
                        </span>
                      ) : (
                        <>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => setEditingId(isEditing ? null : g.id)}
                              className="text-xs font-medium text-slate-500 hover:text-slate-900"
                            >
                              {isEditing ? "닫기" : "수정"}
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => handleDelete(g.id)}
                              disabled={isPending && deletingId === g.id}
                              className="text-xs text-slate-300 hover:text-red-600 disabled:opacity-50"
                            >
                              {isPending && deletingId === g.id ? "삭제 중..." : "삭제"}
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => setConfirmHardDeleteId(g.id)}
                              className="text-xs text-slate-300 hover:text-red-700"
                            >
                              완전삭제
                            </button>
                          )}
                          {!canEdit && !canDelete && (
                            <span className="text-xs text-slate-300">
                              기록 후 2시간이 지나 수정·삭제할 수 없습니다.
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {deleteError?.id === g.id && (
                    <p className="text-xs text-red-600">{deleteError.message}</p>
                  )}
                  <div className={`text-sm ${inactive ? "opacity-60" : ""}`}>
                    <span className="font-semibold text-emerald-600">
                      {nameMap.get(g.winnerId) ?? "(삭제됨)"}
                    </span>
                    <span className="text-slate-400 mx-1.5">Win · Lose</span>
                    <span className="font-semibold text-red-500">
                      {nameMap.get(g.loserId) ?? "(삭제됨)"}
                    </span>
                    <span className="text-xs text-slate-400 ml-2">
                      · {points}점
                    </span>
                    {g.note && (
                      <span className="text-xs text-slate-400 ml-2">
                        · {g.note}
                      </span>
                    )}
                  </div>
                  <p className={`text-xs ${inactive ? "text-slate-300" : "text-slate-400"}`}>
                    참석 {g.attendeeIds.length}명 · {attendeeNames.join(", ")}
                  </p>

                  {isEditing && (
                    <GameEditForm
                      key={g.id}
                      game={g}
                      participants={participants}
                      nameMap={nameMap}
                      isAdmin={isAdmin}
                      onCancel={() => setEditingId(null)}
                      onSaved={() => setEditingId(null)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function DiffRow({
  label,
  before,
  after,
}: {
  label: string;
  before: string;
  after: string;
}) {
  const changed = before !== after;
  return (
    <div className="text-sm flex flex-wrap gap-x-2">
      <span className="text-slate-400 w-16 shrink-0">{label}</span>
      {changed ? (
        <span>
          <span className="text-slate-400 line-through decoration-slate-300">
            {before}
          </span>
          <span className="text-slate-400 mx-1.5">→</span>
          <span className="font-semibold text-slate-900">{after}</span>
        </span>
      ) : (
        <span className="text-slate-600">{before}</span>
      )}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="w-4 h-4 fill-current shrink-0">
      <path d="M13.7 3.3a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0l-3-3a1 1 0 1 1 1.4-1.4L6 9.6l6.3-6.3a1 1 0 0 1 1.4 0Z" />
    </svg>
  );
}

// Reuses NewGameForm's gameType-buttons / attendee-checkbox / points-stepper
// UI patterns for visual consistency (per PRD 11), but swaps its drag/tap Win
// vs Lose picker for two plain <select>s. Drag-to-assign is built for fast
// one-shot entry of a fresh result; here the admin is correcting an existing
// record, often changing several fields at once, where "pick from a dropdown"
// is easier to get right (and to re-check) than a drag gesture. The confirm
// step below is the mandatory safety net (PRD 9.1.4 / 11.2) — nothing is
// written until the admin reviews a before/after diff and saves explicitly.
function GameEditForm({
  game,
  participants,
  nameMap,
  isAdmin,
  onCancel,
  onSaved,
}: {
  game: GameResult;
  participants: ParticipantLite[];
  nameMap: Map<string, string>;
  isAdmin: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [gameType, setGameType] = useState<GameType>(game.gameType ?? "hoola");
  const [attendeeIds, setAttendeeIds] = useState<string[]>(game.attendeeIds);
  const [winnerId, setWinnerId] = useState(game.winnerId);
  const [loserId, setLoserId] = useState(game.loserId);
  const [points, setPoints] = useState(game.points ?? 1);
  const [note, setNote] = useState(game.note ?? "");
  const [date, setDate] = useState(game.date);
  const [time, setTime] = useState(game.time ?? "00:00");
  const [active, setActive] = useState(game.active !== false);
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startTransition] = useTransition();

  const selectableAttendees = participants.filter((p) => attendeeIds.includes(p.id));

  function toggleAttendee(id: string) {
    setAttendeeIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      // A Win/Lose pick that just fell out of the attendee list must be
      // cleared, or the <select> would keep showing a stale value the admin
      // has no visual cue is now invalid.
      if (!next.includes(winnerId)) setWinnerId("");
      if (!next.includes(loserId)) setLoserId("");
      return next;
    });
  }

  function validate(): string | null {
    if (attendeeIds.length < 2) return "참가자는 2명 이상이어야 합니다.";
    if (!winnerId || !attendeeIds.includes(winnerId))
      return "Win은 참가자 목록에 포함되어야 합니다.";
    if (!loserId || !attendeeIds.includes(loserId))
      return "Lose는 참가자 목록에 포함되어야 합니다.";
    if (winnerId === loserId) return "Win과 Lose는 같은 사람일 수 없습니다.";
    if (!Number.isInteger(points) || points < 1)
      return "점수는 1 이상의 정수여야 합니다.";
    if (!date) return "날짜를 입력해 주세요.";
    if (!time) return "시간을 입력해 주세요.";
    return null;
  }

  function handleReview() {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStep("confirm");
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        await updateGame(game.id, {
          gameType,
          attendeeIds,
          winnerId,
          loserId,
          points,
          note,
          // date/time/active are only ever meaningful from an admin caller —
          // the server ignores them from anyone else anyway (PRD 15.4), but
          // leaving them out here for non-admins keeps this call site honest
          // about what it's actually allowed to change.
          ...(isAdmin ? { date, time, active } : {}),
        });
        onSaved();
      } catch (e) {
        setError(e instanceof Error ? e.message : "수정에 실패했습니다.");
        setStep("form");
      }
    });
  }

  const dateOrTimeChanged = date !== game.date || time !== (game.time ?? "00:00");

  if (step === "confirm") {
    return (
      <div className="rounded-xl border-2 border-slate-900 bg-white p-4 space-y-2.5">
        <h3 className="text-sm font-semibold mb-1">변경 내용 확인</h3>
        <DiffRow label="종목" before={gameTypeLabel(game.gameType)} after={gameTypeLabel(gameType)} />
        <DiffRow
          label="참가자"
          before={game.attendeeIds.map((id) => nameMap.get(id) ?? "(삭제됨)").join(", ")}
          after={attendeeIds.map((id) => nameMap.get(id) ?? "(삭제됨)").join(", ")}
        />
        <DiffRow
          label="Win/Lose"
          before={`${nameMap.get(game.winnerId) ?? "(삭제됨)"} / ${nameMap.get(game.loserId) ?? "(삭제됨)"}`}
          after={`${nameMap.get(winnerId) ?? "(삭제됨)"} / ${nameMap.get(loserId) ?? "(삭제됨)"}`}
        />
        <DiffRow label="점수" before={String(game.points ?? 1)} after={String(points)} />
        <DiffRow label="메모" before={game.note || "(없음)"} after={note.trim() || "(없음)"} />
        {isAdmin && (
          <>
            <DiffRow label="날짜" before={game.date} after={date} />
            <DiffRow label="시간" before={game.time || "(없음)"} after={time} />
            <DiffRow label="상태" before={game.active !== false ? "활성" : "비활성"} after={active ? "활성" : "비활성"} />
          </>
        )}

        {isAdmin && dateOrTimeChanged && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            날짜·시간을 바꾸면 N차전 번호와 날짜 필터 결과가 달라질 수 있습니다.
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="rounded-lg bg-emerald-600 text-white text-sm font-medium px-4 py-2 hover:bg-emerald-700 transition disabled:opacity-50"
          >
            {isSaving ? "저장 중..." : "이대로 저장"}
          </button>
          <button
            type="button"
            onClick={() => setStep("form")}
            disabled={isSaving}
            className="rounded-lg bg-slate-100 text-slate-600 text-sm font-medium px-4 py-2 hover:bg-slate-200 transition"
          >
            돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-300 bg-slate-50 p-4 space-y-4">
      <div>
        <span className="text-xs text-slate-500 block mb-1.5">종목</span>
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
                    ? "border-emerald-600 bg-emerald-50 text-emerald-900"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {selected && <CheckIcon />}
                {GAME_TYPE_LABELS[gt]}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <span className="text-xs text-slate-500 block mb-1.5">
          참가자 ({attendeeIds.length}명)
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {participants.map((p) => {
            const checked = attendeeIds.includes(p.id);
            return (
              <label
                key={p.id}
                className={`flex items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm cursor-pointer transition ${
                  checked
                    ? "border-emerald-600 bg-emerald-50 text-emerald-900"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
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
                      : "border-slate-300 bg-white"
                  }`}
                >
                  {checked && <CheckIcon />}
                </span>
                {p.name}
              </label>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Win</label>
          <select
            value={winnerId}
            onChange={(e) => setWinnerId(e.target.value)}
            className="w-full rounded-lg border-2 border-emerald-200 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">선택</option>
            {selectableAttendees.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Lose</label>
          <select
            value={loserId}
            onChange={(e) => setLoserId(e.target.value)}
            className="w-full rounded-lg border-2 border-red-200 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">선택</option>
            {selectableAttendees.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">점수</label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPoints((p) => Math.max(1, p - 1))}
              className="w-8 h-8 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 flex items-center justify-center"
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
              className="w-14 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-center"
            />
            <button
              type="button"
              onClick={() => setPoints((p) => p + 1)}
              className="w-8 h-8 rounded-lg border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 flex items-center justify-center"
              aria-label="점수 증가"
            >
              +
            </button>
          </div>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs text-slate-500 mb-1">메모 (선택)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예: 재대결"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm"
          />
        </div>
      </div>

      {isAdmin && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">
                날짜 (게임일 · 06:00 기준)
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">시간 (24시간제)</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <p className="text-xs text-amber-700">
            ※ 날짜·시간은 이 관리자 수정 화면에서만 바꿀 수 있어요. 하루는
            06:00~다음 날 06:00(30:00) 기준입니다 — 예: 8/15 04:00은 8/14의
            게임입니다. 변경하면 N차전 번호와 날짜 필터 결과가 달라질 수
            있습니다.
          </p>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            활성 상태
            <span className="text-xs text-slate-400">
              (해제 시 삭제된 것처럼 정산·통계에서 제외됩니다)
            </span>
          </label>
        </>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleReview}
          className="rounded-lg bg-slate-900 text-white text-sm font-medium px-4 py-2 hover:bg-slate-800 transition"
        >
          변경 내용 확인
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg bg-slate-100 text-slate-600 text-sm font-medium px-4 py-2 hover:bg-slate-200 transition"
        >
          취소
        </button>
      </div>
    </div>
  );
}
