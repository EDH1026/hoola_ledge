// Quick standalone sanity check for the v2.15 quarterly tier system.
// Run with: npm run verify:tiers  (or: npx tsx scripts/verify-tiers.ts)
import {
  computeQuarterlyTiers,
  computeStyleMap,
  computeStyleMapDomain,
  computeNemesisAndVictim,
  computeParticipantStats,
  TIER_MIN_WEIGHT,
  STYLE_MAP_X_HALF_MAX,
  STYLE_MAP_Y_HALF_MAX,
  TierRow,
  StyleMapPoint,
  ParticipantLike,
} from "../src/lib/stats";
import { quarterKeyOf } from "../src/lib/time";
import { GameResult } from "../src/lib/types";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("PASS:", msg);
  }
}

function close(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

function game(
  id: string,
  date: string,
  attendeeIds: string[],
  winnerId: string,
  loserId: string,
  points?: number
): GameResult {
  return { id, date, attendeeIds, winnerId, loserId, points, createdAt: `${date}T00:00:00.000Z` };
}

function rowFor(rows: TierRow[], id: string): TierRow {
  const r = rows.find((x) => x.id === id);
  if (!r) throw new Error(`no TierRow for ${id}`);
  return r;
}

// Case 1: everyone hits their expected win/loss rate exactly -> PERF = 0 for
// all -> TR = 1000 for all, regardless of how much weight they've built up.
// Construction: a fixed 5-person table where each of 5 "rounds" is a cycle
// A beats B, B beats C, C beats D, D beats E, E beats A — every participant
// gets exactly 1 win and 1 loss per round out of 5 games attended that
// round, i.e. exactly the 1/5 expected rate. Five rounds gives everyone
// E_w = 5 (well above TIER_MIN_WEIGHT) while keeping PERF exactly 0.
{
  const ids = ["A", "B", "C", "D", "E"];
  const participants: ParticipantLike[] = ids.map((id) => ({ id, name: id, active: true }));
  const games: GameResult[] = [];
  let gid = 0;
  for (let round = 0; round < 5; round++) {
    for (let i = 0; i < 5; i++) {
      const winner = ids[i];
      const loser = ids[(i + 1) % 5];
      games.push(game(String(gid++), "2026-02-01", ids, winner, loser));
    }
  }
  const tiers = computeQuarterlyTiers(participants, games, "all");
  const rows = tiers.get("2026-Q1") ?? [];
  assert(rows.length === 5, "case1: all 5 participants present in 2026-Q1");
  for (const id of ids) {
    const r = rowFor(rows, id);
    assert(close(r.tr, 1000), `case1: ${id} at exactly expected rate should have TR=1000, got ${r.tr}`);
    assert(close(r.perf, 0), `case1: ${id} PERF should be 0, got ${r.perf}`);
    assert(r.weight >= TIER_MIN_WEIGHT, `case1: ${id} should have enough weight to be out of placement, got ${r.weight}`);
  }
}

// Case 2: attendee-count normalization. X plays only 4-person tables and
// wins exactly 1/4 of them (25% raw win rate); Y plays only 5-person tables
// and wins exactly 1/5 of them (20% raw win rate). Despite the different raw
// win rates, both should have winIndex === 1.00 exactly, because each is
// winning at precisely their own table's expected rate.
{
  const participants: ParticipantLike[] = [
    { id: "X", name: "X", active: true },
    { id: "Y", name: "Y", active: true },
    { id: "F1", name: "F1", active: true },
    { id: "F2", name: "F2", active: true },
    { id: "F3", name: "F3", active: true },
    { id: "G1", name: "G1", active: true },
    { id: "G2", name: "G2", active: true },
    { id: "G3", name: "G3", active: true },
    { id: "G4", name: "G4", active: true },
  ];
  const games: GameResult[] = [];
  // X: 4 games, 4-person tables (X, F1, F2, F3). X wins game 1, is a
  // bystander (never winnerId/loserId) in games 2-4.
  const xTable = ["X", "F1", "F2", "F3"];
  games.push(game("x1", "2026-02-01", xTable, "X", "F1"));
  games.push(game("x2", "2026-02-02", xTable, "F1", "F2"));
  games.push(game("x3", "2026-02-03", xTable, "F2", "F3"));
  games.push(game("x4", "2026-02-04", xTable, "F3", "F1"));
  // Y: 5 games, 5-person tables (Y, G1..G4). Y wins game 1, bystander after.
  const yTable = ["Y", "G1", "G2", "G3", "G4"];
  games.push(game("y1", "2026-02-01", yTable, "Y", "G1"));
  games.push(game("y2", "2026-02-02", yTable, "G1", "G2"));
  games.push(game("y3", "2026-02-03", yTable, "G2", "G3"));
  games.push(game("y4", "2026-02-04", yTable, "G3", "G4"));
  games.push(game("y5", "2026-02-05", yTable, "G4", "G1"));

  const rows = computeQuarterlyTiers(participants, games, "all").get("2026-Q1") ?? [];
  const x = rowFor(rows, "X");
  const y = rowFor(rows, "Y");
  assert(close(x.winIndex, 1.0), `case2: X (25% raw win rate on a 4-table) should have winIndex 1.00, got ${x.winIndex}`);
  assert(close(y.winIndex, 1.0), `case2: Y (20% raw win rate on a 5-table) should have winIndex 1.00, got ${y.winIndex}`);
}

// Case 3: points weighting. P and Q attend the exact same two 4-person
// games together; P wins the 2-point game and loses the 1-point game, Q has
// the opposite roles (wins the 1-point game, loses the 2-point one) — same
// win/loss *count* for both, but P's PERF must come out higher since P's
// win was worth more and P's loss cost less.
{
  const participants: ParticipantLike[] = [
    { id: "P", name: "P", active: true },
    { id: "Q", name: "Q", active: true },
    { id: "R", name: "R", active: true },
    { id: "S", name: "S", active: true },
  ];
  const table = ["P", "Q", "R", "S"];
  const games: GameResult[] = [
    game("g1", "2026-02-01", table, "P", "Q", 2), // P wins big, Q loses big
    game("g2", "2026-02-02", table, "Q", "P", 1), // Q wins small, P loses small
  ];
  const rows = computeQuarterlyTiers(participants, games, "all").get("2026-Q1") ?? [];
  const p = rowFor(rows, "P");
  const q = rowFor(rows, "Q");
  assert(p.perf > q.perf, `case3: P (won the 2pt game, lost the 1pt game) should have higher PERF than Q (opposite), got P=${p.perf} Q=${q.perf}`);
  assert(close(p.perf, -q.perf), `case3: by symmetry P and Q's PERF should be exact opposites, got P=${p.perf} Q=${q.perf}`);
}

// Case 4: placement gate. A single 4-person game gives the winner
// weight = 0.25, far below TIER_MIN_WEIGHT (2.0) -> must be "unranked".
{
  const participants: ParticipantLike[] = [
    { id: "N1", name: "N1", active: true },
    { id: "N2", name: "N2", active: true },
    { id: "N3", name: "N3", active: true },
    { id: "N4", name: "N4", active: true },
  ];
  const games: GameResult[] = [game("g1", "2026-02-01", ["N1", "N2", "N3", "N4"], "N1", "N2")];
  const rows = computeQuarterlyTiers(participants, games, "all").get("2026-Q1") ?? [];
  const n1 = rowFor(rows, "N1");
  assert(n1.weight < TIER_MIN_WEIGHT, `case4: one game should leave weight well under TIER_MIN_WEIGHT, got ${n1.weight}`);
  assert(n1.tier === "unranked", `case4: weight < TIER_MIN_WEIGHT must mean unranked (placement), got ${n1.tier}`);
}

// Case 5: quarter boundaries — the last day of Q1 and the first day of Q2.
{
  assert(quarterKeyOf("2026-03-31") === "2026-Q1", `case5: 2026-03-31 should be 2026-Q1, got ${quarterKeyOf("2026-03-31")}`);
  assert(quarterKeyOf("2026-04-01") === "2026-Q2", `case5: 2026-04-01 should be 2026-Q2, got ${quarterKeyOf("2026-04-01")}`);
  assert(quarterKeyOf("2026-01-01") === "2026-Q1", "case5: Jan 1 is Q1");
  assert(quarterKeyOf("2026-06-30") === "2026-Q2", "case5: Jun 30 is Q2");
  assert(quarterKeyOf("2026-07-01") === "2026-Q3", "case5: Jul 1 is Q3");
  assert(quarterKeyOf("2026-12-31") === "2026-Q4", "case5: Dec 31 is Q4");
}

// Case 6: carryover and decay. "Star" plays many 4-person games in Q1,
// always winning -> strong positive TR. In Q2, Star plays nothing at all
// (only other participants play, so the quarter still exists in the map) ->
// Star's Q2 TR must land strictly between 1000 and their Q1 TR: decayed
// toward the center, never frozen at the Q1 value and never overshooting
// past 1000 to the other side.
{
  const participants: ParticipantLike[] = [
    { id: "Star", name: "Star", active: true },
    { id: "F1", name: "F1", active: true },
    { id: "F2", name: "F2", active: true },
    { id: "F3", name: "F3", active: true },
  ];
  const games: GameResult[] = [];
  const table = ["Star", "F1", "F2", "F3"];
  for (let i = 0; i < 10; i++) {
    games.push(game(`q1-${i}`, "2026-02-01", table, "Star", "F1"));
  }
  // Q2: a single game that doesn't involve Star at all, just to give the
  // quarter an entry in the map.
  games.push(game("q2-1", "2026-05-01", ["F1", "F2", "F3"], "F2", "F3"));

  const tiers = computeQuarterlyTiers(participants, games, "all");
  const q1Rows = tiers.get("2026-Q1") ?? [];
  const q2Rows = tiers.get("2026-Q2") ?? [];
  const starQ1 = rowFor(q1Rows, "Star");
  const starQ2 = rowFor(q2Rows, "Star");

  assert(starQ1.tr > 1000, `case6: Star's Q1 TR should be well above 1000 (always won), got ${starQ1.tr}`);
  assert(starQ2.games === 0, "case6: Star should have 0 games recorded in Q2");
  assert(
    starQ2.tr < starQ1.tr,
    `case6: an idle Q2 should decay TR back toward 1000, i.e. Q2 TR < Q1 TR, got Q1=${starQ1.tr} Q2=${starQ2.tr}`
  );
  assert(
    starQ2.tr >= 1000,
    `case6: decay should not overshoot past 1000 to the opposite side, got Q2 TR=${starQ2.tr}`
  );
}

// Case 7: sorting. Every quarter's TierRow[] must be in descending TR order.
{
  const participants: ParticipantLike[] = [
    { id: "A", name: "A", active: true },
    { id: "B", name: "B", active: true },
    { id: "C", name: "C", active: true },
    { id: "D", name: "D", active: true },
  ];
  const table = ["A", "B", "C", "D"];
  const games: GameResult[] = [];
  // Give each participant a different win/loss balance so TRs actually differ.
  for (let i = 0; i < 6; i++) games.push(game(`a${i}`, "2026-02-01", table, "A", "D"));
  for (let i = 0; i < 3; i++) games.push(game(`b${i}`, "2026-02-02", table, "B", "D"));
  for (let i = 0; i < 3; i++) games.push(game(`c${i}`, "2026-02-03", table, "D", "C"));

  const rows = computeQuarterlyTiers(participants, games, "all").get("2026-Q1") ?? [];
  let sorted = true;
  for (let i = 0; i < rows.length - 1; i++) {
    if (rows[i].tr < rows[i + 1].tr) sorted = false;
  }
  assert(rows.length === 4, "case7: all 4 participants present");
  assert(sorted, `case7: TierRow[] should be sorted by TR descending, got ${rows.map((r) => `${r.name}:${r.tr.toFixed(1)}`).join(", ")}`);
}

// Style map (PRD §16.8) tests use real wall-clock offsets (the 90-day window
// is computed from Date.now(), unlike the quarter-key tests above which use
// fixed calendar dates), so dates are generated relative to "today" here.
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function styleRowFor(points: StyleMapPoint[], id: string): StyleMapPoint | undefined {
  return points.find((p) => p.id === id);
}

// Case 8: style map's two axes move independently. Part A: a 5-person cycle
// (same shape as case1) where everyone hits their expected rate exactly ->
// engagement ~= 1.00 and performance ~= 0 for all. Part B: two participants
// both with PERF = 0 (equal win/loss counts) but very different engagement —
// proving ENG isn't just a rescaled PERF.
{
  const ids = ["SA", "SB", "SC", "SD", "SE"];
  const participants: ParticipantLike[] = ids.map((id) => ({ id, name: id, active: true }));
  const games: GameResult[] = [];
  let gid = 0;
  for (let round = 0; round < 5; round++) {
    for (let i = 0; i < 5; i++) {
      const winner = ids[i];
      const loser = ids[(i + 1) % 5];
      games.push(game(`s${gid++}`, daysAgo(10), ids, winner, loser));
    }
  }
  const points = computeStyleMap(participants, games, "all");
  assert(points.length === 5, "case8a: all 5 participants present in the style map");
  for (const id of ids) {
    const p = styleRowFor(points, id);
    if (!p) throw new Error(`no StyleMapPoint for ${id}`);
    assert(close(p.engagement, 1.0), `case8a: ${id} at exactly expected rate should have engagement=1.00, got ${p.engagement}`);
    assert(close(p.performance, 0), `case8a: ${id} performance should be 0, got ${p.performance}`);
  }
}
{
  const participants: ParticipantLike[] = [
    { id: "Even2", name: "Even2", active: true },
    { id: "Rare8", name: "Rare8", active: true },
    { id: "X1", name: "X1", active: true },
    { id: "X2", name: "X2", active: true },
    { id: "X3", name: "X3", active: true },
  ];
  const games: GameResult[] = [];
  // Even2: 4 games at a 4-person table, decisive every time (2 wins, 2 losses).
  const evenTable = ["Even2", "X1", "X2", "X3"];
  games.push(game("e1", daysAgo(5), evenTable, "Even2", "X1"));
  games.push(game("e2", daysAgo(5), evenTable, "Even2", "X2"));
  games.push(game("e3", daysAgo(5), evenTable, "X1", "Even2"));
  games.push(game("e4", daysAgo(5), evenTable, "X2", "Even2"));
  // Rare8: 8 games at a 4-person table, decisive in only 2 (1 win, 1 loss);
  // bystander (never winnerId/loserId) in the other 6.
  const rareTable = ["Rare8", "X1", "X2", "X3"];
  games.push(game("r1", daysAgo(5), rareTable, "Rare8", "X1"));
  games.push(game("r2", daysAgo(5), rareTable, "X1", "Rare8"));
  for (let i = 0; i < 6; i++) {
    games.push(game(`r${3 + i}`, daysAgo(5), rareTable, "X2", "X3"));
  }

  const points = computeStyleMap(participants, games, "all");
  const even2 = styleRowFor(points, "Even2");
  const rare8 = styleRowFor(points, "Rare8");
  if (!even2 || !rare8) throw new Error("case8b: missing StyleMapPoint");
  assert(close(even2.performance, 0), `case8b: Even2 (2W/2L) should have performance=0, got ${even2.performance}`);
  assert(close(rare8.performance, 0), `case8b: Rare8 (1W/1L) should have performance=0, got ${rare8.performance}`);
  assert(even2.engagement > 1.0, `case8b: Even2 (always decisive) should have engagement > 1.00, got ${even2.engagement}`);
  assert(rare8.engagement < 1.0, `case8b: Rare8 (mostly bystander) should have engagement < 1.00, got ${rare8.engagement}`);
}

// Case 9: style map's rolling 90-day gate. A game 91 days ago must be
// excluded; a game 89 days ago must be included. A participant with only 1
// (included) game must still appear; a participant with 0 games in the
// window (whether never-played or only-outside-window) must not appear.
{
  const participants: ParticipantLike[] = [
    { id: "P91", name: "P91", active: true },
    { id: "P89", name: "P89", active: true },
    { id: "Ghost", name: "Ghost", active: true },
    { id: "F1", name: "F1", active: true },
  ];
  const games: GameResult[] = [
    game("old", daysAgo(91), ["P91", "F1"], "P91", "F1"),
    game("recent", daysAgo(89), ["P89", "F1"], "P89", "F1"),
  ];
  const points = computeStyleMap(participants, games, "all");
  assert(styleRowFor(points, "P91") === undefined, "case9: a participant whose only game is 91 days old must be excluded");
  const p89 = styleRowFor(points, "P89");
  assert(p89 !== undefined && p89.games === 1, "case9: a participant with a single 89-day-old game must appear with games=1");
  assert(styleRowFor(points, "Ghost") === undefined, "case9: a participant with no games at all must be excluded");
}

// Case 10 (v2.23 §32.8): nemesis/victim are now margin-based, not raw-total
// based, so the same opponent can never be picked as both.
{
  // 10a/10b/10c: A vs B is a high-volume near-even rivalry (8 wins, 9
  // losses, 1 point each -> margin -1) and A vs C is lopsided in A's favor
  // (2 wins, 0 losses -> margin +2). Under the OLD total-based logic, B has
  // both the most pointsLost (9) and the most pointsWon (8) of any of A's
  // opponents, so B would be picked as both nemesis AND victim -- the exact
  // contradiction this change fixes. Under the new margin-based logic only
  // C has a positive margin, so B can only ever be the nemesis.
  const participants: ParticipantLike[] = [
    { id: "A", name: "A", active: true },
    { id: "B", name: "B", active: true },
    { id: "C", name: "C", active: true },
  ];
  const games: GameResult[] = [];
  let gid = 0;
  for (let i = 0; i < 8; i++) games.push(game(`nv${gid++}`, "2026-02-01", ["A", "B"], "A", "B"));
  for (let i = 0; i < 9; i++) games.push(game(`nv${gid++}`, "2026-02-01", ["A", "B"], "B", "A"));
  for (let i = 0; i < 2; i++) games.push(game(`nv${gid++}`, "2026-02-01", ["A", "C"], "A", "C"));

  const entries = computeNemesisAndVictim(participants, games);
  const a = entries.find((e) => e.id === "A");
  if (!a) throw new Error("case10: no NemesisVictimEntry for A");

  assert(a.nemesis?.opponentId === "B", `case10a: A's nemesis should be B (margin -1), got ${JSON.stringify(a.nemesis)}`);
  assert(a.victim?.opponentId === "C", `case10b: A's victim should be C (margin +2), got ${JSON.stringify(a.victim)}`);
  assert(a.nemesis?.margin === -1, `case10a: A's nemesis margin should be -1, got ${a.nemesis?.margin}`);
  assert(a.victim?.margin === 2, `case10b: A's victim margin should be +2, got ${a.victim?.margin}`);
  assert(
    a.nemesis?.opponentId !== a.victim?.opponentId,
    `case10c: nemesis and victim must never be the same opponent (old total-based logic would pick B for both), got nemesis=${a.nemesis?.opponentId} victim=${a.victim?.opponentId}`
  );

  // No participant, across the whole dataset, should ever have
  // nemesis.opponentId === victim.opponentId.
  for (const e of entries) {
    assert(
      e.nemesis === null || e.victim === null || e.nemesis.opponentId !== e.victim.opponentId,
      `case10c: ${e.name} must not have the same opponent as both nemesis and victim, got ${e.nemesis?.opponentId}`
    );
  }
}

// Case 11: all-zero-or-positive margins -> nemesis is null (no opponent has
// a negative margin to qualify).
{
  const participants: ParticipantLike[] = [
    { id: "E", name: "E", active: true },
    { id: "F", name: "F", active: true },
  ];
  const games: GameResult[] = [
    game("z1", "2026-02-01", ["E", "F"], "E", "F"),
    game("z2", "2026-02-02", ["E", "F"], "F", "E"),
  ];
  const entries = computeNemesisAndVictim(participants, games);
  const e = entries.find((x) => x.id === "E");
  if (!e) throw new Error("case11: no NemesisVictimEntry for E");
  assert(e.nemesis === null, `case11: E's margin against F is 0 (not negative) -> nemesis should be null, got ${JSON.stringify(e.nemesis)}`);
  assert(e.victim === null, `case11: E's margin against F is 0 (not positive) -> victim should be null, got ${JSON.stringify(e.victim)}`);
}

// Case 12: tie-break. G has the same margin (-1) against both H and I, but
// more total volume was exchanged with H (7 points: 3W/4L) than with I (3
// points: 1W/2L) -> H should win the tie-break as the thicker sample.
{
  const participants: ParticipantLike[] = [
    { id: "G", name: "G", active: true },
    { id: "H", name: "H", active: true },
    { id: "I", name: "I", active: true },
  ];
  const games: GameResult[] = [];
  let gid = 0;
  for (let i = 0; i < 3; i++) games.push(game(`t${gid++}`, "2026-02-01", ["G", "H"], "G", "H"));
  for (let i = 0; i < 4; i++) games.push(game(`t${gid++}`, "2026-02-01", ["G", "H"], "H", "G"));
  for (let i = 0; i < 1; i++) games.push(game(`t${gid++}`, "2026-02-01", ["G", "I"], "G", "I"));
  for (let i = 0; i < 2; i++) games.push(game(`t${gid++}`, "2026-02-01", ["G", "I"], "I", "G"));

  const entries = computeNemesisAndVictim(participants, games);
  const g = entries.find((x) => x.id === "G");
  if (!g) throw new Error("case12: no NemesisVictimEntry for G");
  assert(
    g.nemesis?.opponentId === "H",
    `case12: both H and I are margin -1, H has more volume (7 vs 3) so should win the tie-break, got ${JSON.stringify(g.nemesis)}`
  );
}

// Case 13 (v2.25 §36.1): involvementRate and its relationship to winRate/winRateB.
{
  const participants: ParticipantLike[] = [
    { id: "IA", name: "IA", active: true },
    { id: "IB", name: "IB", active: true },
  ];
  const games: GameResult[] = [];
  let gid = 0;
  // IA: 3 wins, 1 loss, plus 2 games where IA merely attends (bystander) ->
  // appearances=6, decisive=4. involvementRate = 4/6.
  for (let i = 0; i < 3; i++) games.push(game(`iv${gid++}`, "2026-02-01", ["IA", "IB"], "IA", "IB"));
  games.push(game(`iv${gid++}`, "2026-02-01", ["IA", "IB"], "IB", "IA"));
  games.push(game(`iv${gid++}`, "2026-02-01", ["IA", "IB", "IC"], "IB", "IC"));
  games.push(game(`iv${gid++}`, "2026-02-01", ["IA", "IB", "IC"], "IC", "IB"));

  const stats = computeParticipantStats(participants, games);
  const ia = stats.find((s) => s.id === "IA")!;
  assert(ia.appearances === 6, `case13: IA should have 6 appearances, got ${ia.appearances}`);
  assert(close(ia.involvementRate, 4 / 6), `case13: IA involvementRate should be 4/6, got ${ia.involvementRate}`);
  assert(
    close(ia.winRateB, ia.winRate * ia.involvementRate),
    `case13: 승률B should equal 승률A × 관여율, got winRateB=${ia.winRateB} winRate*involvementRate=${ia.winRate * ia.involvementRate}`
  );
}

// Style map σ_null tests (PRD §36.2.2/§36.2.5) reuse the same daysAgo helper
// as cases 8-9 so games land inside the rolling 90-day window.

// Case 14: σ formula. A participant with only 1-point, 5-person games (n=5)
// over G=100 attended games should get engSd == sqrt((n-2)/(2G)) and
// perfSd == sqrt(2n/G) exactly (both formulas reduce to the same sum this
// function actually computes, just algebraically simplified for the
// all-1-point/fixed-n case — see PRD §36.2.2).
{
  const ids = ["SG1", "SG2", "SG3", "SG4", "SG5"];
  const participants: ParticipantLike[] = ids.map((id) => ({ id, name: id, active: true }));
  const games: GameResult[] = [];
  let gid = 0;
  // 20 rounds of the 5-cycle (5 games/round, everyone attends all 5) ->
  // 100 attended games per participant, all n=5, points=1 (default).
  for (let round = 0; round < 20; round++) {
    for (let i = 0; i < 5; i++) {
      const winner = ids[i];
      const loser = ids[(i + 1) % 5];
      games.push(game(`sig${gid++}`, daysAgo(10), ids, winner, loser));
    }
  }
  const points = computeStyleMap(participants, games, "all");
  const p = styleRowFor(points, "SG1");
  if (!p) throw new Error("case14: no StyleMapPoint for SG1");
  const n = 5;
  const G = 100;
  const expectedEngSd = Math.sqrt((n - 2) / (2 * G));
  const expectedPerfSd = Math.sqrt((2 * n) / G);
  assert(close(p.engSd, expectedEngSd, 1e-9), `case14: engSd should equal sqrt((n-2)/2G)=${expectedEngSd}, got ${p.engSd}`);
  assert(close(p.perfSd, expectedPerfSd, 1e-9), `case14: perfSd should equal sqrt(2n/G)=${expectedPerfSd}, got ${p.perfSd}`);
  // v2.25 값 불변 확인: 새 σ 계산이 engagement/performance 자체를 바꾸지
  // 않는다 — 기대치대로인 라운드로빈 구성이므로 여전히 1.00/0이어야 한다.
  assert(close(p.engagement, 1.0), `case14: engagement must be unaffected by the σ addition, got ${p.engagement}`);
  assert(close(p.performance, 0), `case14: performance must be unaffected by the σ addition, got ${p.performance}`);
}

// Case 15: 2-person games -> engSd === 0 exactly (a 2-person game always has
// a decisive winner/loser, so there's no luck-driven spread on the ENG axis).
{
  const participants: ParticipantLike[] = [
    { id: "TW1", name: "TW1", active: true },
    { id: "TW2", name: "TW2", active: true },
  ];
  const games: GameResult[] = [];
  for (let i = 0; i < 10; i++) {
    games.push(game(`tw${i}`, daysAgo(5), ["TW1", "TW2"], i % 2 === 0 ? "TW1" : "TW2", i % 2 === 0 ? "TW2" : "TW1"));
  }
  const points = computeStyleMap(participants, games, "all");
  const p = styleRowFor(points, "TW1");
  if (!p) throw new Error("case15: no StyleMapPoint for TW1");
  assert(p.engSd === 0, `case15: a participant with only 2-person games must have engSd exactly 0, got ${p.engSd}`);
}

// Case 16: point weighting increases σ — mixing in a higher-point game
// should raise both engSd and perfSd relative to an all-1-point baseline
// with the same game count.
{
  const baseParticipants: ParticipantLike[] = [
    { id: "PW1", name: "PW1", active: true },
    { id: "PW2", name: "PW2", active: true },
    { id: "PW3", name: "PW3", active: true },
    { id: "PW4", name: "PW4", active: true },
    { id: "PW5", name: "PW5", active: true },
  ];
  const table = ["PW1", "PW2", "PW3", "PW4", "PW5"];
  const baselineGames: GameResult[] = [];
  for (let i = 0; i < 10; i++) {
    baselineGames.push(game(`pwb${i}`, daysAgo(5), table, table[i % 5], table[(i + 1) % 5]));
  }
  const weightedGames = baselineGames.map((g, i) => (i === 0 ? { ...g, points: 2 } : g));

  const baselinePoints = computeStyleMap(baseParticipants, baselineGames, "all");
  const weightedPoints = computeStyleMap(baseParticipants, weightedGames, "all");
  const base = styleRowFor(baselinePoints, "PW1");
  const weighted = styleRowFor(weightedPoints, "PW1");
  if (!base || !weighted) throw new Error("case16: missing StyleMapPoint for PW1");
  assert(
    weighted.engSd > base.engSd,
    `case16: mixing in a 2-point game should raise engSd above the all-1-point baseline, got base=${base.engSd} weighted=${weighted.engSd}`
  );
  assert(
    weighted.perfSd > base.perfSd,
    `case16: mixing in a 2-point game should raise perfSd above the all-1-point baseline, got base=${base.perfSd} weighted=${weighted.perfSd}`
  );
}

// Case 17 (v2.25 regression guard): computeQuarterlyTiers' output must be
// exactly unaffected by the style-map σ work, since it never touches
// QuarterAccumulator (a separate local map inside computeStyleMap holds the
// new variance sums). Locks in hand-derived TR/winIndex/lossIndex/perf for a
// deterministic scenario: P attends 8 4-person games (e=0.25 each), winning
// 6 and losing 2 -> E_w=2.0, E_p=2.0, winIndex=3.0, lossIndex=1.0, perf=2.0,
// confidence=2/(2+TIER_E0=8)=0.2, TR=1000+500*2.0*0.2=1200 -> "master".
{
  const participants: ParticipantLike[] = [
    { id: "RG1", name: "RG1", active: true },
    { id: "RG2", name: "RG2", active: true },
    { id: "RG3", name: "RG3", active: true },
    { id: "RG4", name: "RG4", active: true },
  ];
  const table = ["RG1", "RG2", "RG3", "RG4"];
  const games: GameResult[] = [];
  for (let i = 0; i < 6; i++) games.push(game(`rg-w${i}`, "2026-02-01", table, "RG1", "RG2"));
  for (let i = 0; i < 2; i++) games.push(game(`rg-l${i}`, "2026-02-02", table, "RG2", "RG1"));

  const rows = computeQuarterlyTiers(participants, games, "all").get("2026-Q1") ?? [];
  const rg1 = rowFor(rows, "RG1");
  assert(close(rg1.winIndex, 3.0, 1e-9), `case17: winIndex should be exactly 3.0, got ${rg1.winIndex}`);
  assert(close(rg1.lossIndex, 1.0, 1e-9), `case17: lossIndex should be exactly 1.0, got ${rg1.lossIndex}`);
  assert(close(rg1.perf, 2.0, 1e-9), `case17: perf should be exactly 2.0, got ${rg1.perf}`);
  assert(close(rg1.tr, 1200, 1e-9), `case17: TR should be exactly 1200, got ${rg1.tr}`);
  assert(rg1.tier === "master", `case17: TR 1200 should land in "master", got ${rg1.tier}`);
}

// Case 18 (v2.25 §36.2.3): computeStyleMapDomain, tested as a pure function
// directly on synthetic StyleMapPoint[] — no game data needed.
function stylePoint(engagement: number, performance: number, engSd: number, perfSd: number): StyleMapPoint {
  return { id: "x", name: "x", engagement, performance, winIndex: 0, lossIndex: 0, games: 1, engSd, perfSd };
}
{
  // 18a: all points exactly at center -> robustSD is 0, so half-width falls
  // to k * mean(σ_null).
  const points = [
    stylePoint(1.0, 0, 0.1, 0.5),
    stylePoint(1.0, 0, 0.1, 0.5),
    stylePoint(1.0, 0, 0.1, 0.5),
  ];
  const domain = computeStyleMapDomain(points);
  assert(close(domain.xHalfWidth, 0.3, 1e-9), `case18a: half-width should fall to 3*mean(engSd)=0.3, got ${domain.xHalfWidth}`);
  assert(close(domain.yHalfWidth, 1.5, 1e-9), `case18a: half-width should fall to 3*mean(perfSd)=1.5, got ${domain.yHalfWidth}`);
}
{
  // 18b: one extreme outlier (engagement=5.0) among 6 centered points must
  // not drag the half-width toward it — robust (median-based) SD, unlike a
  // min/max-based one, is barely moved by a single outlier.
  const points = [
    ...Array.from({ length: 6 }, () => stylePoint(1.0, 0, 0.05, 0.05)),
    stylePoint(5.0, 0, 0.05, 0.05),
  ];
  const domain = computeStyleMapDomain(points);
  assert(
    close(domain.xHalfWidth, 0.15, 1e-9),
    `case18b: half-width must not be dragged by the single outlier (should stay at the σ_null floor 0.15), got ${domain.xHalfWidth}`
  );
}
{
  // 18c: half-width must never exceed the absolute clamp, however spread out
  // the points are.
  const points = [
    stylePoint(1, 0, 0.05, 0.05),
    stylePoint(3, 4, 0.05, 0.05),
    stylePoint(5, -8, 0.05, 0.05),
    stylePoint(7, 12, 0.05, 0.05),
    stylePoint(9, -16, 0.05, 0.05),
  ];
  const domain = computeStyleMapDomain(points);
  assert(domain.xHalfWidth <= STYLE_MAP_X_HALF_MAX, `case18c: xHalfWidth must never exceed the clamp ${STYLE_MAP_X_HALF_MAX}, got ${domain.xHalfWidth}`);
  assert(domain.yHalfWidth <= STYLE_MAP_Y_HALF_MAX, `case18c: yHalfWidth must never exceed the clamp ${STYLE_MAP_Y_HALF_MAX}, got ${domain.yHalfWidth}`);
  assert(close(domain.xHalfWidth, STYLE_MAP_X_HALF_MAX, 1e-9), `case18c: this scenario's spread should hit the clamp exactly, got ${domain.xHalfWidth}`);
  assert(close(domain.yHalfWidth, STYLE_MAP_Y_HALF_MAX, 1e-9), `case18c: this scenario's spread should hit the clamp exactly, got ${domain.yHalfWidth}`);
}

console.log("Done.");
