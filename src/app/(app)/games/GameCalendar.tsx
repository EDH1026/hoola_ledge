"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { daysInMonth, firstWeekdayOfMonth } from "@/lib/calendar";

// v2.19 (배치 B, PRD §24.10) — a month-grid picker for /games, so finding
// "that one game night" doesn't require guessing the exact 연/월/일 dropdown
// values. Days that actually have a recorded game are highlighted (background
// intensity encodes *how many* games, not just a boolean) and clickable;
// everything else is inert. "이전/다음 게임일" skip straight to the nearest
// date that actually has a game.
//
// Default-collapsed behind a "날짜로 찾기" toggle — 연·월·일 드롭다운already
// do the same job, so the ~300px grid is now opt-in rather than always
// costing everyone the scroll (PRD §24.10's first bullet). The expand/collapse
// state is deliberately plain useState, not URL-synced — it's presentation,
// not a filter (unlike year/month/day, which GamesListClient does sync).
//
// All date math here is UTC-based (Date.UTC / getUTC*), deliberately never
// `new Date(dateString)` + local getters — this component renders in the
// browser, whose timezone isn't guaranteed to be Asia/Seoul, and the rest of
// this app already avoids exactly this class of off-by-one-day bug for any
// "yyyy-MM-dd" business-date string (see time.ts's comments on
// addDaysToIsoDate/quarterKeyOf for the same reasoning applied server-side).

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function cellStyle(count: number, isSelected: boolean): string {
  if (isSelected) return "bg-slate-700 text-content font-semibold ring-1 ring-slate-500";
  if (count >= 3) return "bg-emerald-500/30 text-emerald-200 font-semibold hover:bg-emerald-500/40";
  if (count === 2) return "bg-emerald-500/20 text-emerald-300 font-medium hover:bg-emerald-500/30";
  if (count === 1) return "bg-emerald-500/10 text-emerald-300 font-medium hover:bg-emerald-500/20";
  return "text-content-faint cursor-default";
}

export default function GameCalendar({
  gameCounts,
  selectedDate,
  onSelectDate,
  onReset,
  today,
  focusYear,
  focusMonth,
}: {
  /** Business date ("yyyy-MM-dd") -> number of active games recorded on it. */
  gameCounts: Map<string, number>;
  /** Currently pinned exact date (year+month+day filters all specific), or null. */
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  /** Clears the year/month/day filter back to "전체". */
  onReset: () => void;
  /** Today's business date — reference point for 이전/다음 게임일 when no date is pinned, and to ring today's cell. */
  today: string;
  /** The parent's 연/월 dropdown selection (null when that dropdown is "전체") — the calendar's cursor follows this even when no exact date is pinned, so the two controls can't disagree on which month is showing. */
  focusYear: number | null;
  focusMonth: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const reference = selectedDate ?? today;
  const [cursorYear, setCursorYear] = useState(Number(reference.slice(0, 4)));
  const [cursorMonth, setCursorMonth] = useState(Number(reference.slice(5, 7)));

  // v2.19 — the 연·월 드롭다운과 이 달력의 커서는 같은 상태를 가리키므로
  // 하나가 바뀌면 다른 하나도 따라가야 한다(예전엔 pickDate 안에서만
  // 동기화되어, 드롭다운만 바꾸면 달력이 이전 달에 그대로 남아 있었다).
  // 리액트가 권장하는 "prop이 바뀌면 렌더 중에 state를 조정" 패턴 —
  // useEffect로 하면 한 프레임 늦게 반영되고 불필요한 재렌더가 하나 더
  // 생긴다(react-hooks/set-state-in-effect가 정확히 이걸 지적한다).
  const [syncedFocusYear, setSyncedFocusYear] = useState(focusYear);
  const [syncedFocusMonth, setSyncedFocusMonth] = useState(focusMonth);
  if (
    focusYear !== null &&
    focusMonth !== null &&
    (focusYear !== syncedFocusYear || focusMonth !== syncedFocusMonth)
  ) {
    setSyncedFocusYear(focusYear);
    setSyncedFocusMonth(focusMonth);
    setCursorYear(focusYear);
    setCursorMonth(focusMonth);
  }

  const sortedGameDates = Array.from(gameCounts.keys()).sort();

  function goToMonth(year: number, month: number) {
    if (month < 1) {
      setCursorYear(year - 1);
      setCursorMonth(12);
    } else if (month > 12) {
      setCursorYear(year + 1);
      setCursorMonth(1);
    } else {
      setCursorYear(year);
      setCursorMonth(month);
    }
  }

  function pickDate(date: string) {
    onSelectDate(date);
    setCursorYear(Number(date.slice(0, 4)));
    setCursorMonth(Number(date.slice(5, 7)));
  }

  function jumpToAdjacentGameDay(direction: "prev" | "next") {
    const target =
      direction === "prev"
        ? [...sortedGameDates].reverse().find((d) => d < reference)
        : sortedGameDates.find((d) => d > reference);
    if (target) pickDate(target);
  }

  const hasPrevGameDay = sortedGameDates.some((d) => d < reference);
  const hasNextGameDay = sortedGameDates.some((d) => d > reference);

  const leadingBlanks = firstWeekdayOfMonth(cursorYear, cursorMonth);
  const totalDays = daysInMonth(cursorYear, cursorMonth);
  const cells: (string | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: totalDays }, (_, i) => ymd(cursorYear, cursorMonth, i + 1)),
  ];

  return (
    <Card padding="sm">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="w-full min-h-11 flex items-center justify-between gap-2 rounded-lg px-1 transition hover:bg-slate-700/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-content">
          <CalendarDays className="w-4 h-4 text-content-muted" aria-hidden />
          날짜로 찾기
          {selectedDate && (
            <span className="text-content-muted font-normal tabular-nums">· {selectedDate}</span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-content-muted transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-line">
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => goToMonth(cursorYear, cursorMonth - 1)}
              aria-label="이전 달"
              className="w-11 h-11 rounded-lg text-content-muted hover:bg-slate-700 hover:text-content flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-content">
              {cursorYear}년 {cursorMonth}월
            </span>
            <button
              type="button"
              onClick={() => goToMonth(cursorYear, cursorMonth + 1)}
              aria-label="다음 달"
              className="w-11 h-11 rounded-lg text-content-muted hover:bg-slate-700 hover:text-content flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAY_LABELS.map((w) => (
              <span key={w} className="text-center text-[11px] text-content-muted">
                {w}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1 tabular-nums">
            {cells.map((date, i) => {
              if (!date) return <span key={`blank-${i}`} />;
              const count = gameCounts.get(date) ?? 0;
              const hasGame = count > 0;
              const isSelected = date === selectedDate;
              const isToday = date === today;
              return (
                <button
                  key={date}
                  type="button"
                  disabled={!hasGame}
                  onClick={() => pickDate(date)}
                  aria-label={hasGame ? `${date}, 게임 ${count}건` : date}
                  className={`h-11 rounded-lg text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${cellStyle(
                    count,
                    isSelected
                  )} ${isToday && !isSelected ? "ring-1 ring-inset ring-slate-500" : ""}`}
                >
                  {Number(date.slice(8, 10))}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-line">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => jumpToAdjacentGameDay("prev")}
              disabled={!hasPrevGameDay}
            >
              ← 이전 게임일
            </Button>
            <Button variant="ghost" size="sm" onClick={onReset}>
              전체
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => jumpToAdjacentGameDay("next")}
              disabled={!hasNextGameDay}
            >
              다음 게임일 →
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
