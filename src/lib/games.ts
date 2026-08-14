import { GameResult } from "./types";
import { minutesSinceBusinessDayStart } from "./time";

/** A game is active unless explicitly soft-deleted; absent field = active (legacy records). */
export function isActiveGame(g: GameResult): boolean {
  return g.active !== false;
}

/** Filters out soft-deleted games. Use for anything that computes balances, stats, or display lists — NOT for the admin rollback preview, which must see soft-deleted rows too. */
export function activeGames(games: GameResult[]): GameResult[] {
  return games.filter(isActiveGame);
}

// Sort key for games played on the same (business) day: by wall-clock time
// first (legacy records with no `time` sort first, matching the
// createdAt-based ordering they already had before this field existed), then
// by createdAt to break ties deterministically. Exported so any list that
// displays games alongside their N차전 number can sort with the exact same
// key — otherwise display order and the numbers shown next to each row could
// disagree.
//
// v2.16: the time component sorts by *minutes since the 06:00 business-day
// boundary*, not the raw "HH:mm" string — a game logged at 01:30 belongs to
// the same game night as one logged at 22:00 earlier that evening and must
// sort after it, not before (a plain string compare would put "01:30" first).
export function withinDayKey(g: GameResult): string {
  const minuteKey = g.time ? minutesSinceBusinessDayStart(g.time) + 1 : 0;
  return `${String(minuteKey).padStart(4, "0")}|${g.createdAt}`;
}

/**
 * Maps each game id to its 1-based "N차전" (Nth game of the day) number.
 *
 * Grouped by calendar date only, mixing all game types together — a single
 * game night usually mixes 훌라/시타델/젝스님트, and "3차전" is meant to read
 * as "the 3rd game we played that night," not "the 3rd 훌라 game." Computed
 * on read from the full game list (not persisted), so it stays correct as
 * games are added, edited, or deleted.
 */
export function computeDailySequenceNumbers(
  games: GameResult[]
): Map<string, number> {
  const byDate = new Map<string, GameResult[]>();
  for (const g of activeGames(games)) {
    const list = byDate.get(g.date);
    if (list) list.push(g);
    else byDate.set(g.date, [g]);
  }

  const result = new Map<string, number>();
  for (const list of byDate.values()) {
    const sorted = [...list].sort((a, b) =>
      withinDayKey(a).localeCompare(withinDayKey(b))
    );
    sorted.forEach((g, i) => result.set(g.id, i + 1));
  }
  return result;
}
