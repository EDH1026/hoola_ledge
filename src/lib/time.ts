// This app is used by a Korea-based group, and all displayed dates/times are
// meant to read as Asia/Seoul wall-clock time regardless of what timezone the
// Node process itself runs in (Vercel serverless defaults to UTC). Korea has
// no DST, so a fixed +9h offset is exact and avoids any Intl/ICU timezone
// database quirks — do date math here, not by reaching for `new Date()`
// getters or `toISOString()` slicing elsewhere in the app.
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * A UTC ISO instant (e.g. `createdAt`) -> the true Asia/Seoul calendar
 * wall-clock reading, as plain "yyyy-MM-dd" / "HH:mm" strings. This is the
 * one place that does the +9h offset math; `nowInSeoul()`, `formatInSeoul()`,
 * and v2.17's `businessDateFromIso()` all go through it so there's a single
 * source of truth for "what did the Seoul clock actually read at instant X".
 */
export function seoulWallClockFromIso(iso: string): { date: string; time: string } {
  const d = new Date(new Date(iso).getTime() + SEOUL_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return { date: `${y}-${m}-${day}`, time: `${h}:${min}` };
}

/** Current wall-clock date/time in Asia/Seoul, as plain "yyyy-MM-dd" / "HH:mm" strings. */
export function nowInSeoul(): { date: string; time: string } {
  return seoulWallClockFromIso(new Date().toISOString());
}

/**
 * Today's *business* date in Asia/Seoul as "yyyy-MM-dd" (v2.16: 06:00-30:00
 * day boundary — see the helpers further down this file). Every "오늘" in
 * this app (game list default filter, adjustment/settlement default dates,
 * quarter-key fallback) means this, not the raw calendar date, so this
 * function's result changed meaning in v2.16 even though its name didn't.
 */
export function todayInSeoul(): string {
  const { date, time } = nowInSeoul();
  return businessDateFromWallClock(date, time);
}

/**
 * Interprets a "yyyy-MM-ddTHH:mm[:ss]" string (as produced by an
 * `<input type="datetime-local">`) as Asia/Seoul wall-clock time and returns
 * the equivalent UTC instant as an ISO string, so it can be compared against
 * `createdAt` values (always stored as true UTC ISO instants).
 */
export function seoulLocalToUtcIso(localDateTime: string): string {
  const match = localDateTime.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (!match) throw new Error(`Invalid local datetime: ${localDateTime}`);
  const [, y, mo, d, h, mi, s] = match;
  const asIfUtcMs = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0)
  );
  return new Date(asIfUtcMs - SEOUL_OFFSET_MS).toISOString();
}

/** Formats a UTC ISO instant as Asia/Seoul "yyyy-MM-dd HH:mm", for display. */
export function formatInSeoul(iso: string): string {
  const { date, time } = seoulWallClockFromIso(iso);
  return `${date} ${time}`;
}

/**
 * v2.14: grace period during which a non-admin can still edit/delete a game
 * record or undo a settlement/donation after recording it. Plain UTC-instant
 * math (createdAt is always a true UTC ISO instant), independent of the
 * Asia/Seoul wall-clock formatting above.
 */
export const EDIT_WINDOW_MS = 2 * 60 * 60 * 1000;

/** True if `createdAt` is still within the v2.14 non-admin edit window. */
export function isWithinEditWindow(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() <= EDIT_WINDOW_MS;
}

/**
 * v2.19: milliseconds left in the v2.14 non-admin edit window; 0 or negative
 * once it's expired. A pure function of `createdAt` and the current instant —
 * it doesn't schedule anything itself, so a UI that wants a live "1시간 23분
 * 남음" countdown has to re-call it on its own timer (see the games list row
 * for the pattern). `isWithinEditWindow` is left as its own function (rather
 * than redefined in terms of this one) since `actions.ts`'s server-side gate
 * depends on it and has no reason to change shape here.
 */
export function editWindowRemainingMs(createdAt: string): number {
  return EDIT_WINDOW_MS - (Date.now() - new Date(createdAt).getTime());
}

/**
 * v2.15: "2026-08-14" -> "2026-Q3". String-slice only, deliberately never
 * `new Date(date)` — that parses as UTC midnight and can shift the date (and
 * therefore the quarter) by a day, the same class of bug PRD §13.5 already
 * hit with custom stats ranges. Every `.date` in this app is already a plain
 * Asia/Seoul "yyyy-MM-dd" wall-clock string, so slicing is exact.
 */
export function quarterKeyOf(date: string): string {
  const year = date.slice(0, 4);
  const month = Number(date.slice(5, 7));
  const quarter = Math.ceil(month / 3);
  return `${year}-Q${quarter}`;
}

/** Current Asia/Seoul quarter key, e.g. "2026-Q3". */
export function currentQuarterKey(): string {
  return quarterKeyOf(todayInSeoul());
}

/** "2026-Q3" -> "2026년 3분기", for display. */
export function formatQuarterKey(key: string): string {
  const [year, q] = key.split("-Q");
  return `${year}년 ${q}분기`;
}

// ---------- v2.16: business-day redefinition (06:00-30:00) ----------
//
// This group's game nights routinely run past real midnight, so every
// "which day does this belong to" computation in the app (game dates,
// "오늘" filters/summaries, adjustment/settlement default dates, quarter
// boundaries) treats 06:00-29:59 wall-clock as one day, not the calendar
// day. A record made at 05:59 belongs to the *previous* calendar date; one
// made at 06:00 belongs to the current one. `nowInSeoul()` above is left
// untouched (true calendar date/time) because some callers genuinely need a
// real instant (e.g. the admin rollback screen's cutoff picker) — everything
// that means "game day" should go through the helpers below instead.
export const BUSINESS_DAY_START_HOUR = 6;

/**
 * Pure calendar-date arithmetic on a "yyyy-MM-dd" string, deliberately never
 * `new Date(date)` (see quarterKeyOf's comment above for why that parses as
 * UTC midnight and can shift by a day) — Date.UTC/getUTC* here are only used
 * as a day-counting scratchpad, never compared against a wall-clock instant.
 */
export function addDaysToIsoDate(date: string, days: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  const yy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** True calendar date + "HH:mm" -> business date, per the 06:00 rollover rule above. */
export function businessDateFromWallClock(date: string, time: string): string {
  const hour = Number(time.slice(0, 2));
  return hour >= BUSINESS_DAY_START_HOUR ? date : addDaysToIsoDate(date, -1);
}

/**
 * v2.18: the exact inverse of `businessDateFromWallClock` above — business
 * date + "HH:mm" -> the calendar date that time was actually on the clock.
 * Display-only (PRD §22): `games.date` is a *group key* (which game night a
 * row belongs to) and is correct as stored; `games.time` has always been the
 * real wall-clock reading. Concatenating them directly (`${date} ${time}`)
 * silently claims a moment that never happened for any row logged past real
 * midnight — e.g. a game logged at business date "2026-08-14", time "01:00"
 * actually happened on the calendar date 2026-08-15, not 2026-08-14. This
 * function recovers that real calendar date so display code can show the
 * instant that actually occurred instead of the grouping key.
 */
export function calendarDateFromBusinessDay(date: string, time: string): string {
  const hour = Number(time.slice(0, 2));
  return hour >= BUSINESS_DAY_START_HOUR ? date : addDaysToIsoDate(date, 1);
}

export interface GameWallClock {
  /** True calendar date "yyyy-MM-dd" the row's `time` actually occurred on — what display code should show. */
  date: string;
  /** "HH:mm", the stored value unchanged. Undefined for legacy rows that predate this field. */
  time?: string;
  /** True if the calendar date differs from the business date (the row was logged past real midnight). */
  crossedMidnight: boolean;
  /** The business date the row is grouped under (unchanged) — what a "게임 밤" badge should name. */
  businessDate: string;
}

/**
 * v2.18: derives the display-ready wall clock for one stored (`date`,
 * `time`) pair — every place that renders a single game/settlement row's
 * timestamp (as opposed to a day-level label — see PRD §22.4's table) should
 * go through this instead of concatenating the fields directly. A legacy row
 * with no `time` has no wall clock to recover, so it's returned as-is with
 * `crossedMidnight: false` — the business date is the only date available
 * for it either way, so there's nothing to reconcile or flag.
 */
export function gameWallClock(date: string, time?: string): GameWallClock {
  if (!time) {
    return { date, time: undefined, crossedMidnight: false, businessDate: date };
  }
  const calendarDate = calendarDateFromBusinessDay(date, time);
  return {
    date: calendarDate,
    time,
    crossedMidnight: calendarDate !== date,
    businessDate: date,
  };
}

/**
 * A UTC ISO instant (typically `createdAt`, which no app feature ever
 * rewrites) -> the business date that instant belongs to. v2.17's backfill
 * (`src/lib/backfill.ts`) is built entirely on this: re-deriving a row's
 * "correct" date from its immutable `createdAt` every time is what makes the
 * backfill idempotent, unlike shifting `date` by one day whenever `time` is
 * early (see PRD §20.2 for why that naive approach breaks on a second run).
 */
export function businessDateFromIso(iso: string): string {
  const { date, time } = seoulWallClockFromIso(iso);
  return businessDateFromWallClock(date, time);
}

/**
 * Current business date + true wall-clock time in Asia/Seoul. Use this (not
 * nowInSeoul()) wherever "now" means "which game day is this" — e.g. stamping
 * a newly-recorded game's `date`. The `time` returned is still the real
 * clock reading (e.g. "02:15"), never shifted; only `date` is remapped.
 */
export function nowInSeoulBusinessDay(): { date: string; time: string } {
  const { date, time } = nowInSeoul();
  return { date: businessDateFromWallClock(date, time), time };
}

/**
 * Minutes since the 06:00 business-day boundary, for ordering "HH:mm" times
 * that cross real midnight within one business day — e.g. a 01:30 game must
 * sort *after* a 22:00 game from the same game night, not before it. "06:00"
 * -> 0, "05:59" -> 1439.
 */
export function minutesSinceBusinessDayStart(time: string): number {
  const [hh, mm] = time.split(":").map(Number);
  return ((hh - BUSINESS_DAY_START_HOUR) * 60 + mm + 1440) % 1440;
}
