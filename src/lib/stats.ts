import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfYear,
  format,
} from "date-fns";
import { GameResult, GameType } from "./types";
import { activeGames } from "./games";

export interface ParticipantLike {
  id: string;
  name: string;
  active: boolean; // Participant.active (in/out of the roster) — unrelated to GameResult.active (soft-delete)
}

export interface ParticipantStat {
  id: string;
  name: string;
  active: boolean;
  wins: number;
  losses: number;
  appearances: number; // times listed as attendee (includes wins/losses/others)
  winRate: number; // wins / (wins + losses), 0 if no decisive games
  netPoints: number; // sum of points won minus points lost (uses each game's `points`, default 1)
}

/** Filters out soft-deleted (GameResult.active === false) games internally before aggregating. */
export function computeParticipantStats(
  participants: ParticipantLike[],
  games: GameResult[]
): ParticipantStat[] {
  const stats = new Map<string, ParticipantStat>();
  for (const p of participants) {
    stats.set(p.id, {
      id: p.id,
      name: p.name,
      active: p.active,
      wins: 0,
      losses: 0,
      appearances: 0,
      winRate: 0,
      netPoints: 0,
    });
  }

  const ensure = (id: string): ParticipantStat => {
    let s = stats.get(id);
    if (!s) {
      s = {
        id,
        name: "(삭제된 참가자)",
        active: false,
        wins: 0,
        losses: 0,
        appearances: 0,
        winRate: 0,
        netPoints: 0,
      };
      stats.set(id, s);
    }
    return s;
  };

  for (const g of activeGames(games)) {
    const points = g.points ?? 1;
    for (const attendeeId of g.attendeeIds) {
      ensure(attendeeId).appearances += 1;
    }
    ensure(g.winnerId).wins += 1;
    ensure(g.loserId).losses += 1;
    ensure(g.winnerId).netPoints += points;
    ensure(g.loserId).netPoints -= points;
  }

  for (const s of stats.values()) {
    const decisive = s.wins + s.losses;
    s.winRate = decisive > 0 ? s.wins / decisive : 0;
  }

  return Array.from(stats.values()).sort((a, b) => b.netPoints - a.netPoints);
}

export interface HeadToHeadEntry {
  opponentId: string;
  opponentName: string;
  pointsWon: number; // points this participant took FROM the opponent (won against them)
  pointsLost: number; // points this participant gave TO the opponent (lost to them)
}

/**
 * Per-opponent point breakdown for one participant. Only looks at each
 * game's winnerId/loserId — attendees who neither won nor lost that game
 * don't have any point movement in it, even if 3+ people were at the table.
 */
export function computeHeadToHead(
  participants: ParticipantLike[],
  games: GameResult[],
  participantId: string
): HeadToHeadEntry[] {
  const nameOf = new Map(participants.map((p) => [p.id, p.name]));
  const byOpponent = new Map<string, { won: number; lost: number }>();

  for (const g of activeGames(games)) {
    const points = g.points ?? 1;
    let opponentId: string | null = null;
    let delta: { won: number; lost: number } | null = null;
    if (g.winnerId === participantId) {
      opponentId = g.loserId;
      delta = { won: points, lost: 0 };
    } else if (g.loserId === participantId) {
      opponentId = g.winnerId;
      delta = { won: 0, lost: points };
    }
    if (!opponentId || !delta) continue;

    const entry = byOpponent.get(opponentId) ?? { won: 0, lost: 0 };
    entry.won += delta.won;
    entry.lost += delta.lost;
    byOpponent.set(opponentId, entry);
  }

  const net = (e: HeadToHeadEntry) => e.pointsWon - e.pointsLost;
  return Array.from(byOpponent.entries())
    .map(([opponentId, v]) => ({
      opponentId,
      opponentName: nameOf.get(opponentId) ?? "(삭제된 참가자)",
      pointsWon: v.won,
      pointsLost: v.lost,
    }))
    .sort((a, b) => net(b) - net(a));
}

export type PeriodGrouping = "day" | "week" | "month" | "year";

export interface PeriodBucket {
  key: string;
  label: string;
  start: Date;
  gameCount: number;
  wins: Record<string, number>;
  losses: Record<string, number>;
}

function bucketStart(date: Date, grouping: PeriodGrouping): Date {
  switch (grouping) {
    case "day":
      return startOfDay(date);
    case "week":
      return startOfWeek(date, { weekStartsOn: 1 });
    case "month":
      return startOfMonth(date);
    case "year":
      return startOfYear(date);
  }
}

function bucketLabel(date: Date, grouping: PeriodGrouping): string {
  switch (grouping) {
    case "day":
      return format(date, "MM/dd");
    case "week":
      return format(date, "yyyy-'W'ww");
    case "month":
      return format(date, "yyyy-MM");
    case "year":
      return format(date, "yyyy");
  }
}

/** Filters out soft-deleted (GameResult.active === false) games internally before bucketing. */
export function groupGamesByPeriod(
  games: GameResult[],
  grouping: PeriodGrouping
): PeriodBucket[] {
  const buckets = new Map<string, PeriodBucket>();

  const sorted = [...activeGames(games)].sort((a, b) => a.date.localeCompare(b.date));

  for (const g of sorted) {
    const d = new Date(g.date);
    const start = bucketStart(d, grouping);
    const key = start.toISOString();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        label: bucketLabel(d, grouping),
        start,
        gameCount: 0,
        wins: {},
        losses: {},
      };
      buckets.set(key, bucket);
    }
    bucket.gameCount += 1;
    bucket.wins[g.winnerId] = (bucket.wins[g.winnerId] ?? 0) + 1;
    bucket.losses[g.loserId] = (bucket.losses[g.loserId] ?? 0) + 1;
  }

  return Array.from(buckets.values()).sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );
}

export type GameTypeFilter = GameType | "all";

export function filterGamesByType(
  games: GameResult[],
  gameType: GameTypeFilter
): GameResult[] {
  if (gameType === "all") return games;
  return games.filter((g) => g.gameType === gameType);
}

export type RangePreset = "7d" | "30d" | "90d" | "year" | "all";

/**
 * Generic date-range filter — works on anything with a `.date` string, not
 * just games, so the same preset logic can filter Settlement[] (e.g. for the
 * donation ranking) without duplicating the date math.
 */
export function filterByDatePreset<T extends { date: string }>(
  items: T[],
  preset: RangePreset
): T[] {
  if (preset === "all") return items;
  const now = new Date();
  let days: number | null = null;
  if (preset === "7d") days = 7;
  else if (preset === "30d") days = 30;
  else if (preset === "90d") days = 90;

  if (preset === "year") {
    const yearStart = startOfYear(now);
    return items.filter((it) => new Date(it.date) >= yearStart);
  }

  if (days) {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - days);
    return items.filter((it) => new Date(it.date) >= cutoff);
  }

  return items;
}

/** @deprecated use filterByDatePreset — kept as a thin alias so existing GameResult[] call sites don't need to change. */
export const filterGamesByPreset = filterByDatePreset<GameResult>;
