// Quick standalone sanity check for the v2.15 quarterly tier system.
// Run with: npm run verify:tiers  (or: npx tsx scripts/verify-tiers.ts)
import {
  computeQuarterlyTiers,
  computeStyleMap,
  TIER_MIN_WEIGHT,
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

console.log("Done.");
