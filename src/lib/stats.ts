import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfYear,
  format,
} from "date-fns";
import { GameResult, GameType } from "./types";
import { activeGames } from "./games";
import { todayInSeoul, quarterKeyOf, addDaysToIsoDate } from "./time";

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
  winRate: number; // 승률A: wins / (wins + losses), 0 if no decisive games
  winRateB: number; // 승률B: wins / appearances, 0 if no appearances
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
      winRateB: 0,
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
        winRateB: 0,
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
    s.winRate = decisive > 0 ? s.wins / decisive : 0; // 승률A
    s.winRateB = s.appearances > 0 ? s.wins / s.appearances : 0; // 승률B
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
  // String-compared against a Seoul business-date cutoff, not new Date()
  // arithmetic — see filterByDatePreset's comment for why: a UTC-parsed
  // Date comparison can shift this window's boundary by up to a day.
  const cutoff = addDaysToIsoDate(todayInSeoul(), -(HOT_COLD_RECENT_WINDOW_DAYS - 1));
  const recentGames = active.filter((g) => g.date >= cutoff);

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

export interface RecentGameDayWinner {
  id: string;
  name: string;
  netPoints: number; // this day's pointsWon - pointsLost for this participant
}

export interface RecentGameDaySummary {
  date: string; // yyyy-MM-dd business date (§ v2.16 06:00-30:00 day)
  gameCount: number;
  topWinners: RecentGameDayWinner[]; // every participant tied at the day's max net points (공동 1위)
  margin: number; // 득실차 — the max net points value shared by topWinners
}

const RECENT_GAME_DAYS_COUNT = 3;

/**
 * The most recent (up to 3) business dates that actually have an active
 * game, most recent first — days with zero games are skipped entirely rather
 * than shown as empty. Replaces computeTodaySummary/TodaySummary (v2.16):
 * "오늘의 요약" only ever showed anything on days someone actually played, so
 * this generalizes it to "however many recent game days" instead of being
 * blank whenever today itself has no games yet.
 *
 * Each day's "최다 승자" is ranked by that day's net points (points-weighted
 * pointsWon - pointsLost), not win count, so a tie (공동 1위) and the
 * displayed 득실차 always describe the same number.
 */
export function computeRecentGameDaysSummary(
  participants: ParticipantLike[],
  games: GameResult[]
): RecentGameDaySummary[] {
  const active = activeGames(games);
  const byDate = new Map<string, GameResult[]>();
  for (const g of active) {
    const list = byDate.get(g.date);
    if (list) list.push(g);
    else byDate.set(g.date, [g]);
  }

  const dates = Array.from(byDate.keys())
    .sort((a, b) => b.localeCompare(a))
    .slice(0, RECENT_GAME_DAYS_COUNT);

  const nameOf = new Map(participants.map((p) => [p.id, p.name]));
  const nameFor = (id: string) => nameOf.get(id) ?? "(삭제된 참가자)";

  return dates.map((date) => {
    const dayGames = byDate.get(date)!;
    const net = new Map<string, number>();
    for (const g of dayGames) {
      const points = g.points ?? 1;
      net.set(g.winnerId, (net.get(g.winnerId) ?? 0) + points);
      net.set(g.loserId, (net.get(g.loserId) ?? 0) - points);
    }
    const maxNet = Math.max(...net.values());
    const topWinners = Array.from(net.entries())
      .filter(([, n]) => n === maxNet)
      .map(([id, n]) => ({ id, name: nameFor(id), netPoints: n }));

    return { date, gameCount: dayGames.length, topWinners, margin: maxNet };
  });
}

// ---------- v2.15: quarterly performance-index tiers ----------
//
// Replaces the old win-rate-cutoff computeTier() (see PRD §16.1 for why: it
// ignored table size, threw away "draw" games, ignored points, and had no
// sample-size correction). The new design is a per-quarter, per-game-type
// rating built from each game's *expected* win/loss (1/attendeeCount) rather
// than a raw win rate — see PRD §16.2-§16.6 for the full derivation and the
// Monte Carlo simulation that picked every constant below. Do not tune these
// values without re-running that simulation; they're the whole point of the
// exercise (PRD §16.6: SCALE=500 specifically trades away sharper separation
// in low-sample game types to avoid tiers becoming a coin flip there).

export type Tier =
  | "unranked"
  | "bronze"
  | "silver"
  | "gold"
  | "platinum"
  | "diamond"
  | "master"
  | "challenger";

const TIER_ORDER: Exclude<Tier, "unranked">[] = [
  "bronze",
  "silver",
  "gold",
  "platinum",
  "diamond",
  "master",
  "challenger",
];

// Bayesian-shrinkage strength: E0 = 2/tau^2 for an assumed prior stddev of
// PERF (see §16.3) of tau=0.5. Larger E0 = more games needed before TR moves
// far from 1000.
export const TIER_E0 = 8;
// Soft-reset carryover weight from the previous quarter (PRD §16.4) — picked
// because pure reset (carryover=0) produced much worse skill/tier rank
// correlation in low-sample game types (simulated: 0.578 -> 0.712 for
// Citadels, 0.396 -> 0.533 for 6nimmt) while still resetting most of the way
// each quarter.
export const TIER_CARRYOVER = 0.35;
// TR = 1000 +/- SCALE * perfMix * k. 500 (not a larger value) is deliberate:
// simulated at 800 it separates thinly-sampled game types beautifully, but
// also puts two equally-skilled players at opposite tiers 58% of the time —
// see PRD §16.6's scale comparison table.
export const TIER_SCALE = 500;
// Below this effective sample weight (~9 games), a participant is "배치 중"
// (placement) rather than assigned a tier at all. Exported so the UI can
// render a placement progress bar (weight / TIER_MIN_WEIGHT) and the
// verification script can assert the gate directly.
export const TIER_MIN_WEIGHT = 2.0;
// Six TR boundaries carving seven bins (bronze..challenger) — see the table
// in PRD §16.5. Index i => "TR below TIER_CUTS[i] lands in TIER_ORDER[i]".
export const TIER_CUTS = [820, 910, 1000, 1090, 1180, 1270];

function tierFromTR(tr: number): Tier {
  for (let i = 0; i < TIER_CUTS.length; i++) {
    if (tr < TIER_CUTS[i]) return TIER_ORDER[i];
  }
  return TIER_ORDER[TIER_ORDER.length - 1]; // challenger
}

export interface TierRow {
  id: string;
  name: string;
  tier: Tier;
  tr: number;
  winIndex: number; // WI = actual points won / expected points won
  lossIndex: number; // LI = actual points lost / expected points lost (lower is better)
  perf: number; // perfMix — WI - LI after carryover blending, this quarter's contribution to next quarter's prior
  confidence: number; // k, 0..1 — how much this quarter's own data (vs. prior) drives TR
  games: number; // games played (attended) this quarter, of the selected type
  weight: number; // wTotal — effective sample weight (this quarter's E_w plus carried-over prior), what TIER_MIN_WEIGHT gates on
  prevTier: Tier | null; // this participant's tier at the end of the previous quarter (in the fold sequence) — null only for their very first quarter
}

interface QuarterAccumulator {
  expectedWins: number; // E_w = sum(1/attendeeCount) over attended games
  expectedPoints: number; // E_p = sum(points * 1/attendeeCount) over attended games
  wonPoints: number; // W_p = sum(points) over games this participant won
  lostPoints: number; // L_p = sum(points) over games this participant lost
  gameCount: number; // raw count of games attended, for display ("배치 중 (n판)")
}

function emptyAccumulator(): QuarterAccumulator {
  return { expectedWins: 0, expectedPoints: 0, wonPoints: 0, lostPoints: 0, gameCount: 0 };
}

/**
 * Per-quarter, per-game-type tiers built from expected-value-adjusted
 * performance (PRD §16). `gameType: "all"` pools every game type together
 * (the largest sample, used as the "headline" tier). Quarters are folded in
 * chronological order so each quarter's rating carries TIER_CARRYOVER of the
 * previous quarter's (perf, weight) as a Bayesian prior — including for
 * participants who didn't play at all that quarter, which is what makes an
 * inactive quarter decay TR back toward 1000 instead of freezing it.
 *
 * Only returns quarters that actually contain at least one (active,
 * type-matching) game — a quarter with zero games everywhere isn't part of
 * the fold at all, so callers default to the current quarter and fall back
 * to the latest quarter present in the returned map.
 */
export function computeQuarterlyTiers(
  participants: ParticipantLike[],
  games: GameResult[],
  gameType: GameTypeFilter
): Map<string, TierRow[]> {
  const active = activeGames(games);
  const scoped = gameType === "all" ? active : filterGamesByType(active, gameType);

  const gamesByQuarter = new Map<string, GameResult[]>();
  for (const g of scoped) {
    const key = quarterKeyOf(g.date);
    const list = gamesByQuarter.get(key);
    if (list) list.push(g);
    else gamesByQuarter.set(key, [g]);
  }
  // "yyyy-Qn" sorts lexicographically in chronological order (4-digit year,
  // single-digit quarter), so no date parsing is needed here either.
  const quarters = Array.from(gamesByQuarter.keys()).sort();

  const result = new Map<string, TierRow[]>();
  const prior = new Map<string, { perf: number; weight: number; tier: Tier | null }>();

  for (const quarter of quarters) {
    const quarterGames = gamesByQuarter.get(quarter)!;

    const acc = new Map<string, QuarterAccumulator>();
    const ensure = (id: string): QuarterAccumulator => {
      let a = acc.get(id);
      if (!a) {
        a = emptyAccumulator();
        acc.set(id, a);
      }
      return a;
    };
    for (const g of quarterGames) {
      const n = g.attendeeIds.length;
      if (n === 0) continue;
      const e = 1 / n;
      const points = g.points ?? 1;
      for (const attendeeId of g.attendeeIds) {
        const a = ensure(attendeeId);
        a.expectedWins += e;
        a.expectedPoints += points * e;
        a.gameCount += 1;
      }
      ensure(g.winnerId).wonPoints += points;
      ensure(g.loserId).lostPoints += points;
    }

    const rows: TierRow[] = [];
    for (const p of participants) {
      const a = acc.get(p.id) ?? emptyAccumulator();
      const winIndex = a.expectedPoints > 0 ? a.wonPoints / a.expectedPoints : 0;
      const lossIndex = a.expectedPoints > 0 ? a.lostPoints / a.expectedPoints : 0;
      const perf = winIndex - lossIndex;

      const prev = prior.get(p.id);
      const wPrev = prev?.weight ?? 0;
      const perfPrev = prev?.perf ?? 0;
      const prevTier = prev?.tier ?? null;

      const priorWeight = TIER_CARRYOVER * wPrev;
      const weight = a.expectedWins + priorWeight;
      // When weight is 0 (never played, ever, as of this quarter) there's
      // nothing to mix — perfMix stays 0 rather than dividing 0/0.
      const perfMix =
        weight > 0 ? (perf * a.expectedWins + perfPrev * priorWeight) / weight : 0;
      const confidence = weight / (weight + TIER_E0);
      const tr = 1000 + TIER_SCALE * perfMix * confidence;
      const tier: Tier = weight < TIER_MIN_WEIGHT ? "unranked" : tierFromTR(tr);

      rows.push({
        id: p.id,
        name: p.name,
        tier,
        tr,
        winIndex,
        lossIndex,
        perf: perfMix,
        confidence,
        games: a.gameCount,
        weight,
        prevTier,
      });

      prior.set(p.id, { perf: perfMix, weight, tier });
    }

    rows.sort((a, b) => b.tr - a.tr);
    result.set(quarter, rows);
  }

  return result;
}

// ---------- v2.15: style map (PRD §16.8) — rolling 90-day 2-axis scatter ----------
//
// A completely separate representation from the tier system above: no
// shrinkage, no carryover, no sample-size gate, and a rolling 90-day window
// instead of calendar quarters. Individual "play style" badges were
// considered (and briefly built) but the PRD settled on expressing style
// only through this scatter plot, not a per-person tag.

export interface StyleMapPoint {
  id: string;
  name: string;
  engagement: number; // ENG = (WI + LI) / 2, 1.00 = 기대치
  performance: number; // PERF = WI - LI, 0 = 본전
  winIndex: number;
  lossIndex: number;
  games: number; // 최근 90일 참여 판수 (점 크기/투명도에 사용)
}

/**
 * Raw (unshrunk, ungated) win/loss index over the trailing 90 days, per PRD
 * §16.8. Participants with zero games in the window are excluded entirely —
 * a 0-game point plotted at (1.00, 0) would read as a false "doing fine"
 * signal rather than "no data".
 *
 * Axis independence: with W = winIndex and L = lossIndex, ENG = (W+L)/2 and
 * PERF = W-L are uncorrelated because Cov(W+L, W-L) = Var(W) - Var(L) = 0
 * whenever E[W] = E[L] (true here: both average to 1/n expected value per
 * game) — so moving along one axis says nothing about position on the other.
 */
export function computeStyleMap(
  participants: ParticipantLike[],
  games: GameResult[],
  gameType: GameTypeFilter
): StyleMapPoint[] {
  const recent = filterByDatePreset(activeGames(games), "90d");
  const scoped = gameType === "all" ? recent : filterGamesByType(recent, gameType);

  const acc = new Map<string, QuarterAccumulator>();
  const ensure = (id: string): QuarterAccumulator => {
    let a = acc.get(id);
    if (!a) {
      a = emptyAccumulator();
      acc.set(id, a);
    }
    return a;
  };
  for (const g of scoped) {
    const n = g.attendeeIds.length;
    if (n === 0) continue;
    const e = 1 / n;
    const points = g.points ?? 1;
    for (const attendeeId of g.attendeeIds) {
      const a = ensure(attendeeId);
      a.expectedPoints += points * e;
      a.gameCount += 1;
    }
    ensure(g.winnerId).wonPoints += points;
    ensure(g.loserId).lostPoints += points;
  }

  const points: StyleMapPoint[] = [];
  for (const p of participants) {
    const a = acc.get(p.id);
    if (!a || a.gameCount === 0) continue;
    const winIndex = a.expectedPoints > 0 ? a.wonPoints / a.expectedPoints : 0;
    const lossIndex = a.expectedPoints > 0 ? a.lostPoints / a.expectedPoints : 0;
    points.push({
      id: p.id,
      name: p.name,
      engagement: (winIndex + lossIndex) / 2,
      performance: winIndex - lossIndex,
      winIndex,
      lossIndex,
      games: a.gameCount,
    });
  }

  return points;
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
  const key = (a: string, b: string) => `${a} ${b}`;

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

// ---------- v2.10/v2.13/v2.16: records / hall of fame (명예의 전당) ----------

export interface RecordTierEntry {
  id: string;
  name: string;
  value: number;
  startDate?: string; // present for streaks/day-wins; a single-day entry has startDate === endDate
  endDate?: string;
}

export interface RecordTier {
  rank: number; // standard competition ranking (1224) — ties at a rank all land in the same tier's entries, and the next tier's rank skips ahead by the tie count
  entries: RecordTierEntry[];
}

/**
 * Groups entries into value bands using standard competition ranking ("1224"
 * — 1, 2, 2, 4, not dense "1223" — 1, 2, 2, 3): every tied entry at a value
 * shares that band's rank ("공동 1위" etc.), and the next distinct value's
 * rank *skips ahead* by however many entries just tied — e.g. two entries
 * tied for 1위 pushes the next distinct value to 3위, not 2위; a single 1위
 * plus two tied at 2위 leaves no 3위 at all, the next distinct value is 4위.
 *
 * `tiers` caps by *rank number*, not by how many distinct-value bands get
 * shown (v2.20 revision, PRD §26.4) — a band is only included if its own
 * rank is `<= tiers`. So if the very first tie already fills ranks 1-3,
 * nothing else qualifies and only that one band is returned; conversely a
 * lone 1위 followed by a 2-way tie at 2위 still shows both bands even though
 * the tie's members occupy ranks 2-3. Once a band's rank exceeds `tiers`,
 * iteration stops — there is nothing "hidden" at the skipped ranks in
 * between, they're simply unoccupied by construction.
 *
 * `direction: "asc"` ranks the *smallest* values first (e.g. "최저 순득점"),
 * otherwise (default) largest first.
 */
function topTiers(
  entries: RecordTierEntry[],
  tiers = 3,
  direction: "desc" | "asc" = "desc"
): RecordTier[] {
  const distinctValues = Array.from(new Set(entries.map((e) => e.value))).sort((a, b) =>
    direction === "desc" ? b - a : a - b
  );

  const result: RecordTier[] = [];
  let rank = 1;
  for (const value of distinctValues) {
    if (rank > tiers) break;
    const tierEntries = entries.filter((e) => e.value === value);
    result.push({ rank, entries: tierEntries });
    rank += tierEntries.length;
  }
  return result;
}

export interface RecordsSummary {
  longestWinStreak: RecordTier[];
  longestLossStreak: RecordTier[];
  mostWinsInOneDay: RecordTier[];
  mostLossesInOneDay: RecordTier[]; // v2.19 — symmetric counterpart to mostWinsInOneDay
  mostAppearances: RecordTier[];
  highestNetPoints: RecordTier[]; // v2.16 — career netPoints leaderboard, top
  lowestNetPoints: RecordTier[]; // v2.16 — career netPoints leaderboard, bottom
  mostGamesInOneDay: RecordTier[]; // v2.16 — NOT a per-participant record: the busiest single day, by total games played
}

/**
 * Career "hall of fame" records — deliberately always computed from the full
 * active game list regardless of any period/type filter the caller might
 * otherwise apply elsewhere on the page, since "longest win streak ever"
 * stops meaning what it says the moment it's silently scoped to a filter.
 * Callers should label this section as career-wide in the UI. Each category
 * shows up to the top 3 distinct values, with every participant tied at a
 * value grouped into that same rank (so "공동 1위" etc. is possible at any
 * of the 3 shown ranks).
 */
export function computeRecords(
  participants: ParticipantLike[],
  games: GameResult[]
): RecordsSummary {
  const active = activeGames(games);
  const nameOf = new Map(participants.map((p) => [p.id, p.name]));
  const nameFor = (id: string) => nameOf.get(id) ?? "(삭제된 참가자)";

  const winStreakEntries: RecordTierEntry[] = [];
  const lossStreakEntries: RecordTierEntry[] = [];

  for (const p of participants) {
    const chronological = decisiveGamesForParticipant(p.id, active);
    let currentType: "W" | "L" | null = null;
    let currentLength = 0;
    // Tracks the min/max `date` seen within the run currently being
    // accumulated (not the first/last game by createdAt order) — an admin
    // can now edit a game's `date` independently of `createdAt` (PRD 11), so
    // taking the array-position first/last could render an end-before-start
    // range. Min/max stays correct regardless of how the dates land.
    let currentStart = "";
    let currentEnd = "";
    let bestWin = 0;
    let bestWinRange: { start: string; end: string } | null = null;
    let bestLoss = 0;
    let bestLossRange: { start: string; end: string } | null = null;

    for (const g of chronological) {
      const type: "W" | "L" = g.winnerId === p.id ? "W" : "L";
      if (type === currentType) {
        currentLength++;
        if (g.date < currentStart) currentStart = g.date;
        if (g.date > currentEnd) currentEnd = g.date;
      } else {
        currentType = type;
        currentLength = 1;
        currentStart = g.date;
        currentEnd = g.date;
      }
      // Length and range must update together — capturing them in separate
      // branches would let the two desync.
      if (type === "W" && currentLength > bestWin) {
        bestWin = currentLength;
        bestWinRange = { start: currentStart, end: currentEnd };
      } else if (type === "L" && currentLength > bestLoss) {
        bestLoss = currentLength;
        bestLossRange = { start: currentStart, end: currentEnd };
      }
    }

    if (bestWin > 0 && bestWinRange) {
      winStreakEntries.push({
        id: p.id,
        name: p.name,
        value: bestWin,
        startDate: bestWinRange.start,
        endDate: bestWinRange.end,
      });
    }
    if (bestLoss > 0 && bestLossRange) {
      lossStreakEntries.push({
        id: p.id,
        name: p.name,
        value: bestLoss,
        startDate: bestLossRange.start,
        endDate: bestLossRange.end,
      });
    }
  }

  const winsByDay = new Map<string, number>(); // key: winnerId|date
  const lossesByDay = new Map<string, number>(); // key: loserId|date
  for (const g of active) {
    const winKey = `${g.winnerId}|${g.date}`;
    winsByDay.set(winKey, (winsByDay.get(winKey) ?? 0) + 1);
    const lossKey = `${g.loserId}|${g.date}`;
    lossesByDay.set(lossKey, (lossesByDay.get(lossKey) ?? 0) + 1);
  }
  const dayWinEntries: RecordTierEntry[] = Array.from(winsByDay.entries()).map(
    ([key, wins]) => {
      const [id, date] = key.split("|");
      return { id, name: nameFor(id), value: wins, startDate: date, endDate: date };
    }
  );
  const dayLossEntries: RecordTierEntry[] = Array.from(lossesByDay.entries()).map(
    ([key, losses]) => {
      const [id, date] = key.split("|");
      return { id, name: nameFor(id), value: losses, startDate: date, endDate: date };
    }
  );

  const stats = computeParticipantStats(participants, active);
  const appearanceEntries: RecordTierEntry[] = stats
    .filter((s) => s.appearances > 0)
    .map((s) => ({ id: s.id, name: s.name, value: s.appearances }));
  // v2.19 — netPoints is a career-cumulative total with no single date of
  // its own, but "when was this last confirmed at this value" is exactly
  // the date of the participant's most recent decisive game (netPoints only
  // ever moves on a win/loss), so that's what's attached here.
  const netPointsEntries: RecordTierEntry[] = stats
    .filter((s) => s.appearances > 0)
    .map((s) => {
      const chronological = decisiveGamesForParticipant(s.id, active);
      const lastDate = chronological.length
        ? chronological[chronological.length - 1].date
        : undefined;
      return { id: s.id, name: s.name, value: s.netPoints, startDate: lastDate, endDate: lastDate };
    });

  // v2.16 — a team-wide record, not a per-participant one: which single
  // (business) day had the most games played, total. `name` is left empty
  // (RecordCategory/formatRecordEntry omit the "이름 · " prefix when name is
  // blank) and the date instead goes through the same startDate/endDate
  // parenthetical every other dated category uses, for a consistent look.
  const gamesPerDay = new Map<string, number>();
  for (const g of active) {
    gamesPerDay.set(g.date, (gamesPerDay.get(g.date) ?? 0) + 1);
  }
  const dayGameCountEntries: RecordTierEntry[] = Array.from(gamesPerDay.entries()).map(
    ([date, count]) => ({ id: date, name: "", value: count, startDate: date, endDate: date })
  );

  return {
    longestWinStreak: topTiers(winStreakEntries),
    longestLossStreak: topTiers(lossStreakEntries),
    mostWinsInOneDay: topTiers(dayWinEntries),
    mostLossesInOneDay: topTiers(dayLossEntries),
    mostAppearances: topTiers(appearanceEntries),
    highestNetPoints: topTiers(netPointsEntries, 3, "desc"),
    lowestNetPoints: topTiers(netPointsEntries, 3, "asc"),
    mostGamesInOneDay: topTiers(dayGameCountEntries),
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

export interface CumulativeNetPointsRow {
  label: string;
  values: Record<string, number>; // participantId -> cumulative net points through the end of this bucket
}

/**
 * Per-participant cumulative net points (points-weighted, i.e. the same
 * `points`-aware 순점수 used everywhere else in this app — earlier versions
 * of this trend counted every win/loss as ±1 regardless of `points`, which
 * was inconsistent with the rest of the app and is fixed here as part of the
 * v2.16 rework), sampled once per period bucket instead of once per game —
 * so this shares its "추이 단위" (day/week/month/year) with
 * groupGamesByPeriod's game-count trend rather than plotting one point per
 * individual game, which reads poorly once game counts get large.
 */
export function computeCumulativeNetPointsTrend(
  games: GameResult[],
  grouping: PeriodGrouping
): CumulativeNetPointsRow[] {
  const sorted = [...activeGames(games)].sort((a, b) =>
    a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)
  );

  const running = new Map<string, number>();
  const rows: CumulativeNetPointsRow[] = [];
  let currentKey: string | null = null;
  let currentRow: CumulativeNetPointsRow | null = null;

  for (const g of sorted) {
    const d = new Date(g.date);
    const key = bucketStart(d, grouping).toISOString();
    const points = g.points ?? 1;
    running.set(g.winnerId, (running.get(g.winnerId) ?? 0) + points);
    running.set(g.loserId, (running.get(g.loserId) ?? 0) - points);

    if (key !== currentKey) {
      currentKey = key;
      currentRow = { label: bucketLabel(d, grouping), values: {} };
      rows.push(currentRow);
    }
    // Overwritten on every game within the same bucket, so it ends up
    // holding the running totals as of the *end* of this bucket.
    currentRow!.values = Object.fromEntries(running.entries());
  }

  return rows;
}

export type GameTypeFilter = GameType | "all";

export function filterGamesByType(
  games: GameResult[],
  gameType: GameTypeFilter
): GameResult[] {
  if (gameType === "all") return games;
  return games.filter((g) => g.gameType === gameType);
}

export type RangePreset = "today" | "7d" | "30d" | "90d" | "year" | "all" | "custom";

export interface CustomRange {
  start?: string; // yyyy-MM-dd, inclusive
  end?: string; // yyyy-MM-dd, inclusive
}

const PRESET_DAYS: Partial<Record<RangePreset, number>> = { "7d": 7, "30d": 30, "90d": 90 };

/**
 * Generic date-range filter — works on anything with a `.date` string, not
 * just games, so the same preset logic can filter Settlement[] (e.g. for the
 * donation ranking) without duplicating the date math.
 *
 * `custom` is only consulted when `preset === "custom"`. Every `.date` in
 * this app is already a plain "yyyy-MM-dd" Asia/Seoul business-date string
 * (never a UTC instant — see time.ts's v2.16 06:00-30:00 day redefinition),
 * so every preset here compares those strings directly against a cutoff also
 * derived as a string, rather than going through `new Date(...)`, which
 * parses as UTC midnight and can shift any boundary by up to a day depending
 * on where the Node process happens to run.
 */
export function filterByDatePreset<T extends { date: string }>(
  items: T[],
  preset: RangePreset,
  custom?: CustomRange
): T[] {
  if (preset === "custom") {
    if (!custom?.start && !custom?.end) return items;
    return items.filter(
      (it) =>
        (!custom.start || it.date >= custom.start) &&
        (!custom.end || it.date <= custom.end)
    );
  }

  if (preset === "all") return items;

  const today = todayInSeoul();
  if (preset === "today") {
    return items.filter((it) => it.date === today);
  }
  if (preset === "year") {
    const yearStart = `${today.slice(0, 4)}-01-01`;
    return items.filter((it) => it.date >= yearStart);
  }

  const days = PRESET_DAYS[preset];
  if (days) {
    const cutoff = addDaysToIsoDate(today, -(days - 1));
    return items.filter((it) => it.date >= cutoff);
  }

  return items;
}

/** @deprecated use filterByDatePreset — kept as a thin alias so existing GameResult[] call sites don't need to change. */
export const filterGamesByPreset = filterByDatePreset<GameResult>;
