// v2.19 (배치 B, PRD §24.10) — pure calendar-grid math shared between
// GameCalendar.tsx (month grid) and GamesListClient.tsx (연·월·일 드롭다운),
// so the day picker and the calendar widget can't disagree on how long a
// month is. Kept out of time.ts on purpose — time.ts's job is Asia/Seoul
// wall-clock/business-day semantics, not generic Gregorian grid math, and
// this batch's instructions call for exactly one new time.ts helper
// (editWindowRemainingMs). UTC-only scratch math throughout, never
// `new Date(dateString)` + local getters — see time.ts's addDaysToIsoDate
// comment for why that's the wrong tool here.

/** Number of days in (year, month) (1-12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 (Sun) - 6 (Sat), the weekday the 1st of (year, month) falls on. */
export function firstWeekdayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
}
