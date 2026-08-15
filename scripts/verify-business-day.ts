// Quick standalone sanity check for the v2.16 business-day redefinition
// (06:00-30:00 day boundary), its v2.17 backfill (PRD §20), and the v2.18
// display/group split (PRD §22). Run with: npm run verify:business-day
import {
  BUSINESS_DAY_START_HOUR,
  EDIT_WINDOW_MS,
  addDaysToIsoDate,
  businessDateFromWallClock,
  calendarDateFromBusinessDay,
  editWindowRemainingMs,
  gameWallClock,
  isWithinEditWindow,
  minutesSinceBusinessDayStart,
  seoulLocalToUtcIso,
} from "../src/lib/time";
import { withinDayKey } from "../src/lib/games";
import { planBusinessDayBackfill } from "../src/lib/backfill";
import { computeGameNightBoard, ParticipantLike } from "../src/lib/stats";
import { GameResult, GameType } from "../src/lib/types";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("PASS:", msg);
  }
}

assert(BUSINESS_DAY_START_HOUR === 6, "business day starts at 06:00");

// The exact examples from the PRD/spec conversation.
assert(
  businessDateFromWallClock("2026-08-15", "02:00") === "2026-08-14",
  "8/15 02:00 belongs to 8/14"
);
assert(
  businessDateFromWallClock("2026-08-15", "05:59") === "2026-08-14",
  "8/15 05:59 (just before the boundary) belongs to 8/14"
);
assert(
  businessDateFromWallClock("2026-08-15", "06:00") === "2026-08-15",
  "8/15 06:00 (exactly the boundary) belongs to 8/15"
);
assert(
  businessDateFromWallClock("2026-08-15", "23:59") === "2026-08-15",
  "8/15 23:59 belongs to 8/15"
);

// Month/year boundaries must roll over correctly too, not just day-of-month.
assert(
  businessDateFromWallClock("2026-01-01", "01:00") === "2025-12-31",
  "new year's 01:00 belongs to the previous year's last day"
);
assert(addDaysToIsoDate("2026-03-01", -1) === "2026-02-28", "day before 2026-03-01 is 2026-02-28");
assert(addDaysToIsoDate("2024-03-01", -1) === "2024-02-29", "leap year: day before 2024-03-01 is 2024-02-29");

// Within-day ordering must survive the midnight crossing: a game logged at
// 01:30 belongs to the same game night as one logged at 22:00 earlier that
// evening and must sort after it, not before.
assert(
  minutesSinceBusinessDayStart("06:00") === 0,
  "06:00 is minute 0 of the business day"
);
assert(
  minutesSinceBusinessDayStart("05:59") === 1439,
  "05:59 is the last minute of the business day"
);
assert(
  minutesSinceBusinessDayStart("22:00") < minutesSinceBusinessDayStart("01:30"),
  "22:00 sorts before 01:30 within the same business day"
);

function game(id: string, date: string, time: string | undefined, createdAt: string): GameResult {
  return {
    id,
    date,
    time,
    attendeeIds: ["A", "B"],
    winnerId: "A",
    loserId: "B",
    createdAt,
  };
}

const gLegacy = game("g0", "2026-08-14", undefined, "2026-08-14T12:00:00.000Z");
const gEvening = game("g1", "2026-08-14", "22:00", "2026-08-14T13:00:00.000Z");
const gLateNight = game("g2", "2026-08-14", "01:30", "2026-08-15T16:30:00.000Z");
const sorted = [gLateNight, gLegacy, gEvening].sort((a, b) =>
  withinDayKey(a).localeCompare(withinDayKey(b))
);
assert(
  sorted.map((g) => g.id).join(",") === "g0,g1,g2",
  `late-night game must sort after the same evening's earlier game, got ${sorted
    .map((g) => g.id)
    .join(",")}`
);

// ---------- v2.17: planBusinessDayBackfill (PRD §20) ----------
// createdAt values are built with seoulLocalToUtcIso so each test states its
// intent as "what did the Seoul clock read" rather than a hand-computed UTC
// offset — the same helper the admin rollback screen already relies on.

// 1) Pre-v2.16 auto-recorded 새벽 기록: date still the raw calendar date.
const createdAt1 = seoulLocalToUtcIso("2026-08-15T01:00");
const v1 = planBusinessDayBackfill({ date: "2026-08-15", time: "01:00", createdAt: createdAt1 });
assert(
  v1.action === "update" && v1.date === "2026-08-14",
  `case1: pre-v2.16 새벽 기록은 update로 8/14가 되어야 함, got ${JSON.stringify(v1)}`
);

// 2) Pre-v2.16 auto-recorded 저녁 기록: calendar date already equals the
//    business date, so nothing should change.
const createdAt2 = seoulLocalToUtcIso("2026-08-14T22:00");
const v2 = planBusinessDayBackfill({ date: "2026-08-14", time: "22:00", createdAt: createdAt2 });
assert(
  v2.action === "skip" && v2.reason === "already-correct",
  `case2: pre-v2.16 저녁 기록은 손대면 안 됨(skip/already-correct), got ${JSON.stringify(v2)}`
);

// 3) Post-v2.16 auto-recorded 새벽 기록: nowInSeoulBusinessDay() already
//    wrote the business date, not the calendar date.
const createdAt3 = seoulLocalToUtcIso("2026-08-15T01:00");
const v3 = planBusinessDayBackfill({ date: "2026-08-14", time: "01:00", createdAt: createdAt3 });
assert(
  v3.action === "skip" && v3.reason === "already-correct",
  `case3: post-v2.16 새벽 기록은 이미 정상이어야 함, got ${JSON.stringify(v3)}`
);

// 4) Idempotency — feeding case 1's own update result back in must yield
//    "skip", not another shift. This is the single most important guarantee
//    in this whole feature (PRD §20.2's "naive `time < 06:00` shift" bug is
//    exactly a failure of this test).
if (v1.action === "update") {
  const v1Again = planBusinessDayBackfill({
    date: v1.date,
    time: v1.time ?? "01:00",
    createdAt: createdAt1,
  });
  assert(
    v1Again.action === "skip" && v1Again.reason === "already-correct",
    `case4: 백필된 행을 다시 넣으면 skip이어야 함(멱등성), got ${JSON.stringify(v1Again)}`
  );
} else {
  assert(false, "case4: precondition failed — case1 didn't produce an update");
}

// 5) Admin manually corrected the date/time via §11 — must never be
//    overwritten, regardless of what createdAt implies.
const createdAt5 = seoulLocalToUtcIso("2026-08-15T01:00");
const v5 = planBusinessDayBackfill({ date: "2026-07-01", time: "01:00", createdAt: createdAt5 });
assert(
  v5.action === "skip" && v5.reason === "manually-edited",
  `case5: 관리자가 손으로 고친 기록은 manually-edited로 건너뛰어야 함, got ${JSON.stringify(v5)}`
);

// 6) Legacy row with no `time` at all (field predates its own existence):
//    the date must move AND time must be backfilled from createdAt, or
//    withinDayKey would sort it as minute 0 (the very front of the business
//    day) instead of where it actually belongs.
const createdAt6 = seoulLocalToUtcIso("2026-08-15T03:00");
const v6 = planBusinessDayBackfill({ date: "2026-08-15", time: undefined, createdAt: createdAt6 });
assert(
  v6.action === "update" && v6.date === "2026-08-14" && v6.time === "03:00",
  `case6: time 없는 레거시 행은 date와 time을 함께 채워야 함, got ${JSON.stringify(v6)}`
);

// 7) Boundary, exercised through the full backfill decision (not just
//    businessDateFromWallClock directly, which case 1 of the file above
//    already covers).
const createdAtBoundary = seoulLocalToUtcIso("2026-08-15T06:00");
const vBoundary = planBusinessDayBackfill({
  date: "2026-08-15",
  time: "06:00",
  createdAt: createdAtBoundary,
});
assert(
  vBoundary.action === "skip" && vBoundary.reason === "already-correct",
  `case7a: 정확히 06:00은 날짜가 안 바뀌어야 함, got ${JSON.stringify(vBoundary)}`
);
const createdAtJustBefore = seoulLocalToUtcIso("2026-08-15T05:59");
const vJustBefore = planBusinessDayBackfill({
  date: "2026-08-15",
  time: "05:59",
  createdAt: createdAtJustBefore,
});
assert(
  vJustBefore.action === "update" && vJustBefore.date === "2026-08-14",
  `case7b: 05:59은 전날로 update 되어야 함, got ${JSON.stringify(vJustBefore)}`
);

// 8) Year boundary.
const createdAt8 = seoulLocalToUtcIso("2026-01-01T01:00");
const v8 = planBusinessDayBackfill({ date: "2026-01-01", time: "01:00", createdAt: createdAt8 });
assert(
  v8.action === "update" && v8.date === "2025-12-31",
  `case8: 새해 첫날 새벽 기록은 작년 마지막 날로 update 되어야 함, got ${JSON.stringify(v8)}`
);

// ---------- v2.18: calendarDateFromBusinessDay / gameWallClock (PRD §22) ----------

// 1) Round-trip invariant: businessDateFromWallClock is the true inverse of
// calendarDateFromBusinessDay for any (business date, time) pair. This is
// the single most important guarantee for this feature — if it breaks, the
// displayed calendar date and the group a game actually sorts/filters under
// would silently disagree.
const roundTripDate = "2026-08-14";
const roundTripTimes = ["00:00", "01:00", "05:59", "06:00", "12:00", "23:59"];
for (const t of roundTripTimes) {
  const calendar = calendarDateFromBusinessDay(roundTripDate, t);
  const backToBusiness = businessDateFromWallClock(calendar, t);
  assert(
    backToBusiness === roundTripDate,
    `case9 (${t}): businessDateFromWallClock(calendarDateFromBusinessDay(d,t), t) should equal d, got ${backToBusiness}`
  );
}

// 2) The headline case from the bug report: a game grouped under business
// date 8/14 at 01:00 actually happened on the calendar date 8/15.
assert(
  calendarDateFromBusinessDay("2026-08-14", "01:00") === "2026-08-15",
  "case10: business date 8/14 + 01:00 was actually played on 8/15"
);

// 3) Boundary: exactly 06:00 doesn't cross midnight; 05:59 does.
assert(
  calendarDateFromBusinessDay("2026-08-14", "06:00") === "2026-08-14",
  "case11a: exactly 06:00 stays on the same calendar date"
);
assert(
  calendarDateFromBusinessDay("2026-08-14", "05:59") === "2026-08-15",
  "case11b: 05:59 rolls forward to the next calendar date"
);

// 4) Month/year boundary.
assert(
  calendarDateFromBusinessDay("2025-12-31", "01:00") === "2026-01-01",
  "case12: business date 2025-12-31 + 01:00 was actually played on New Year's Day"
);

// 5) gameWallClock: a legacy row with no `time` can't have its wall clock
// recovered, so it must pass the business date through unchanged and never
// claim a (false) midnight crossing.
const legacyWallClock = gameWallClock("2026-08-14", undefined);
assert(
  legacyWallClock.date === "2026-08-14" &&
    legacyWallClock.time === undefined &&
    legacyWallClock.crossedMidnight === false,
  `case13: a time-less legacy row must pass its date through with crossedMidnight=false, got ${JSON.stringify(
    legacyWallClock
  )}`
);

// 6) Display vs. grouping consistency: two games from the same game night —
// one before and one after real midnight — must display on *different*
// calendar dates (that's the whole point of this feature) while both still
// folding back to the same business date (so the grouping v2.16/v2.17
// already established is untouched by this display-only change).
const eveningWallClock = gameWallClock("2026-08-14", "22:00");
const lateNightWallClock = gameWallClock("2026-08-14", "01:00");
assert(
  eveningWallClock.date === "2026-08-14" && lateNightWallClock.date === "2026-08-15",
  `case14a: same game night's evening/late-night games must display on different calendar dates, got ${JSON.stringify(
    { evening: eveningWallClock.date, lateNight: lateNightWallClock.date }
  )}`
);
assert(
  businessDateFromWallClock(eveningWallClock.date, "22:00") === "2026-08-14" &&
    businessDateFromWallClock(lateNightWallClock.date, "01:00") === "2026-08-14",
  "case14b: both must still fold back to the same business date 2026-08-14"
);

// 7) v2.19 (배치 B, PRD §24.12) — editWindowRemainingMs: the live-countdown
// chip's data source. A row created "just now" should read back
// approximately the full window (allow a small tolerance for the ms elapsed
// between building createdAt and calling the function); one created
// EDIT_WINDOW_MS + 1 minute ago must already be negative; and the two
// helpers must never disagree about whether a row is still editable.
const justNow = new Date().toISOString();
const remainingForJustNow = editWindowRemainingMs(justNow);
assert(
  Math.abs(remainingForJustNow - EDIT_WINDOW_MS) < 5000,
  `case15a: a row created just now should have ~EDIT_WINDOW_MS remaining, got ${remainingForJustNow}`
);
const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
assert(
  editWindowRemainingMs(threeHoursAgo) < 0,
  `case15b: a row created 3 hours ago should have negative remaining time, got ${editWindowRemainingMs(threeHoursAgo)}`
);
for (const createdAt of [
  justNow,
  threeHoursAgo,
  new Date(Date.now() - EDIT_WINDOW_MS / 2).toISOString(), // halfway through
]) {
  assert(
    isWithinEditWindow(createdAt) === editWindowRemainingMs(createdAt) > 0,
    `case15c: isWithinEditWindow and editWindowRemainingMs must agree for createdAt=${createdAt}, got isWithinEditWindow=${isWithinEditWindow(
      createdAt
    )} remaining=${editWindowRemainingMs(createdAt)}`
  );
}

// v2.20 (PRD §26) — computeGameNightBoard. This is the function most
// dependent on the business-day rules above (withinDayKey ordering, active
// filtering), which is why its tests live in this file rather than in a
// stats-specific script.
function mkGame(opts: {
  id: string;
  date: string;
  time?: string;
  createdAt: string;
  attendeeIds: string[];
  winnerId: string;
  loserId: string;
  points?: number;
  gameType?: GameType;
  active?: boolean;
}): GameResult {
  return {
    id: opts.id,
    date: opts.date,
    time: opts.time,
    attendeeIds: opts.attendeeIds,
    winnerId: opts.winnerId,
    loserId: opts.loserId,
    points: opts.points,
    gameType: opts.gameType,
    active: opts.active,
    createdAt: opts.createdAt,
  };
}

// Case 1: not a game night — no active game on that business date -> null.
{
  const participants: ParticipantLike[] = [{ id: "A", name: "A", active: true }];
  const games: GameResult[] = [
    mkGame({
      id: "g0",
      date: "2026-08-13", // a different business date
      time: "20:00",
      createdAt: "2026-08-13T11:00:00.000Z",
      attendeeIds: ["A", "B"],
      winnerId: "A",
      loserId: "B",
    }),
  ];
  const board = computeGameNightBoard(participants, games, "2026-08-14");
  assert(board === null, "case1 (게임 밤 아님): no active game on the target business date must return null");
}

// Case 2: midnight crossing — a 22:00 game and a 01:00 game both filed under
// the same business date (2026-08-14) must both appear on the same board,
// and latestGame must be the 01:00 one — proving withinDayKey (not
// createdAt, and not a raw "HH:mm" string compare) governs ordering. The
// 22:00 game is deliberately given a LATER createdAt than the 01:00 game, so
// a createdAt-based (or naive string) sort would get this backwards.
{
  const participants: ParticipantLike[] = [
    { id: "A", name: "A", active: true },
    { id: "B", name: "B", active: true },
  ];
  const evening = mkGame({
    id: "g-evening",
    date: "2026-08-14",
    time: "22:00",
    createdAt: "2026-08-14T20:00:00.000Z", // recorded LATER
    attendeeIds: ["A", "B"],
    winnerId: "A",
    loserId: "B",
  });
  const lateNight = mkGame({
    id: "g-latenight",
    date: "2026-08-14",
    time: "01:00",
    createdAt: "2026-08-14T13:00:00.000Z", // recorded EARLIER
    attendeeIds: ["A", "B"],
    winnerId: "B",
    loserId: "A",
  });
  const board = computeGameNightBoard(participants, [evening, lateNight], "2026-08-14");
  assert(board !== null, "case2 (자정 교차): board must exist");
  assert(board?.totalGames === 2, `case2: both games should count toward the same board, got ${board?.totalGames}`);
  assert(
    board?.latestGame?.id === "g-latenight",
    `case2: latestGame must be the 01:00 game (withinDayKey order), got ${board?.latestGame?.id}`
  );
}

// Case 3: attendees with no decisive game yet still appear as 0승0패.
{
  const participants: ParticipantLike[] = [
    { id: "A", name: "A", active: true },
    { id: "B", name: "B", active: true },
    { id: "C", name: "C", active: true },
  ];
  const games: GameResult[] = [
    mkGame({
      id: "g1",
      date: "2026-08-14",
      time: "20:00",
      createdAt: "2026-08-14T11:00:00.000Z",
      attendeeIds: ["A", "B", "C"], // C is a bystander this game
      winnerId: "A",
      loserId: "B",
    }),
  ];
  const board = computeGameNightBoard(participants, games, "2026-08-14");
  const rowC = board?.rows.find((r) => r.id === "C");
  assert(rowC !== undefined, "case3 (승패 없는 참석자): C attended but never won/lost — must still appear in rows");
  assert(
    rowC?.wins === 0 && rowC?.losses === 0 && rowC?.netPoints === 0,
    `case3: C should show 0승0패0점, got ${JSON.stringify(rowC)}`
  );
}

// Case 4: a participant who exists in the roster but wasn't at tonight's
// table must not appear at all.
{
  const participants: ParticipantLike[] = [
    { id: "A", name: "A", active: true },
    { id: "B", name: "B", active: true },
    { id: "D", name: "D", active: true }, // in the roster, not tonight
  ];
  const games: GameResult[] = [
    mkGame({
      id: "g1",
      date: "2026-08-14",
      time: "20:00",
      createdAt: "2026-08-14T11:00:00.000Z",
      attendeeIds: ["A", "B"],
      winnerId: "A",
      loserId: "B",
    }),
  ];
  const board = computeGameNightBoard(participants, games, "2026-08-14");
  assert(
    board?.rows.find((r) => r.id === "D") === undefined,
    "case4 (미참석자 제외): D is in the roster but not tonight's attendeeIds — must not appear in rows"
  );
  assert(board?.rows.length === 2, `case4: only A and B should appear, got ${board?.rows.length}`);
}

// Case 5: a soft-deleted game must not affect the count, score, or ranking.
{
  const participants: ParticipantLike[] = [
    { id: "A", name: "A", active: true },
    { id: "B", name: "B", active: true },
  ];
  const games: GameResult[] = [
    mkGame({
      id: "g1",
      date: "2026-08-14",
      time: "20:00",
      createdAt: "2026-08-14T11:00:00.000Z",
      attendeeIds: ["A", "B"],
      winnerId: "A",
      loserId: "B",
    }),
    mkGame({
      id: "g2-deleted",
      date: "2026-08-14",
      time: "20:30",
      createdAt: "2026-08-14T11:30:00.000Z",
      attendeeIds: ["A", "B"],
      winnerId: "B",
      loserId: "A",
      active: false,
    }),
  ];
  const board = computeGameNightBoard(participants, games, "2026-08-14");
  assert(board?.totalGames === 1, `case5 (소프트 삭제 제외): soft-deleted game must not count, got totalGames=${board?.totalGames}`);
  const rowA = board?.rows.find((r) => r.id === "A");
  assert(
    rowA?.wins === 1 && rowA?.losses === 0,
    `case5: A's record must reflect only the active game (1승0패), got ${JSON.stringify(rowA)}`
  );
}

// Case 6: a legacy game with no `points` field counts as 1 point.
{
  const participants: ParticipantLike[] = [
    { id: "A", name: "A", active: true },
    { id: "B", name: "B", active: true },
  ];
  const games: GameResult[] = [
    mkGame({
      id: "g1",
      date: "2026-08-14",
      time: "20:00",
      createdAt: "2026-08-14T11:00:00.000Z",
      attendeeIds: ["A", "B"],
      winnerId: "A",
      loserId: "B",
      // points intentionally omitted
    }),
  ];
  const board = computeGameNightBoard(participants, games, "2026-08-14");
  const rowA = board?.rows.find((r) => r.id === "A");
  assert(rowA?.netPoints === 1, `case6 (레거시 점수): a pointless legacy game should count as 1 point, got ${rowA?.netPoints}`);
}

// Case 7: sort order — net points desc, then wins desc, then Korean name
// order. Construct a 3-way net-points tie where only wins/name differ.
{
  const participants: ParticipantLike[] = [
    { id: "1", name: "다다", active: true },
    { id: "2", name: "나나", active: true },
    { id: "3", name: "가가", active: true },
  ];
  // Table: 4 participants share attendeeIds so every game has a bystander,
  // letting each of 다다/나나/가가 land on net points +1 via a different mix
  // of wins/losses while a 4th (Z) absorbs the extra losses.
  const games: GameResult[] = [
    // 다다: 2승1패 -> net +1 (points default 1 each)
    mkGame({ id: "a1", date: "2026-08-14", time: "20:00", createdAt: "2026-08-14T11:00:00.000Z", attendeeIds: ["1", "Z"], winnerId: "1", loserId: "Z" }),
    mkGame({ id: "a2", date: "2026-08-14", time: "20:05", createdAt: "2026-08-14T11:05:00.000Z", attendeeIds: ["1", "Z"], winnerId: "1", loserId: "Z" }),
    mkGame({ id: "a3", date: "2026-08-14", time: "20:10", createdAt: "2026-08-14T11:10:00.000Z", attendeeIds: ["1", "Z"], winnerId: "Z", loserId: "1" }),
    // 나나: 1승0패 -> net +1
    mkGame({ id: "b1", date: "2026-08-14", time: "20:15", createdAt: "2026-08-14T11:15:00.000Z", attendeeIds: ["2", "Z"], winnerId: "2", loserId: "Z" }),
    // 가가: 1승0패 -> net +1 (same record as 나나 -> tiebreak must be name)
    mkGame({ id: "c1", date: "2026-08-14", time: "20:20", createdAt: "2026-08-14T11:20:00.000Z", attendeeIds: ["3", "Z"], winnerId: "3", loserId: "Z" }),
  ];
  const board = computeGameNightBoard(participants, games, "2026-08-14");
  const order = (board?.rows ?? []).filter((r) => r.id !== "Z").map((r) => r.name);
  assert(
    order[0] === "다다",
    `case7 (정렬): 다다 has the most wins (2) among the net-points-tied group, should rank first, got order=${JSON.stringify(order)}`
  );
  assert(
    order[1] === "가가" && order[2] === "나나",
    `case7: 나나/가가 tie on both net points and wins (1승0패 each) -> Korean name order (가가 before 나나), got order=${JSON.stringify(order)}`
  );
}

// Case 8: tonight's streak, not career streak. A participant who won 3 in a
// row YESTERDAY and lost once TODAY must show streakType "L", length 1 for
// TONIGHT's board — using the career streak here would wrongly show "W"/3.
{
  const participants: ParticipantLike[] = [
    { id: "A", name: "A", active: true },
    { id: "B", name: "B", active: true },
  ];
  const games: GameResult[] = [
    mkGame({ id: "y1", date: "2026-08-13", time: "20:00", createdAt: "2026-08-13T11:00:00.000Z", attendeeIds: ["A", "B"], winnerId: "A", loserId: "B" }),
    mkGame({ id: "y2", date: "2026-08-13", time: "20:05", createdAt: "2026-08-13T11:05:00.000Z", attendeeIds: ["A", "B"], winnerId: "A", loserId: "B" }),
    mkGame({ id: "y3", date: "2026-08-13", time: "20:10", createdAt: "2026-08-13T11:10:00.000Z", attendeeIds: ["A", "B"], winnerId: "A", loserId: "B" }),
    mkGame({ id: "t1", date: "2026-08-14", time: "20:00", createdAt: "2026-08-14T11:00:00.000Z", attendeeIds: ["A", "B"], winnerId: "B", loserId: "A" }),
  ];
  const board = computeGameNightBoard(participants, games, "2026-08-14");
  const rowA = board?.rows.find((r) => r.id === "A");
  assert(
    rowA?.streakType === "L" && rowA?.streakLength === 1,
    `case8 (오늘 밤 스트릭): A won 3 straight yesterday then lost once today — tonight's board must show L/1, not the career W/3 streak. got ${JSON.stringify(rowA)}`
  );
}

console.log("Done.");
