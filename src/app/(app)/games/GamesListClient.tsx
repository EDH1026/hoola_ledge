"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Pencil, Trash2 } from "lucide-react";
import { deleteGame, restoreGame, hardDeleteGame, updateGame } from "@/lib/actions";
import { isActiveGame, withinDayKey } from "@/lib/games";
import {
  todayInSeoul,
  isWithinEditWindow,
  gameWallClock,
  businessDateFromWallClock,
  EDIT_WINDOW_MS,
} from "@/lib/time";
import { daysInMonth } from "@/lib/calendar";
import {
  GAME_TYPE_LABELS,
  GAME_TYPES,
  GameResult,
  GameType,
} from "@/lib/types";
import { GameTypeFilter } from "@/lib/stats";
import { GameTypeBadge, InactiveBadge, GameNightBadge } from "@/components/badges";
import { computeParticipantPointTotals } from "@/lib/stats";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { FilterChip } from "@/components/ui/FilterChip";
import { EmptyState } from "@/components/ui/EmptyState";
import { OverflowMenu, OverflowMenuItem } from "@/components/ui/OverflowMenu";
import { UndoStack, useUndoStack } from "@/components/ui/UndoStack";
import { EditWindowChip } from "@/components/ui/EditWindowChip";
import GameCalendar from "./GameCalendar";

interface ParticipantLite {
  id: string;
  name: string;
}

const GAME_TYPE_OPTIONS: { value: GameTypeFilter; label: string }[] = [
  { value: "all", label: "전체" },
  ...GAME_TYPES.map((gt) => ({ value: gt as GameTypeFilter, label: GAME_TYPE_LABELS[gt] })),
];

function gameTypeLabel(gt?: GameType): string {
  return gt ? GAME_TYPE_LABELS[gt] : "종목 미지정";
}

const WEEKDAY_LABELS_KO = ["일", "월", "화", "수", "목", "금", "토"];

// v2.19 (배치 C, PRD §24.5) — 게임 밤 하나를 보는 게 기본 사용 패턴인데
// 행마다 날짜를 반복해서 찍고 있었다. 날짜를 그룹 헤더로 올리고 행에는
// 시각만 남긴다. 그룹핑 키는 영업일 g.date(§22.4의 "day를 가리키는 라벨"
// 규칙) — getUTCDay()를 쓰는 건 "yyyy-MM-dd" 문자열이 UTC 자정으로
// 파싱되기 때문에(ISO 8601 날짜 전용 문자열의 표준 동작), 보는 사람의
// 타임존과 무관하게 항상 같은 요일이 나오게 하기 위해서다.
function formatDateWithWeekday(date: string): string {
  return `${date} (${WEEKDAY_LABELS_KO[new Date(date).getUTCDay()]})`;
}

function applyOrDelete(params: URLSearchParams, key: string, value: string, defaultValue: string) {
  if (value === defaultValue) params.delete(key);
  else params.set(key, value);
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const nameMap = useMemo(
    () => new Map(participants.map((p) => [p.id, p.name])),
    [participants]
  );

  const today = todayInSeoul();

  // v2.19 (배치 B, PRD §24.10/§24.12) — 기본 필터가 "오늘"이면 게임 밤이
  // 아닌 날 앱을 켤 때마다 빈 화면부터 보게 된다. 대시보드의 "최근 게임"
  // 섹션과 같은 로직(가장 최근 활성 게임의 영업일)으로 기본값을 잡는다.
  // 게임이 하나도 없으면 오늘로 폴백.
  const mostRecentGameDate = useMemo(
    () =>
      games
        .filter(isActiveGame)
        .reduce((latest, g) => (g.date > latest ? g.date : latest), ""),
    [games]
  );
  const defaultDateSource = mostRecentGameDate || today;
  const defaultYear = defaultDateSource.slice(0, 4);
  const defaultMonth = String(Number(defaultDateSource.slice(5, 7)));
  const defaultDay = String(Number(defaultDateSource.slice(8, 10)));

  // v2.19 (배치 B, PRD §24.12) — 필터를 URL 검색 파라미터로 동기화한다.
  // 파라미터가 없으면 위에서 계산한 기본값("가장 최근 게임일")을 쓰고,
  // "전체"는 그 자체로 값이 다르므로 항상 명시적으로 기록된다(그래야
  // "기본값"과 "명시적 전체"가 URL 위에서 구별된다).
  const year = searchParams.get("y") ?? defaultYear;
  const month = searchParams.get("m") ?? defaultMonth;
  const day = searchParams.get("d") ?? defaultDay;
  const gameTypeFilter = (searchParams.get("type") as GameTypeFilter | null) ?? "all";

  function replaceParams(params: URLSearchParams) {
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function setYearMonth(newYear: string, newMonth: string) {
    const params = new URLSearchParams(searchParams.toString());
    applyOrDelete(params, "y", newYear, defaultYear);
    applyOrDelete(params, "m", newMonth, defaultMonth);
    // 새 연·월에 존재하지 않는 일(예: 2월 30일)이 선택돼 있으면 전체로
    // 리셋한다 — 안 그러면 조용히 빈 목록만 남는다.
    if (day !== "all" && newYear !== "all" && newMonth !== "all") {
      const maxDay = daysInMonth(Number(newYear), Number(newMonth));
      if (Number(day) > maxDay) params.delete("d");
    }
    replaceParams(params);
  }
  const setYear = (v: string) => setYearMonth(v, month);
  const setMonth = (v: string) => setYearMonth(year, v);
  function setDay(v: string) {
    const params = new URLSearchParams(searchParams.toString());
    applyOrDelete(params, "d", v, defaultDay);
    replaceParams(params);
  }
  function setGameTypeFilter(v: GameTypeFilter) {
    const params = new URLSearchParams(searchParams.toString());
    applyOrDelete(params, "type", v, "all");
    replaceParams(params);
  }
  function selectExactDate(date: string) {
    const params = new URLSearchParams(searchParams.toString());
    applyOrDelete(params, "y", date.slice(0, 4), defaultYear);
    applyOrDelete(params, "m", String(Number(date.slice(5, 7))), defaultMonth);
    applyOrDelete(params, "d", String(Number(date.slice(8, 10))), defaultDay);
    replaceParams(params);
  }
  /** GameCalendar의 "전체" 버튼 — 연·월·일을 명시적으로 "전체"로. */
  function resetDateFilter() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("y", "all");
    params.set("m", "all");
    params.set("d", "all");
    replaceParams(params);
  }
  /** 빈 상태의 "필터 초기화" — 날짜·종목 모두 가장 넓은 범위로. */
  function resetAllFilters() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("y", "all");
    params.set("m", "all");
    params.set("d", "all");
    params.delete("type");
    replaceParams(params);
  }
  /** 빈 상태의 "최근 게임일로 이동" — 기본값(= 가장 최근 게임일)으로 복귀. */
  function jumpToMostRecentGameDay() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("y");
    params.delete("m");
    params.delete("d");
    params.delete("type");
    replaceParams(params);
  }

  const years = useMemo(() => {
    const set = new Set(games.map((g) => g.date.slice(0, 4)));
    set.add(defaultYear);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [games, defaultYear]);

  const dayCount =
    year !== "all" && month !== "all" ? daysInMonth(Number(year), Number(month)) : 31;
  const DAYS = useMemo(() => Array.from({ length: dayCount }, (_, i) => i + 1), [dayCount]);
  const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

  // v2.19 — 달력은 날짜 필터(연·월·일)를 타지 않고 종목 필터만 탄다: "찾고
  // 있는 종목의 게임이 있는 날"을 보여주는 게 목적이므로, 이미 날짜로 좁혀
  // 놓은 뒤에도 달력 전체를 계속 보여줘야 다른 날로 이동할 수 있다.
  const gameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of games.filter(isActiveGame)) {
      if (gameTypeFilter !== "all" && g.gameType !== gameTypeFilter) continue;
      counts.set(g.date, (counts.get(g.date) ?? 0) + 1);
    }
    return counts;
  }, [games, gameTypeFilter]);
  const selectedDate: string | null =
    year !== "all" && month !== "all" && day !== "all"
      ? `${year}-${String(Number(month)).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`
      : null;

  const [isPending, startTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<{ id: string; message: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmHardDeleteId, setConfirmHardDeleteId] = useState<string | null>(null);
  const [isHardDeleting, startHardDeleteTransition] = useTransition();
  const undo = useUndoStack();
  // v2.19 (배치 C, PRD §24.5) — 참석자는 인원수만 기본 노출, 탭하면 펼친다.
  const [expandedAttendees, setExpandedAttendees] = useState<Set<string>>(new Set());
  function toggleAttendees(id: string) {
    setExpandedAttendees((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filtered = useMemo(() => {
    return games
      .filter((g) => {
        const [y, m, d] = g.date.split("-");
        if (year !== "all" && y !== year) return false;
        if (month !== "all" && String(Number(m)) !== month) return false;
        if (day !== "all" && String(Number(d)) !== day) return false;
        if (gameTypeFilter !== "all" && g.gameType !== gameTypeFilter) return false;
        return true;
      })
      .sort((a, b) =>
        b.date === a.date
          ? withinDayKey(b).localeCompare(withinDayKey(a))
          : b.date.localeCompare(a.date)
      );
  }, [games, year, month, day, gameTypeFilter]);

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
  // 날짜 그룹 헤더의 "N게임" — 실제로 그 헤더 아래 나열될 행 수와 맞춰야
  // 하므로 activeFiltered가 아니라 filtered(관리자에게 보이는 비활성 포함)
  // 기준으로 센다.
  const dayGroupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of filtered) counts.set(g.date, (counts.get(g.date) ?? 0) + 1);
    return counts;
  }, [filtered]);

  function handleDelete(g: GameResult) {
    setDeleteError(null);
    startTransition(async () => {
      try {
        await deleteGame(g.id);
        // 관리자는 언제든 되돌릴 수 있으므로 토스트 자체는 지금부터 다시
        // EDIT_WINDOW_MS — 비관리자는 서버 게이트(§15)와 정확히 같은
        // 시점에 "되돌리기"가 사라지도록 원래 createdAt 기준으로 만료시킨다.
        const expiresAt = isAdmin
          ? Date.now() + EDIT_WINDOW_MS
          : new Date(g.createdAt).getTime() + EDIT_WINDOW_MS;
        undo.push({
          id: g.id,
          message: `삭제됨: ${nameMap.get(g.winnerId) ?? "(삭제됨)"} ← ${nameMap.get(g.loserId) ?? "(삭제됨)"} ${g.points ?? 1}점`,
          expiresAt,
          onUndo: () => restoreGame(g.id),
        });
      } catch (e) {
        setDeleteError({
          id: g.id,
          message: e instanceof Error ? e.message : "삭제에 실패했습니다.",
        });
      }
    });
  }

  function handleHardDelete(id: string) {
    startHardDeleteTransition(async () => {
      await hardDeleteGame(id);
      setConfirmHardDeleteId(null);
    });
  }

  const bestScorer = pointTotals.length > 0 ? pointTotals[0] : null;

  return (
    <div className="space-y-4">
      <UndoStack entries={undo.entries} onRemove={undo.remove} />

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
        <div className="flex gap-2 flex-wrap mt-3">
          {GAME_TYPE_OPTIONS.map((opt) => (
            <FilterChip
              key={opt.value}
              selected={gameTypeFilter === opt.value}
              onClick={() => setGameTypeFilter(opt.value)}
            >
              {opt.label}
            </FilterChip>
          ))}
        </div>
      </Card>

      <GameCalendar
        gameCounts={gameCounts}
        selectedDate={selectedDate}
        onSelectDate={selectExactDate}
        onReset={resetDateFilter}
        today={today}
        focusYear={year !== "all" ? Number(year) : null}
        focusMonth={month !== "all" ? Number(month) : null}
      />

      {activeFiltered.length > 0 && (
        <Card padding="sm">
          <details>
            <summary className="cursor-pointer select-none list-none flex items-center justify-between gap-2 min-h-9">
              <span className="text-sm text-content-sub">
                이 구간 <span className="font-semibold text-content tabular-nums">{activeFiltered.length}게임</span>
                {bestScorer && (
                  <>
                    {" "}
                    · 최다 획득{" "}
                    <span className="font-semibold text-content">{bestScorer.name}</span>{" "}
                    <span className="text-emerald-400 tabular-nums">
                      {bestScorer.netPoints > 0 ? "+" : ""}
                      {bestScorer.netPoints}
                    </span>
                  </>
                )}
              </span>
              <span className="text-xs text-content-muted shrink-0">인별 배출권 보기</span>
            </summary>
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-content-muted text-xs">
                    <th className="py-1.5 pr-4">순위</th>
                    <th className="py-1.5 pr-4">이름</th>
                    <th className="py-1.5 pr-4">받은 배출권</th>
                    <th className="py-1.5 pr-4">넘긴 배출권</th>
                    <th className="py-1.5 pr-4">순증감</th>
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
          </details>
        </Card>
      )}

      <div className="rounded-2xl border border-line bg-surface overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="조건에 맞는 게임 기록이 없습니다."
              action={
                <div className="flex gap-2 flex-wrap justify-center">
                  <Button variant="neutral" size="sm" onClick={resetAllFilters}>
                    필터 초기화
                  </Button>
                  {mostRecentGameDate && (
                    <Button variant="neutral" size="sm" onClick={jumpToMostRecentGameDay}>
                      최근 게임일로 이동
                    </Button>
                  )}
                  <Link href="/games/new">
                    <Button variant="primary" size="sm">
                      + 새 게임 기록
                    </Button>
                  </Link>
                </div>
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((g, idx) => {
              const seq = sequenceNumbers[g.id];
              const attendeeNames = g.attendeeIds.map(
                (id) => nameMap.get(id) ?? "(삭제됨)"
              );
              const points = g.points ?? 1;
              const inactive = g.active === false;
              const isEditing = editingId === g.id;
              const attendeesExpanded = expandedAttendees.has(g.id);
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
              const hasMenu = canEdit || canDelete || isAdmin;
              // v2.19 (배치 C, PRD §24.5) — 날짜 그룹 헤더: 게임 밤 하나를
              // 보는 게 기본 사용 패턴이므로 날짜를 행마다 반복하는 대신
              // 그룹 헤더로 한 번만 올린다. 그룹핑 키는 영업일 g.date —
              // filtered가 이미 date desc 정렬이므로 이전 행과 비교하는
              // 것만으로 경계를 찾을 수 있다.
              const showDateHeader = idx === 0 || filtered[idx - 1].date !== g.date;
              return (
                <Fragment key={g.id}>
                  {showDateHeader && (
                    <li className="px-4 py-2 bg-surface-raised/60 text-xs font-medium text-content-muted tabular-nums">
                      {formatDateWithWeekday(g.date)} · {dayGroupCounts.get(g.date) ?? 0}게임
                    </li>
                  )}
                  <li
                    className={`p-4 space-y-2 ${
                      inactive ? "border-l-2 border-slate-500 bg-surface-raised/50" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2 justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <GameTypeBadge gameType={g.gameType} />
                        {/* v2.19 (PRD §24.5) — 게임 밤 표식은 그룹이 아니라
                            행에 유지한다: 어긋나는 건 개별 행이지 그룹
                            전체가 아니다(§22.5) — 8/14 그룹 안에 "게임
                            밤" 표식이 붙은 8/15 01:00 행이 섞여 있는 게
                            정상이다. */}
                        {wallClock.crossedMidnight && (
                          <GameNightBadge businessDate={wallClock.businessDate} />
                        )}
                        {inactive && <InactiveBadge />}
                        {!isAdmin && !inactive && canEdit && <EditWindowChip createdAt={g.createdAt} />}
                      </div>
                      <span className="text-xs text-content-muted whitespace-nowrap tabular-nums">
                        {seq ? `${seq}차전` : ""}
                        {seq && wallClock.time ? " · " : ""}
                        {wallClock.time ?? ""}
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm tabular-nums truncate">
                        {/* 화살표는 점수가 흐르는 방향(패자 -> 승자, 정산
                            화면과 같은 채무자 -> 채권자 관례)을 가리킨다. */}
                        <span className="font-semibold text-lose">
                          {nameMap.get(g.loserId) ?? "(삭제됨)"}
                        </span>
                        <span className="text-content-muted mx-1.5">→</span>
                        <span className="font-semibold text-emerald-400">
                          {nameMap.get(g.winnerId) ?? "(삭제됨)"}
                        </span>
                      </span>
                      {/* v2.19 (PRD §24.5) — 장부 앱의 핵심 값인 점수를
                          우측 정렬 + text-base font-semibold로 승격했다
                          (예전엔 12px, 이름보다 흐렸다). */}
                      <span className="text-base font-semibold text-content tabular-nums shrink-0">
                        {points}점
                      </span>
                    </div>

                    {g.note && (
                      // v2.19 — 메모가 점수와 완전히 같은 스타일이라 구분이
                      // 안 됐다. 별도 줄로 뺐다.
                      <p className="text-xs text-content-muted">{g.note}</p>
                    )}

                    {deleteError?.id === g.id && (
                      <p className="text-xs text-red-400">{deleteError.message}</p>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => toggleAttendees(g.id)}
                        className="inline-flex items-center gap-1 min-h-9 -my-1 text-xs text-content-muted hover:text-content-sub rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                        aria-expanded={attendeesExpanded}
                      >
                        참석 {g.attendeeIds.length}명
                        <ChevronDown
                          className={`w-3 h-3 transition-transform ${attendeesExpanded ? "rotate-180" : ""}`}
                          aria-hidden
                        />
                      </button>

                      {isAdmin && confirmHardDeleteId === g.id ? (
                        <span className="flex items-center gap-2 text-xs">
                          <span className="text-red-300 font-medium">
                            완전 삭제할까요? 되돌릴 수 없습니다.
                          </span>
                          <Button
                            variant="danger"
                            onClick={() => handleHardDelete(g.id)}
                            disabled={isHardDeleting}
                            pending={isHardDeleting}
                            pendingText="삭제 중..."
                          >
                            확인
                          </Button>
                          <Button
                            variant="neutral"
                            onClick={() => setConfirmHardDeleteId(null)}
                            disabled={isHardDeleting}
                          >
                            취소
                          </Button>
                        </span>
                      ) : (
                        hasMenu && (
                          <OverflowMenu label="게임 기록 더 보기">
                            {(close) => (
                              <>
                                {canEdit && (
                                  <OverflowMenuItem
                                    onClick={() => {
                                      setEditingId(isEditing ? null : g.id);
                                      close();
                                    }}
                                  >
                                    <Pencil className="w-4 h-4 mr-2 shrink-0" aria-hidden />
                                    {isEditing ? "수정 닫기" : "수정"}
                                  </OverflowMenuItem>
                                )}
                                {canDelete && (
                                  <OverflowMenuItem
                                    danger
                                    disabled={isPending}
                                    onClick={() => {
                                      handleDelete(g);
                                      close();
                                    }}
                                  >
                                    <Trash2 className="w-4 h-4 mr-2 shrink-0" aria-hidden />
                                    삭제
                                  </OverflowMenuItem>
                                )}
                                {isAdmin && (
                                  <OverflowMenuItem
                                    danger
                                    onClick={() => {
                                      setConfirmHardDeleteId(g.id);
                                      close();
                                    }}
                                  >
                                    <Trash2 className="w-4 h-4 mr-2 shrink-0" aria-hidden />
                                    완전삭제
                                  </OverflowMenuItem>
                                )}
                              </>
                            )}
                          </OverflowMenu>
                        )
                      )}
                    </div>
                    {attendeesExpanded && (
                      <p className="text-xs text-content-muted">{attendeeNames.join(", ")}</p>
                    )}

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
                </Fragment>
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
            className="min-h-11 rounded-lg bg-emerald-600 text-white text-sm font-medium px-4 transition active:scale-[0.97] hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50 disabled:pointer-events-none"
          >
            {isSaving ? "저장 중..." : "이대로 저장"}
          </button>
          <Button variant="neutral" onClick={() => setStep("form")} disabled={isSaving}>
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
              className="w-11 h-11 rounded-lg border border-slate-700 bg-surface text-content-sub hover:bg-slate-700 flex items-center justify-center transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
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
              className="w-11 h-11 rounded-lg border border-slate-700 bg-surface text-content-sub hover:bg-slate-700 flex items-center justify-center transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
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
              (해제 시 삭제된 것처럼 배출권·통계에서 제외됩니다)
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
