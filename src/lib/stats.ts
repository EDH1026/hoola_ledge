import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfYear,
  format,
} from "date-fns";
import { GameResult, GameType, GAME_TYPES } from "./types";
import { activeGames } from "./games";
import { todayInSeoul } from "./time";

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

// ---------- v2.10: per-range point totals (PRD 9.2) ----------

export interface ParticipantPointTotal {
  id: string;
  name: string;
  pointsWon: number;
  pointsLost: number;
  netPoints: number;
}

interface NameLookup {
  id: string;
  name: string;
}

/**
 * Points won/lost/net per participant within whatever `games` slice the
 * caller passes in (e.g. a year/month/day-filtered games list) — used by the
 * /games list to show a per-participant breakdown for the currently applied
 * filter, not a career total.
 */
export function computeParticipantPointTotals(
  participants: NameLookup[],
  games: GameResult[]
): ParticipantPointTotal[] {
  const nameOf = new Map(participants.map((p) => [p.id, p.name]));
  const totals = new Map<string, { won: number; lost: number }>();

  for (const g of activeGames(games)) {
    const points = g.points ?? 1;
    const w = totals.get(g.winnerId) ?? { won: 0, lost: 0 };
    w.won += points;
    totals.set(g.winnerId, w);
    const l = totals.get(g.loserId) ?? { won: 0, lost: 0 };
    l.lost += points;
    totals.set(g.loserId, l);
  }

  return Array.from(totals.entries())
    .map(([id, v]) => ({
      id,
      name: nameOf.get(id) ?? "(삭제된 참가자)",
      pointsWon: v.won,
      pointsLost: v.lost,
      netPoints: v.won - v.lost,
    }))
    .sort((a, b) => b.netPoints - a.netPoints);
}

// ---------- v2.10: esports-style stats/dashboard (PRD 9.3) ----------
//
// Shared building block: a participant's decisive (won or lost, never just
// attended-as-bystander) games, oldest first. `games` is expected to already
// be active-filtered by the caller of these higher-level functions (each one
// below filters via activeGames() itself, so this stays correct even if a
// caller passes the raw unfiltered list).
function decisiveGamesForParticipant(
  participantId: string,
  games: GameResult[]
): GameResult[] {
  return games
    .filter((g) => g.winnerId === participantId || g.loserId === participantId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export interface RecentFormEntry {
  id: string;
  name: string;
  results: ("W" | "L")[]; // most recent first
}

/** Each participant's last `limit` decisive results, most recent first. Bystander-only appearances (no win/loss in that game) never appear in the sequence. */
export function computeRecentForm(
  participants: ParticipantLike[],
  games: GameResult[],
  limit = 5
): RecentFormEntry[] {
  const active = activeGames(games);
  return participants.map((p) => {
    const chronological = decisiveGamesForParticipant(p.id, active);
    const recent = chronological.slice(-limit).reverse();
    return {
      id: p.id,
      name: p.name,
      results: recent.map((g) => (g.winnerId === p.id ? "W" : "L")) as ("W" | "L")[],
    };
  });
}

export interface StreakEntry {
  id: string;
  name: string;
  type: "W" | "L" | null; // null = no decisive games at all
  length: number;
}

/** Each participant's current (still-active) win or loss streak, ending at their most recent decisive game. */
export function computeCurrentStreaks(
  participants: ParticipantLike[],
  games: GameResult[]
): StreakEntry[] {
  const active = activeGames(games);
  return participants.map((p) => {
    const chronological = decisiveGamesForParticipant(p.id, active);
    if (chronological.length === 0) return { id: p.id, name: p.name, type: null, length: 0 };

    const mostRecentType: "W" | "L" =
      chronological[chronological.length - 1].winnerId === p.id ? "W" : "L";
    let length = 0;
    for (let i = chronological.length - 1; i >= 0; i--) {
      const g = chronological[i];
      const type: "W" | "L" = g.winnerId === p.id ? "W" : "L";
      if (type !== mostRecentType) break;
      length++;
    }
    return { id: p.id, name: p.name, type: mostRecentType, length };
  });
}

// A player counts as "hot"/"cold" only with at least this many decisive games
// in the recent window — otherwise a single lucky/unlucky game would produce
// a misleadingly strong signal (e.g. 1-0 in the last two weeks reads as a
// meaningless "100% recent win rate").
const HOT_COLD_MIN_RECENT_GAMES = 3;
// "Recent form" = the last two weeks. Chosen over "last N games" because this
// is a casual group that doesn't play on a fixed cadence — a day-based window
// reads more naturally as "how have they been doing lately" than a game-count
// window would for a group that might play 10 games one weekend and none for
// the next two.
const HOT_COLD_RECENT_WINDOW_DAYS = 14;
const HOT_COLD_TOP_N = 3;

export interface HotColdEntry {
  id: string;
  name: string;
  recentWinRate: number;
  careerWinRate: number;
  delta: number; // recentWinRate - careerWinRate
  recentGames: number; // decisive games in the recent window
}

/**
 * Players trending up ("hot") or down ("cold") relative to their own career
 * win rate. See HOT_COLD_MIN_RECENT_GAMES / HOT_COLD_RECENT_WINDOW_DAYS above
 * for the minimum-sample-size guard this requires.
 */
export function computeHotColdPlayers(
  participants: ParticipantLike[],
  games: GameResult[]
): { hot: HotColdEntry[]; cold: HotColdEntry[] } {
  const active = activeGames(games);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - HOT_COLD_RECENT_WINDOW_DAYS);
  const recentGames = active.filter((g) => new Date(g.date) >= cutoff);

  const careerStats = computeParticipantStats(participants, active);
  const recentStats = computeParticipantStats(participants, recentGames);
  const recentById = new Map(recentStats.map((s) => [s.id, s]));

  const entries: HotColdEntry[] = [];
  for (const c of careerStats) {
    const r = recentById.get(c.id);
    const recentDecisive = (r?.wins ?? 0) + (r?.losses ?? 0);
    if (!r || recentDecisive < HOT_COLD_MIN_RECENT_GAMES) continue;
    entries.push({
      id: c.id,
      name: c.name,
      recentWinRate: r.winRate,
      careerWinRate: c.winRate,
      delta: r.winRate - c.winRate,
      recentGames: recentDecisive,
    });
  }

  const hot = entries
    .filter((e) => e.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, HOT_COLD_TOP_N);
  const cold = entries
    .filter((e) => e.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, HOT_COLD_TOP_N);

  return { hot, cold };
}

export interface TodaySummary {
  date: string; // yyyy-MM-dd, Asia/Seoul "today"
  gameCount: number;
  topWinner: { id: string; name: string; wins: number } | null;
}

/** Summary of today's (Asia/Seoul) games — for the dashboard's "오늘의 요약". */
export function computeTodaySummary(
  participants: ParticipantLike[],
  games: GameResult[]
): TodaySummary {
  const today = todayInSeoul();
  const todaysGames = activeGames(games).filter((g) => g.date === today);
  const stats = computeParticipantStats(participants, todaysGames).filter(
    (s) => s.wins > 0
  );
  const topWinner = stats.length
    ? stats.reduce((best, s) => (s.wins > best.wins ? s : best))
    : null;

  return {
    date: today,
    gameCount: todaysGames.length,
    topWinner: topWinner ? { id: topWinner.id, name: topWinner.name, wins: topWinner.wins } : null,
  };
}

// ---------- v2.10: tier badges ----------

export type Tier =
  | "unranked"
  | "bronze"
  | "silver"
  | "gold"
  | "platinum"
  | "diamond"
  | "challenger";

// Needs at least this many decisive career games before a win-rate-based tier
// means anything — otherwise a 1-0 record would misleadingly read as
// "Challenger". Below this, a participant is "Unranked" (LoL's "placement
// matches not complete" concept).
const TIER_MIN_DECISIVE_GAMES = 3;

/** Assigns a LoL-style tier from career win rate. Cutoffs are an editorial judgment call, not derived from any real ranked distribution. */
export function computeTier(winRate: number, decisiveGames: number): Tier {
  if (decisiveGames < TIER_MIN_DECISIVE_GAMES) return "unranked";
  if (winRate < 0.35) return "bronze";
  if (winRate < 0.45) return "silver";
  if (winRate < 0.55) return "gold";
  if (winRate < 0.65) return "platinum";
  if (winRate < 0.75) return "diamond";
  return "challenger";
}

// ---------- v2.10: head-to-head matrix, nemesis/victim, per-game-type ----------

export interface HeadToHeadMatrixCell {
  rowId: string;
  colId: string;
  netPoints: number; // rowId's pointsWon - pointsLost against colId
  games: number; // decisive games between the pair
}

/** Every ordered pair's net points and game count, for a full participant x participant grid. Cells for pairs that never played each other still appear, with netPoints/games both 0. */
export function computeHeadToHeadMatrix(
  participants: NameLookup[],
  games: GameResult[]
): HeadToHeadMatrixCell[] {
  const pairs = new Map<string, { won: number; lost: number; games: number }>();
  const key = (a: string, b: string) => `${a} ${b}`;

  for (const g of activeGames(games)) {
    const points = g.points ?? 1;
    const wKey = key(g.winnerId, g.loserId);
    const w = pairs.get(wKey) ?? { won: 0, lost: 0, games: 0 };
    w.won += points;
    w.games += 1;
    pairs.set(wKey, w);

    const lKey = key(g.loserId, g.winnerId);
    const l = pairs.get(lKey) ?? { won: 0, lost: 0, games: 0 };
    l.lost += points;
    l.games += 1;
    pairs.set(lKey, l);
  }

  const cells: HeadToHeadMatrixCell[] = [];
  for (const row of participants) {
    for (const col of participants) {
      if (row.id === col.id) continue;
      const v = pairs.get(key(row.id, col.id));
      cells.push({
        rowId: row.id,
        colId: col.id,
        netPoints: v ? v.won - v.lost : 0,
        games: v ? v.games : 0,
      });
    }
  }
  return cells;
}

export interface NemesisVictimEntry {
  id: string;
  name: string;
  nemesis: { opponentId: string; opponentName: string; pointsLost: number } | null; // opponent this participant has lost the most points to
  victim: { opponentId: string; opponentName: string; pointsWon: number } | null; // opponent this participant has taken the most points from
}

/** Each participant's toughest opponent (천적) and easiest opponent (밥), from computeHeadToHead. */
export function computeNemesisAndVictim(
  participants: ParticipantLike[],
  games: GameResult[]
): NemesisVictimEntry[] {
  return participants.map((p) => {
    const h2h = computeHeadToHead(participants, games, p.id);
    const nemesisEntry = h2h
      .filter((e) => e.pointsLost > 0)
      .sort((a, b) => b.pointsLost - a.pointsLost)[0];
    const victimEntry = h2h
      .filter((e) => e.pointsWon > 0)
      .sort((a, b) => b.pointsWon - a.pointsWon)[0];
    return {
      id: p.id,
      name: p.name,
      nemesis: nemesisEntry
        ? {
            opponentId: nemesisEntry.opponentId,
            opponentName: nemesisEntry.opponentName,
            pointsLost: nemesisEntry.pointsLost,
          }
        : null,
      victim: victimEntry
        ? {
            opponentId: victimEntry.opponentId,
            opponentName: victimEntry.opponentName,
            pointsWon: victimEntry.pointsWon,
          }
        : null,
    };
  });
}

export interface GameTypeParticipantStat {
  id: string;
  name: string;
  gameType: GameType;
  wins: number;
  losses: number;
  winRate: number;
  netPoints: number;
}

/** Per-participant record broken down by game type (the "champion mastery" view) — only includes rows where the participant has at least one decisive game of that type. */
export function computeGameTypeStats(
  participants: ParticipantLike[],
  games: GameResult[]
): GameTypeParticipantStat[] {
  const result: GameTypeParticipantStat[] = [];
  for (const gt of GAME_TYPES) {
    const gamesOfType = filterGamesByType(games, gt);
    const stats = computeParticipantStats(participants, gamesOfType);
    for (const s of stats) {
      if (s.wins + s.losses === 0) continue;
      result.push({
        id: s.id,
        name: s.name,
        gameType: gt,
        wins: s.wins,
        losses: s.losses,
        winRate: s.winRate,
        netPoints: s.netPoints,
      });
    }
  }
  return result;
}

// ---------- v2.10: records / hall of fame ----------

export interface RecordHolder {
  id: string;
  name: string;
  value: number;
}

export interface SingleGameRecord {
  gameId: string;
  winnerId: string;
  winnerName: string;
  loserId: string;
  loserName: string;
  points: number;
  date: string;
}

export interface DayWinsRecord {
  id: string;
  name: string;
  date: string;
  wins: number;
}

export interface RecordsSummary {
  longestWinStreak: RecordHolder | null;
  longestLossStreak: RecordHolder | null;
  highestSingleGamePoints: SingleGameRecord | null;
  mostWinsInOneDay: DayWinsRecord | null;
  mostAppearances: RecordHolder | null;
}

/**
 * Career "hall of fame" records — deliberately always computed from the full
 * active game list regardless of any period/type filter the caller might
 * otherwise apply elsewhere on the page, since "longest win streak ever"
 * stops meaning what it says the moment it's silently scoped to a filter.
 * Callers should label this section as career-wide in the UI.
 */
export function computeRecords(
  participants: ParticipantLike[],
  games: GameResult[]
): RecordsSummary {
  const active = activeGames(games);
  const nameOf = new Map(participants.map((p) => [p.id, p.name]));
  const nameFor = (id: string) => nameOf.get(id) ?? "(삭제된 참가자)";

  let longestWinStreak: RecordHolder | null = null;
  let longestLossStreak: RecordHolder | null = null;

  for (const p of participants) {
    const chronological = decisiveGamesForParticipant(p.id, active);
    let currentType: "W" | "L" | null = null;
    let currentLength = 0;
    let bestWin = 0;
    let bestLoss = 0;
    for (const g of chronological) {
      const type: "W" | "L" = g.winnerId === p.id ? "W" : "L";
      if (type === currentType) {
        currentLength++;
      } else {
        currentType = type;
        currentLength = 1;
      }
      if (type === "W") bestWin = Math.max(bestWin, currentLength);
      else bestLoss = Math.max(bestLoss, currentLength);
    }
    if (bestWin > 0 && (!longestWinStreak || bestWin > longestWinStreak.value)) {
      longestWinStreak = { id: p.id, name: p.name, value: bestWin };
    }
    if (bestLoss > 0 && (!longestLossStreak || bestLoss > longestLossStreak.value)) {
      longestLossStreak = { id: p.id, name: p.name, value: bestLoss };
    }
  }

  let highestSingleGamePoints: SingleGameRecord | null = null;
  for (const g of active) {
    const points = g.points ?? 1;
    if (!highestSingleGamePoints || points > highestSingleGamePoints.points) {
      highestSingleGamePoints = {
        gameId: g.id,
        winnerId: g.winnerId,
        winnerName: nameFor(g.winnerId),
        loserId: g.loserId,
        loserName: nameFor(g.loserId),
        points,
        date: g.date,
      };
    }
  }

  const winsByDay = new Map<string, number>(); // key: winnerId|date
  for (const g of active) {
    const key = `${g.winnerId}|${g.date}`;
    winsByDay.set(key, (winsByDay.get(key) ?? 0) + 1);
  }
  let mostWinsInOneDay: DayWinsRecord | null = null;
  for (const [key, wins] of winsByDay) {
    if (!mostWinsInOneDay || wins > mostWinsInOneDay.wins) {
      const [id, date] = key.split("|");
      mostWinsInOneDay = { id, name: nameFor(id), date, wins };
    }
  }

  const stats = computeParticipantStats(participants, active);
  const mostAppearances = stats.reduce<RecordHolder | null>((best, s) => {
    if (s.appearances === 0) return best;
    if (!best || s.appearances > best.value) {
      return { id: s.id, name: s.name, value: s.appearances };
    }
    return best;
  }, null);

  return {
    longestWinStreak,
    longestLossStreak,
    highestSingleGamePoints,
    mostWinsInOneDay,
    mostAppearances,
  };
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
