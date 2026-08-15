"use client";

import { useMemo, useState, useTransition } from "react";
import { format } from "date-fns";
import { Check } from "lucide-react";
import { deleteGame, hardDeleteGame, updateGame } from "@/lib/actions";
import { isActiveGame, withinDayKey } from "@/lib/games";
import {
  todayInSeoul,
  isWithinEditWindow,
  gameWallClock,
  businessDateFromWallClock,
} from "@/lib/time";
import {
  GAME_TYPE_LABELS,
  GAME_TYPES,
  GameResult,
  GameType,
} from "@/lib/types";
import { GameTypeBadge, InactiveBadge, GameNightBadge } from "@/components/badges";
import { computeParticipantPointTotals } from "@/lib/stats";
import { Card } from "@/components/ui/Card";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import GameCalendar from "./GameCalendar";

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

  // v2.19 — calendar picker: which business dates actually have a game (for
  // highlighting) and the single exact date the three dropdowns above
  // currently pin, if any. Soft-deleted games don't count as "there's a
  // game here" for a non-admin, but admins see them in `games` too (see
  // games/page.tsx) — matching activeFiltered's own active-only contract
  // keeps the calendar's highlighting consistent with what "회" the summary
  // line above actually counts.
  const gameDates = useMemo(
    () => new Set(games.filter(isActiveGame).map((g) => g.date)),
    [games]
  );
  const selectedDate: string | null =
    year !== "all" && month !== "all" && day !== "all"
      ? `${year}-${String(Number(month)).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`
      : null;
  function selectExactDate(date: string) {
    setYear(date.slice(0, 4));
    setMonth(String(Number(date.slice(5, 7))));
    setDay(String(Number(date.slice(8, 10))));
  }

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
      <Card padding="sm">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className="text-xs text-content-muted block mb-1">연도</span>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="bg-surface rounded-lg border border-slate-700 px-2 py-1.5 text-sm text-content"
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
            <span className="text-xs text-content-muted block mb-1">월</span>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="bg-surface rounded-lg border border-slate-700 px-2 py-1.5 text-sm text-content"
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
            <span className="text-xs text-content-muted block mb-1">일</span>
            <select
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="bg-surface rounded-lg border border-slate-700 px-2 py-1.5 text-sm text-content"
            >
              <option value="all">전체</option>
              {DAYS.map((d) => (
                <option key={d} value={String(d)}>
                  {d}일
                </option>
              ))}
            </select>
          </div>
          <div className="ml-auto text-sm text-content-muted text-right tabular-nums">
            {activeFiltered.length}회 · 점수 합계{" "}
            <span className="font-semibold text-content">{pointsSum}점</span>
            {isAdmin && inactiveCount > 0 && (
              <span className="block text-xs text-content-muted mt-0.5">
                (비활성 {inactiveCount}건은 집계에서 제외 · 목록에는 표시됨)
              </span>
            )}
          </div>
        </div>
      </Card>

      <GameCalendar
        gameDates={gameDates}
        selectedDate={selectedDate}
        onSelectDate={selectExactDate}
        today={today}
      />

      <Card padding="sm">
        <SectionTitle>이 구간 인별 점수</SectionTitle>
        {pointTotals.length === 0 ? (
          <EmptyState title="이 구간에 집계할 게임이 없습니다." />
        ) : (
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-content-muted text-xs">
                  <th className="py-1.5 pr-4">순위</th>
                  <th className="py-1.5 pr-4">이름</th>
                  <th className="py-1.5 pr-4">딴 점수</th>
                  <th className="py-1.5 pr-4">잃은 점수</th>
                  <th className="py-1.5 pr-4">순점수</th>
                </tr>
              </thead>
              <tbody>
                {pointTotals.map((p, i) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="py-1.5 pr-4 text-content-faint">{i + 1}</td>
                    <td className="py-1.5 pr-4 font-medium text-content">{p.name}</td>
                    <td className="py-1.5 pr-4 text-emerald-400">{p.pointsWon}</td>
                    <td className="py-1.5 pr-4 text-lose">{p.pointsLost}</td>
                    <td
                      className={`py-1.5 pr-4 font-semibold ${
                        p.netPoints > 0
                          ? "text-emerald-400"
                          : p.netPoints < 0
                          ? "text-lose"
                          : "text-content-muted"
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
      </Card>

      <div className="rounded-2xl border border-line bg-surface overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-5">
            <EmptyState title="조건에 맞는 게임 기록이 없습니다." />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((g) => {
              const seq = sequenceNumbers[g.id];
              const attendeeNames = g.attendeeIds.map(
                (id) => nameMap.get(id) ?? "(삭제됨)"
              );
              const points = g.points ?? 1;
              const inactive = g.active === false;
              const isEditing = editingId === g.id;
              // v2.18 (PRD §22) — g.date is the business day this game is
              // *grouped* under, not necessarily the calendar date its time
              // actually occurred on; wallClock recovers the real one for
              // display. N차전 (seq, above) stays business-day-keyed on
              // purpose — only this row's own timestamp changes.
              const wallClock = gameWallClock(g.date, g.time);
              // Non-admins only ever see active games (games/page.tsx keeps
              // soft-deleted rows admin-only), so `!inactive` is already
              // guaranteed there — it's included explicitly anyway so this
              // stays correct if that upstream contract ever changes.
              const editableByUser = isWithinEditWindow(g.createdAt);
              const canEdit = isAdmin || (!inactive && editableByUser);
              const canDelete = !inactive && (isAdmin || editableByUser);
              return (
                <li
                  key={g.id}
                  className={`p-4 space-y-2 ${
                    inactive ? "border-l-2 border-slate-500 bg-surface-raised/50" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-content-muted whitespace-nowrap tabular-nums">
                        {format(new Date(wallClock.date), "yyyy-MM-dd")}
                        {wallClock.time ? ` ${wallClock.time}` : ""}
                        {seq ? ` · ${seq}차전` : ""}
                      </span>
                      <GameTypeBadge gameType={g.gameType} />
                      {wallClock.crossedMidnight && (
                        <GameNightBadge businessDate={wallClock.businessDate} />
                      )}
                      {inactive && <InactiveBadge />}
                    </div>
                    <div className="flex items-center gap-3">
                      {isAdmin && confirmHardDeleteId === g.id ? (
                        <span className="flex items-center gap-2 text-xs">
                          <span className="text-red-300 font-medium">
                            완전 삭제할까요? 되돌릴 수 없습니다.
                          </span>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleHardDelete(g.id)}
                            disabled={isHardDeleting}
                            pending={isHardDeleting}
                            pendingText="삭제 중..."
                          >
                            확인
                          </Button>
                          <Button
                            variant="neutral"
                            size="sm"
                            onClick={() => setConfirmHardDeleteId(null)}
                            disabled={isHardDeleting}
                          >
                            취소
                          </Button>
                        </span>
                      ) : (
                        <>
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingId(isEditing ? null : g.id)}
                            >
                              {isEditing ? "닫기" : "수정"}
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => handleDelete(g.id)}
                              disabled={isPending && deletingId === g.id}
                              pending={isPending && deletingId === g.id}
                              pendingText="삭제 중..."
                            >
                              삭제
                            </Button>
                          )}
                          {isAdmin && (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => setConfirmHardDeleteId(g.id)}
                            >
                              완전삭제
                            </Button>
                          )}
                          {!canEdit && !canDelete && (
                            <span className="text-xs text-content-muted">
                              기록 후 2시간이 지나 수정·삭제할 수 없습니다.
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {deleteError?.id === g.id && (
                    <p className="text-xs text-red-400">{deleteError.message}</p>
                  )}
                  <div className="text-sm tabular-nums">
                    <span className="font-semibold text-emerald-400">
                      {nameMap.get(g.winnerId) ?? "(삭제됨)"}
                    </span>
                    <span className="text-content-muted mx-1.5">Win · Lose</span>
                    <span className="font-semibold text-lose">
                      {nameMap.get(g.loserId) ?? "(삭제됨)"}
                    </span>
                    <span className="text-xs text-content-muted ml-2">
                      · {points}점
                    </span>
                    {g.note && (
                      <span className="text-xs text-content-muted ml-2">
                        · {g.note}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-content-muted">
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
      </div>
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
      <span className="text-content-muted w-16 shrink-0">{label}</span>
      {changed ? (
        <span>
          <span className="text-content-muted line-through decoration-content-faint">
            {before}
          </span>
          <span className="text-content-faint mx-1.5">→</span>
          <span className="font-semibold text-content">{after}</span>
        </span>
      ) : (
        <span className="text-content-sub">{before}</span>
      )}
    </div>
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
  // v2.19 (PRD §22.4 revised) — the admin now types the *real calendar*
  // date/time the game was actually played, not the stored business date.
  // `calendarDate` is seeded from the recovered wall clock (v2.18's
  // gameWallClock) rather than game.date directly, so re-opening this form
  // shows what actually happened, not the grouping key. The business date
  // that gets saved is derived from (calendarDate, time) at save time —
  // see businessDate below — so the admin never has to think about the
  // 06:00 boundary themselves.
  const [calendarDate, setCalendarDate] = useState(
    gameWallClock(game.date, game.time).date
  );
  const [time, setTime] = useState(game.time ?? "00:00");
  const [active, setActive] = useState(game.active !== false);
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startTransition] = useTransition();

  // The value actually saved as `date` — derived automatically from what the
  // admin typed, never entered directly. A time before 06:00 means this
  // rolls back to the previous calendar day (PRD §22.1's 06:00 boundary).
  const businessDate = businessDateFromWallClock(calendarDate, time);
  const crossesToPreviousBusinessDay = businessDate !== calendarDate;

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
    if (!calendarDate) return "날짜를 입력해 주세요.";
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
          // about what it's actually allowed to change. `date` is the
          // *derived* business date (businessDate), not the calendarDate the
          // admin typed — see the comment on businessDate above.
          ...(isAdmin ? { date: businessDate, time, active } : {}),
        });
        onSaved();
      } catch (e) {
        setError(e instanceof Error ? e.message : "수정에 실패했습니다.");
        setStep("form");
      }
    });
  }

  const initialCalendarDate = gameWallClock(game.date, game.time).date;
  const dateOrTimeChanged =
    calendarDate !== initialCalendarDate || time !== (game.time ?? "00:00");

  if (step === "confirm") {
    return (
      <div className="rounded-xl border border-accent bg-surface p-4 space-y-2.5">
        <h3 className="text-sm font-semibold text-content mb-1">변경 내용 확인</h3>
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
            <DiffRow label="날짜" before={initialCalendarDate} after={calendarDate} />
            <DiffRow label="시간" before={game.time || "(없음)"} after={time} />
            {crossesToPreviousBusinessDay && (
              <p className="text-xs text-indigo-300 pl-16">
                → 영업일 기준으로는 전날({businessDate})의 게임으로 저장됩니다.
              </p>
            )}
            <DiffRow label="상태" before={game.active !== false ? "활성" : "비활성"} after={active ? "활성" : "비활성"} />
          </>
        )}

        {isAdmin && dateOrTimeChanged && (
          <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-800 rounded-lg px-3 py-2">
            날짜·시간을 바꾸면 N차전 번호와 날짜 필터 결과가 달라질 수 있습니다.
          </p>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="min-h-9 rounded-lg bg-emerald-600 text-white text-sm font-medium px-4 transition active:scale-[0.97] hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50 disabled:pointer-events-none"
          >
            {isSaving ? "저장 중..." : "이대로 저장"}
          </button>
          <Button variant="neutral" size="sm" onClick={() => setStep("form")} disabled={isSaving}>
            돌아가기
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-surface-raised p-4 space-y-4">
      <div>
        <span className="text-xs text-content-muted block mb-1.5">종목</span>
        <div className="grid grid-cols-3 gap-2">
          {GAME_TYPES.map((gt) => {
            const selected = gameType === gt;
            return (
              <button
                key={gt}
                type="button"
                onClick={() => setGameType(gt)}
                className={`flex items-center justify-center gap-1.5 rounded-lg border-2 px-3 py-2 text-sm font-medium transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                  selected
                    ? "border-emerald-600 bg-emerald-500/10 text-emerald-200"
                    : "border-line bg-surface text-content-sub hover:bg-slate-700"
                }`}
              >
                {selected && <Check className="w-4 h-4 shrink-0" />}
                {GAME_TYPE_LABELS[gt]}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <span className="text-xs text-content-muted block mb-1.5">
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
                    ? "border-emerald-600 bg-emerald-500/10 text-emerald-200"
                    : "border-line bg-surface text-content-sub hover:bg-slate-700"
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
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-content-muted mb-1">Win</label>
          <select
            value={winnerId}
            onChange={(e) => setWinnerId(e.target.value)}
            className="w-full rounded-lg border-2 border-emerald-800 bg-surface px-2 py-1.5 text-sm text-content"
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
          <label className="block text-xs text-content-muted mb-1">Lose</label>
          <select
            value={loserId}
            onChange={(e) => setLoserId(e.target.value)}
            className="w-full rounded-lg border-2 border-red-800 bg-surface px-2 py-1.5 text-sm text-content"
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
          <label className="block text-xs text-content-muted mb-1">점수</label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPoints((p) => Math.max(1, p - 1))}
              className="w-8 h-8 rounded-lg border border-slate-700 bg-surface text-content-sub hover:bg-slate-700 flex items-center justify-center transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
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
              className="w-14 rounded-lg border border-slate-700 bg-surface px-2 py-1.5 text-sm text-center text-content tabular-nums"
            />
            <button
              type="button"
              onClick={() => setPoints((p) => p + 1)}
              className="w-8 h-8 rounded-lg border border-slate-700 bg-surface text-content-sub hover:bg-slate-700 flex items-center justify-center transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              aria-label="점수 증가"
            >
              +
            </button>
          </div>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs text-content-muted mb-1">메모 (선택)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예: 재대결"
            className="w-full rounded-lg border border-slate-700 bg-surface px-3 py-1.5 text-sm text-content"
          />
        </div>
      </div>

      {isAdmin && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-content-muted mb-1">
                날짜 (실제 게임한 날짜)
              </label>
              <input
                type="date"
                value={calendarDate}
                onChange={(e) => setCalendarDate(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-surface px-2 py-1.5 text-sm text-content"
              />
            </div>
            <div>
              <label className="block text-xs text-content-muted mb-1">시간 (24시간제)</label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-surface px-2 py-1.5 text-sm text-content"
              />
            </div>
          </div>
          <p className="text-xs text-amber-300">
            ※ 날짜·시간은 이 관리자 수정 화면에서만 바꿀 수 있어요. 실제로
            게임한 날짜·시간을 그대로 입력하면 됩니다 — 변경하면 N차전 번호와
            날짜 필터 결과가 달라질 수 있습니다.
          </p>
          {crossesToPreviousBusinessDay && (
            <p className="text-xs text-indigo-300 bg-indigo-500/10 border border-indigo-800 rounded-lg px-3 py-2">
              06:00 이전 시각이라, 이 앱의 하루 기준(06:00~다음 날 06:00)으로는{" "}
              <strong>전날 {businessDate}</strong>의 게임으로 자동 저장됩니다.
            </p>
          )}

          <label className="flex items-center gap-2 text-sm text-content-sub">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            활성 상태
            <span className="text-xs text-content-muted">
              (해제 시 삭제된 것처럼 정산·통계에서 제외됩니다)
            </span>
          </label>
        </>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={handleReview}>
          변경 내용 확인
        </Button>
        <Button variant="neutral" size="sm" onClick={onCancel}>
          취소
        </Button>
      </div>
    </div>
  );
}
