// v2.17 — retroactively applies the v2.16 business-day rule (06:00-30:00,
// see time.ts) to rows that were auto-recorded *before* v2.16 shipped and
// therefore still carry a raw calendar `date`. See PRD §20 for the full
// diagnosis and design rationale.
//
// This is a plain, DB-agnostic decision function on purpose: it's shared by
// scripts/backfill-business-day.ts (which owns all the Supabase I/O) and by
// scripts/verify-business-day.ts (which exercises it with no DB at all). It
// lives in its own module rather than time.ts because it's domain logic
// about *migrating stored rows*, not a general time utility — time.ts stays
// focused on pure clock/calendar math the whole app reads from.

import { seoulWallClockFromIso, businessDateFromWallClock } from "./time";

export type BackfillVerdict =
  | { action: "update"; date: string; time?: string; reason: string }
  | { action: "skip"; reason: "already-correct" | "manually-edited" };

/**
 * Decides what (if anything) a single row's `date`/`time` should become,
 * based on its immutable `createdAt` — never by shifting the stored `date`
 * itself, which would not be idempotent (PRD §20.2: a row already correctly
 * business-dated by v2.16 would get shifted a *second* time on a re-run).
 *
 * Three-way guard so an admin's manual §11 correction is never clobbered:
 *
 * 1. `row.date` still equals the raw Seoul calendar date implied by
 *    `createdAt` -> this row was auto-recorded before v2.16 existed and has
 *    never been touched since. Safe to (re)compute from `createdAt`.
 * 2. `row.date` already equals the *business* date implied by `createdAt`
 *    (and isn't case 1) -> recorded after v2.16 shipped, already correct.
 *    Skipping here (rather than "updating" to the same value) is what makes
 *    a second run of the backfill report zero updates.
 * 3. Neither -> `row.date` doesn't match what either the raw calendar date
 *    or the business date implied by `createdAt` would be, so it was very
 *    likely set by hand via the admin edit screen (PRD §11/§15). Never
 *    overwritten; reported separately so a human can eyeball it.
 */
export function planBusinessDayBackfill(row: {
  date: string;
  time?: string | null;
  createdAt: string;
}): BackfillVerdict {
  const seoul = seoulWallClockFromIso(row.createdAt);
  const correct = businessDateFromWallClock(seoul.date, seoul.time);

  if (row.date === seoul.date) {
    if (correct === row.date) {
      return { action: "skip", reason: "already-correct" };
    }
    return {
      action: "update",
      date: correct,
      reason: "pre-v2.16 auto-recorded row still on its raw calendar date",
      ...(row.time ? {} : { time: seoul.time }),
    };
  }

  if (row.date === correct) {
    return { action: "skip", reason: "already-correct" };
  }

  return { action: "skip", reason: "manually-edited" };
}
