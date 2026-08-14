"use client";

import { useMemo, useState } from "react";

// v2.19 — a month-grid picker for /games, so finding "that one game night"
// doesn't require guessing the exact 연/월/일 dropdown values. Days that
// actually have a recorded game are highlighted and clickable; everything
// else is inert. "이전/다음 게임일" skip straight to the nearest date that
// actually has a game, which matters more than plain month navigation once
// game nights are sparse (most calendar days have nothing on them).
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

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 (Sun) - 6 (Sat), the weekday the 1st of (year, month) falls on. */
function firstWeekdayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}

export default function GameCalendar({
  gameDates,
  selectedDate,
  onSelectDate,
  today,
}: {
  /** Business dates ("yyyy-MM-dd") that have at least one active game. */
  gameDates: Set<string>;
  /** Currently pinned exact date (year+month+day filters all specific), or null. */
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  /** Today's business date — used as the reference point for 이전/다음 게임일 when no date is pinned, and to ring today's cell. */
  today: string;
}) {
  const reference = selectedDate ?? today;
  const [cursorYear, setCursorYear] = useState(Number(reference.slice(0, 4)));
  const [cursorMonth, setCursorMonth] = useState(Number(reference.slice(5, 7)));

  const sortedGameDates = useMemo(() => Array.from(gameDates).sort(), [gameDates]);

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
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => goToMonth(cursorYear, cursorMonth - 1)}
          aria-label="이전 달"
          className="w-7 h-7 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center"
        >
          ‹
        </button>
        <span className="text-sm font-semibold">
          {cursorYear}년 {cursorMonth}월
        </span>
        <button
          type="button"
          onClick={() => goToMonth(cursorYear, cursorMonth + 1)}
          aria-label="다음 달"
          className="w-7 h-7 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAY_LABELS.map((w) => (
          <span key={w} className="text-center text-[11px] text-slate-400">
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <span key={`blank-${i}`} />;
          const hasGame = gameDates.has(date);
          const isSelected = date === selectedDate;
          const isToday = date === today;
          return (
            <button
              key={date}
              type="button"
              disabled={!hasGame}
              onClick={() => pickDate(date)}
              title={hasGame ? `${date} 게임 기록 있음` : undefined}
              className={`rounded-lg py-1.5 text-xs transition ${
                isSelected
                  ? "bg-slate-900 text-white font-semibold"
                  : hasGame
                  ? "bg-emerald-50 text-emerald-700 font-medium hover:bg-emerald-100"
                  : "text-slate-300 cursor-default"
              } ${isToday && !isSelected ? "ring-1 ring-inset ring-slate-400" : ""}`}
            >
              {Number(date.slice(8, 10))}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
        <button
          type="button"
          onClick={() => jumpToAdjacentGameDay("prev")}
          disabled={!hasPrevGameDay}
          className="text-xs font-medium text-slate-600 hover:text-slate-900 disabled:text-slate-300 disabled:cursor-not-allowed"
        >
          ← 이전 게임일
        </button>
        <button
          type="button"
          onClick={() => jumpToAdjacentGameDay("next")}
          disabled={!hasNextGameDay}
          className="text-xs font-medium text-slate-600 hover:text-slate-900 disabled:text-slate-300 disabled:cursor-not-allowed"
        >
          다음 게임일 →
        </button>
      </div>
    </div>
  );
}
