import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfYear,
  format,
} from "date-fns";
// v2.23: doc comments in this file (e.g. "채권" below) still use the old
// debt/creditor vocabulary, but user-facing screens all use carbon-credit
// transfer terms now (PRD §32.2). Calculations are unchanged.
import { GameResult, GameType, Settlement, LedgerAdjustment } from "./types";
import { activeGames, withinDayKey, computeDailySequenceNumbers } from "./games";
import { todayInSeoul, quarterKeyOf, addDaysToIsoDate } from "./time";
import { computePeakBalances } from "./settle";

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

const RECENT_GAME_DAYS_WINDOW = 7;

/**
 * Every business date within the last `RECENT_GAME_DAYS_WINDOW` days
 * (`today` inclusive) that actually has an active game, most recent first —
 * days with zero games are skipped entirely rather than shown as empty. No
 * count cap (v2.21, PRD §28.7) — a busier week just returns more entries.
 * Replaces computeTodaySummary/TodaySummary (v2.16): "오늘의 요약" only ever
 * showed anything on days someone actually played, so this generalizes it to
 * "recent game days" instead of being blank whenever today itself has no
 * games yet.
 *
 * `today` is a parameter (not `todayInSeoul()` called internally) purely for
 * testability, and so the business-day basis is shared with the caller
 * rather than potentially drifting a moment apart.
 *
 * Each day's "최다 승자" is ranked by that day's net points (points-weighted
 * pointsWon - pointsLost), not win count, so a tie (공동 1위) and the
 * displayed 득실차 always describe the same number.
 */
export function computeRecentGameDaysSummary(
  participants: ParticipantLike[],
  games: GameResult[],
  today: string
): RecentGameDaySummary[] {
  const active = activeGames(games);
  const byDate = new Map<string, GameResult[]>();
  for (const g of active) {
    const list = byDate.get(g.date);
    if (list) list.push(g);
    else byDate.set(g.date, [g]);
  }

  // ISO 날짜 문자열 비교로 충분하다 — new Date(date) 파싱은 UTC 자정
  // 이슈로 경계가 하루 밀릴 수 있다(§13.5).
  const windowStart = addDaysToIsoDate(today, -(RECENT_GAME_DAYS_WINDOW - 1));
  const dates = Array.from(byDate.keys())
    .filter((date) => date >= windowStart && date <= today)
    .sort((a, b) => b.localeCompare(a));

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
  nemesis: { opponentId: string; opponentName: string; margin: number } | null; // opponent this participant has the worst net margin against
  victim: { opponentId: string; opponentName: string; margin: number } | null; // opponent this participant has the best net margin against
}

/**
 * Each participant's toughest opponent (천적) and easiest opponent (밥), from
 * computeHeadToHead. v2.23: ranked by per-opponent margin (pointsWon -
 * pointsLost), not by either raw total, so the same opponent can never be
 * both nemesis and victim (a high-volume rival with a near-even record used
 * to qualify as "most lost to" and "most won from" simultaneously). Ties
 * break on total volume exchanged (thicker sample first), then name.
 */
export function computeNemesisAndVictim(
  participants: ParticipantLike[],
  games: GameResult[]
): NemesisVictimEntry[] {
  return participants.map((p) => {
    const h2h = computeHeadToHead(participants, games, p.id);
    const margin = (e: HeadToHeadEntry) => e.pointsWon - e.pointsLost;
    const volume = (e: HeadToHeadEntry) => e.pointsWon + e.pointsLost;
    const nemesisEntry = h2h
      .filter((e) => margin(e) < 0)
      .sort(
        (a, b) =>
          margin(a) - margin(b) || volume(b) - volume(a) || a.opponentName.localeCompare(b.opponentName)
      )[0];
    const victimEntry = h2h
      .filter((e) => margin(e) > 0)
      .sort(
        (a, b) =>
          margin(b) - margin(a) || volume(b) - volume(a) || a.opponentName.localeCompare(b.opponentName)
      )[0];
    return {
      id: p.id,
      name: p.name,
      nemesis: nemesisEntry
        ? {
            opponentId: nemesisEntry.opponentId,
            opponentName: nemesisEntry.opponentName,
            margin: margin(nemesisEntry),
          }
        : null,
      victim: victimEntry
        ? {
            opponentId: victimEntry.opponentId,
            opponentName: victimEntry.opponentName,
            margin: margin(victimEntry),
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
  bestDailyMargin: RecordTier[]; // v2.21 — highest (participant, business day) net points; §28.10.1
  worstDailyMargin: RecordTier[]; // v2.21 — lowest (participant, business day) net points; §28.10.1
  mostGamesInOneDay: RecordTier[]; // v2.16 — NOT a per-participant record: the busiest single day, by total games played
  mostAppearances: RecordTier[];
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
  // v2.21 (PRD §28.10.1) — per (participant, business day) net points
  // (points-weighted, like everywhere else). Only ever gains a key from a
  // win or a loss (never from mere attendance), so a day where someone only
  // sat in as a bystander never produces an entry for them — exactly the
  // "단순 참관은 제외" rule, for free, by construction (same trick
  // winsByDay/lossesByDay below already rely on).
  const marginByDay = new Map<string, number>(); // key: id|date
  for (const g of active) {
    const points = g.points ?? 1;
    const winKey = `${g.winnerId}|${g.date}`;
    winsByDay.set(winKey, (winsByDay.get(winKey) ?? 0) + 1);
    marginByDay.set(winKey, (marginByDay.get(winKey) ?? 0) + points);
    const lossKey = `${g.loserId}|${g.date}`;
    lossesByDay.set(lossKey, (lossesByDay.get(lossKey) ?? 0) + 1);
    marginByDay.set(lossKey, (marginByDay.get(lossKey) ?? 0) - points);
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
  const dailyMarginEntries: RecordTierEntry[] = Array.from(marginByDay.entries()).map(
    ([key, margin]) => {
      const [id, date] = key.split("|");
      return { id, name: nameFor(id), value: margin, startDate: date, endDate: date };
    }
  );

  const stats = computeParticipantStats(participants, active);
  const appearanceEntries: RecordTierEntry[] = stats
    .filter((s) => s.appearances > 0)
    .map((s) => ({ id: s.id, name: s.name, value: s.appearances }));

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
    bestDailyMargin: topTiers(dailyMarginEntries, 3, "desc"),
    worstDailyMargin: topTiers(dailyMarginEntries, 3, "asc"),
    mostGamesInOneDay: topTiers(dayGameCountEntries),
    mostAppearances: topTiers(appearanceEntries),
  };
}

/**
 * "역대 최고 채권 보유" — the highest positive balance ("채권", points owed
 * TO them) any participant ever held, not their current balance. A balance
 * that climbed to 20 and later settled back down to 19 must still show 20
 * here. Needs settlements/adjustments on top of games (unlike the rest of
 * computeRecords, which is deliberately games-only — see its own doc
 * comment), so this stays a separate function rather than folding into
 * RecordsSummary. The actual peak-tracking lives in settle.ts's
 * computePeakBalances (same chronological/createdAt basis as the streak
 * records above); this just shapes that into a RecordTier[] via the same
 * topTiers ranking every other career record uses.
 */
export function computeHighestBalanceRecord(
  participants: ParticipantLike[],
  games: GameResult[],
  settlements: Settlement[],
  adjustments: LedgerAdjustment[]
): RecordTier[] {
  const nameOf = new Map(participants.map((p) => [p.id, p.name]));
  const peaks = computePeakBalances(games, settlements, adjustments);
  const entries: RecordTierEntry[] = Array.from(peaks.entries()).map(([id, p]) => ({
    id,
    name: nameOf.get(id) ?? "(삭제된 참가자)",
    value: p.peak,
    startDate: p.date,
    endDate: p.date,
  }));
  return topTiers(entries);
}

export type PeriodGrouping = "day" | "week" | "month" | "quarter" | "year";
/** 누적 순점수 추이 전용 — 판마다 한 점을 찍는 "game"을 추가로 허용한다. 기간별 게임 수 추이 차트에는 쓰지 않는다(모든 버킷이 1이 되어 무의미하므로). */
export type CumulativeGrouping = PeriodGrouping | "game";

export interface PeriodBucket {
  key: string;
  label: string;
  gameCount: number;
  wins: Record<string, number>;
  losses: Record<string, number>;
}

// day/week/month/year는 기존 Date 기반 계산을 그대로 둔다(범위 밖 —
// 이번 변경의 요구사항은 "quarter가 티어 화면의 분기 경계와 반드시
// 일치해야 한다"는 것뿐이다). quarter만 quarterKeyOf()(문자열 슬라이싱,
// time.ts)로 별도 처리한다 — new Date(date)로 분기를 구하면 UTC 자정
// 파싱 때문에 하루가 밀려 분기 자체가 바뀔 수 있다(§13.5·§16에서 이미
// 결론 난 사항).
type DateBasedGrouping = Exclude<PeriodGrouping, "quarter">;

function bucketStart(date: Date, grouping: DateBasedGrouping): Date {
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

function bucketLabel(date: Date, grouping: DateBasedGrouping): string {
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

/**
 * A sortable bucket key + display label for one game's business date, given
 * a grouping. `key` sorts correctly as a plain string for every grouping
 * this produces: ISO instants (day/week/month/year, via Date#toISOString)
 * and "yyyy-Qn" (quarter — zero-padded 4-digit year + single-digit quarter)
 * both compare chronologically under plain string ordering.
 */
function periodBucketKeyAndLabel(
  dateStr: string,
  grouping: PeriodGrouping
): { key: string; label: string } {
  if (grouping === "quarter") {
    const key = quarterKeyOf(dateStr); // e.g. "2026-Q3" — short enough for an axis label as-is
    return { key, label: key };
  }
  const d = new Date(dateStr);
  const start = bucketStart(d, grouping);
  return { key: start.toISOString(), label: bucketLabel(d, grouping) };
}

/** Filters out soft-deleted (GameResult.active === false) games internally before bucketing. */
export function groupGamesByPeriod(
  games: GameResult[],
  grouping: PeriodGrouping
): PeriodBucket[] {
  const buckets = new Map<string, PeriodBucket>();

  const sorted = [...activeGames(games)].sort((a, b) => a.date.localeCompare(b.date));

  for (const g of sorted) {
    const { key, label } = periodBucketKeyAndLabel(g.date, grouping);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, label, gameCount: 0, wins: {}, losses: {} };
      buckets.set(key, bucket);
    }
    bucket.gameCount += 1;
    bucket.wins[g.winnerId] = (bucket.wins[g.winnerId] ?? 0) + 1;
    bucket.losses[g.loserId] = (bucket.losses[g.loserId] ?? 0) + 1;
  }

  return Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));
}

export interface CumulativeNetPointsRow {
  label: string;
  values: Record<string, number>; // participantId -> cumulative net points through the end of this bucket/game
  date?: string; // business date of this point — only set for "game" grouping, where the tooltip needs it since the label is just a sequence number
}

/**
 * Per-participant cumulative net points (points-weighted, i.e. the same
 * `points`-aware 순점수 used everywhere else in this app), sampled once per
 * period bucket (or once per game, for `grouping === "game"`) — bucketed
 * grouping shares its "추이 단위" (day/week/month/quarter/year) with
 * groupGamesByPeriod's game-count trend, while "game" plots one point per
 * individual game (the closest thing to the raw signal, since the value
 * itself only ever moves on a win/loss).
 *
 * Sort order is business-date ascending, then withinDayKey ascending within
 * the same date (v2.21) — not `createdAt`, which could put a
 * midnight-crossing or admin-corrected-timestamp game out of order relative
 * to every other screen that already sorts by withinDayKey (e.g. /games,
 * the dashboard's "최근 경기일" card).
 *
 * v2.22 (PRD §30.2): a participant enters `running` (at 0) from their first
 * *attendance*, not their first win/loss — every attendee of a game is
 * seeded into the map (if not already present) before that game's win/loss
 * delta is applied. Without this, someone who only ever draws (attends but
 * never wins/loses) never gets a key at all, and anyone else's line doesn't
 * start until their first decisive game — both read as "not tracked yet"
 * when the truth is "tracked at 0." Before their first attendance there's
 * still no key, so the line correctly doesn't exist for that stretch.
 */
export function computeCumulativeNetPointsTrend(
  games: GameResult[],
  grouping: CumulativeGrouping
): CumulativeNetPointsRow[] {
  const sorted = [...activeGames(games)].sort((a, b) =>
    a.date === b.date
      ? withinDayKey(a).localeCompare(withinDayKey(b))
      : a.date.localeCompare(b.date)
  );

  const running = new Map<string, number>();
  const seedAttendees = (g: GameResult) => {
    for (const id of g.attendeeIds) {
      if (!running.has(id)) running.set(id, 0);
    }
  };

  if (grouping === "game") {
    return sorted.map((g, i) => {
      seedAttendees(g);
      const points = g.points ?? 1;
      running.set(g.winnerId, (running.get(g.winnerId) ?? 0) + points);
      running.set(g.loserId, (running.get(g.loserId) ?? 0) - points);
      return {
        label: String(i + 1),
        values: Object.fromEntries(running.entries()),
        date: g.date,
      };
    });
  }

  const rows: CumulativeNetPointsRow[] = [];
  let currentKey: string | null = null;
  let currentRow: CumulativeNetPointsRow | null = null;

  for (const g of sorted) {
    const { key, label } = periodBucketKeyAndLabel(g.date, grouping);
    seedAttendees(g);
    const points = g.points ?? 1;
    running.set(g.winnerId, (running.get(g.winnerId) ?? 0) + points);
    running.set(g.loserId, (running.get(g.loserId) ?? 0) - points);

    if (key !== currentKey) {
      currentKey = key;
      currentRow = { label, values: {} };
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

// ---------- v2.21: "최근 경기일" 카드 (PRD §28.2, v2.20의 게임밤 보드 개편) ----------

export interface GameDayRow {
  id: string;
  name: string;
  appearances: number; // 그 경기일 참석 판수
  wins: number;
  losses: number;
  netPoints: number;
  streakType: "W" | "L" | null; // 그 경기일 기준 (통산 스트릭 아님)
  streakLength: number;
}

export interface GameDayBoard {
  date: string; // 대상 영업일 "yyyy-MM-dd"
  status: "live" | "closed"; // 대상 영업일이 오늘이면 live, 지난 경기일이면 closed
  totalGames: number;
  countsByGameType: { gameType: GameType | undefined; count: number }[];
  rows: GameDayRow[];
  /** 그 경기일의 개별 게임, 최신순(withinDayKey 내림차순) — 접이식 상세 목록이 그대로 렌더한다. */
  games: { game: GameResult; sequence: number | null }[];
}

/**
 * v2.21 (PRD §28.2): "활성 게임이 있는 가장 최근 영업일" 하루치 현황.
 * v2.20의 computeGameNightBoard는 대상 날짜가 항상 "오늘"이라 게임이 없는
 * 날은 카드 자체가 사라졌다 — 주 2회 모이는 그룹이라 대부분의 날이 그랬다.
 * 이제 대상 영업일 자체를 "가장 최근으로 게임이 있었던 날"로 찾으므로,
 * 게임이 한 판이라도 기록돼 있으면 항상 무언가를 반환한다(null은 활성
 * 게임이 정말 하나도 없을 때뿐).
 *
 * 새 지표가 아니라 기존 computeParticipantStats/computeCurrentStreaks를
 * 재사용하지만, 얇은 래퍼로 두지 않고 별도 함수로 둔 이유는 "그날
 * 참석했지만 승패가 아직 없는 사람"까지 rows에 포함시켜야 하기 때문이다 —
 * computeParticipantPointTotals는 승/패가 있는 사람만 맵에 키가 생겨서
 * 못 쓰고, computeParticipantStats는 "참가자 목록에 있는 사람"만 0으로
 * 초기화해주므로, 그 목록 자체를 그날 참석자로 미리 좁혀서 넘기면(전체
 * 참가자 풀이 아니라) 정확히 원하는 결과가 나온다.
 *
 * `today`(=todayInSeoul())를 인자로 받는 이유는 순수하게 테스트
 * 가능성이다 — 함수 안에서 직접 호출하면 검증 스크립트가 "종료된
 * 경기일" 케이스를 만들 수 없다.
 */
export function computeGameDayBoard(
  participants: ParticipantLike[],
  games: GameResult[],
  today: string
): GameDayBoard | null {
  const active = activeGames(games);
  if (active.length === 0) return null;

  const targetDate = active.reduce((latest, g) => (g.date > latest ? g.date : latest), "");
  const dayGames = active.filter((g) => g.date === targetDate);

  // 그날 참석자만 — attendeeIds의 합집합. 전체 참가자 풀을 나열하면 그날
  // 안 온 사람이 0승0패로 섞여 카드가 의미를 잃는다.
  const attendeeIds = new Set<string>();
  for (const g of dayGames) {
    for (const id of g.attendeeIds) attendeeIds.add(id);
  }
  const byId = new Map(participants.map((p) => [p.id, p]));
  const attendees: ParticipantLike[] = Array.from(attendeeIds).map(
    (id) => byId.get(id) ?? { id, name: "(삭제된 참가자)", active: false }
  );

  const stats = computeParticipantStats(attendees, dayGames);
  // 그 경기일 기준 스트릭 — 통산이 아니라 그날 게임만 넘겨서 계산한다.
  const streaks = new Map(
    computeCurrentStreaks(attendees, dayGames).map((s) => [s.id, s])
  );

  const rows: GameDayRow[] = stats.map((s) => {
    const streak = streaks.get(s.id);
    return {
      id: s.id,
      name: s.name,
      appearances: s.appearances,
      wins: s.wins,
      losses: s.losses,
      netPoints: s.netPoints,
      streakType: streak?.type ?? null,
      streakLength: streak?.length ?? 0,
    };
  });

  rows.sort((a, b) => {
    if (b.netPoints !== a.netPoints) return b.netPoints - a.netPoints;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return a.name.localeCompare(b.name, "ko");
  });

  const countsMap = new Map<GameType | undefined, number>();
  for (const g of dayGames) {
    countsMap.set(g.gameType, (countsMap.get(g.gameType) ?? 0) + 1);
  }
  const countsByGameType = Array.from(countsMap.entries()).map(([gameType, count]) => ({
    gameType,
    count,
  }));

  // withinDayKey 내림차순(최신 먼저) — 자정을 넘긴 01:30판이 22:00판보다
  // 뒤(=실제로는 더 최신)에 오도록(§18.1). 문자열 그대로("01:30" <
  // "22:00") 비교하면 순서가 뒤집힌다.
  const sortedByRecency = [...dayGames].sort((a, b) =>
    withinDayKey(b).localeCompare(withinDayKey(a))
  );
  // N차전 번호는 전체 게임 목록을 넘겨야 정확하다(games.ts 참고) — 그날
  // 게임만 넘겨도 값 자체는 같지만, 다른 화면(예: /games)과 항상 같은
  // 맵을 쓰는 습관을 유지한다.
  const sequenceNumbers = computeDailySequenceNumbers(games);
  const gamesWithSequence = sortedByRecency.map((game) => ({
    game,
    sequence: sequenceNumbers.get(game.id) ?? null,
  }));

  return {
    date: targetDate,
    status: targetDate === today ? "live" : "closed",
    totalGames: dayGames.length,
    countsByGameType,
    rows,
    games: gamesWithSequence,
  };
}

/** @deprecated use filterByDatePreset — kept as a thin alias so existing GameResult[] call sites don't need to change. */
export const filterGamesByPreset = filterByDatePreset<GameResult>;
