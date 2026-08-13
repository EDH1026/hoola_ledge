import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfYear,
  format,
} from "date-fns";
import { GameResult, GameType } from "./types";

export interface ParticipantLike {
  id: string;
  name: string;
  active: boolean;
}

export interface ParticipantStat {
  id: string;
  name: string;
  active: boolean;
  wins: number;
  losses: number;
  appearances: number; // times listed as attendee (includes wins/losses/others)
  winRate: number; // wins / (wins + losses), 0 if no decisive games
  netPoints: number; // wins - losses (raw point balance from games only)
}

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

  for (const g of games) {
    for (const attendeeId of g.attendeeIds) {
      ensure(attendeeId).appearances += 1;
    }
    ensure(g.winnerId).wins += 1;
    ensure(g.loserId).losses += 1;
  }

  for (const s of stats.values()) {
    s.netPoints = s.wins - s.losses;
    const decisive = s.wins + s.losses;
    s.winRate = decisive > 0 ? s.wins / decisive : 0;
  }

  return Array.from(stats.values()).sort((a, b) => b.netPoints - a.netPoints);
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

export function groupGamesByPeriod(
  games: GameResult[],
  grouping: PeriodGrouping
): PeriodBucket[] {
  const buckets = new Map<string, PeriodBucket>();

  const sorted = [...games].sort((a, b) => a.date.localeCompare(b.date));

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

export function filterGamesByPreset(
  games: GameResult[],
  preset: RangePreset
): GameResult[] {
  if (preset === "all") return games;
  const now = new Date();
  let days: number | null = null;
  if (preset === "7d") days = 7;
  else if (preset === "30d") days = 30;
  else if (preset === "90d") days = 90;

  if (preset === "year") {
    const yearStart = startOfYear(now);
    return games.filter((g) => new Date(g.date) >= yearStart);
  }

  if (days) {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - days);
    return games.filter((g) => new Date(g.date) >= cutoff);
  }

  return games;
}
