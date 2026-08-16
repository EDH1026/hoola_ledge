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
  quarterKeyOf,
  seoulLocalToUtcIso,
} from "../src/lib/time";
import { withinDayKey } from "../src/lib/games";
import { planBusinessDayBackfill } from "../src/lib/backfill";
import {
  computeGameDayBoard,
  computeRecentGameDaysSummary,
  computeCumulativeNetPointsTrend,
  computeRecords,
  ParticipantLike,
} from "../src/lib/stats";
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

// v2.21 (PRD §28) — computeGameDayBoard/computeRecentGameDaysSummary/
// computeCumulativeNetPointsTrend. These are the functions most dependent on
// the business-day rules above (withinDayKey ordering, active filtering,
// quarterKeyOf string-safe bucketing), which is why their tests live in this
// file rather than in a stats-specific script.
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

// Case 1: null only when there is truly zero active games, ever — not
// merely "none today." A past-only game must NOT return null (v2.20's
// computeGameNightBoard returned null whenever `today` itself had no games;
// v2.21's computeGameDayBoard targets "the latest date with games" instead).
{
  const participants: ParticipantLike[] = [{ id: "A", name: "A", active: true }];
  const boardEmpty = computeGameDayBoard(participants, [], "2026-08-16");
  assert(boardEmpty === null, "case1a (활성 게임 0판): no games at all -> null");

  const pastGame = mkGame({
    id: "gpast",
    date: "2026-08-10",
    time: "20:00",
    createdAt: "2026-08-10T11:00:00.000Z",
    attendeeIds: ["A", "B"],
    winnerId: "A",
    loserId: "B",
  });
  const boardPastOnly = computeGameDayBoard(participants, [pastGame], "2026-08-16");
  assert(
    boardPastOnly !== null,
    "case1b: a past game (even with none today) must NOT return null — only zero active games ever does"
  );
}

// Case 2: target business day selection — with games on both 8/10 and 8/14
// and today=8/16, the board must target the latest date that actually has
// games (8/14), with status "closed" since that's before today.
{
  const participants: ParticipantLike[] = [
    { id: "A", name: "A", active: true },
    { id: "B", name: "B", active: true },
  ];
  const g10 = mkGame({
    id: "g0810",
    date: "2026-08-10",
    time: "20:00",
    createdAt: "2026-08-10T11:00:00.000Z",
    attendeeIds: ["A", "B"],
    winnerId: "A",
    loserId: "B",
  });
  const g14 = mkGame({
    id: "g0814",
    date: "2026-08-14",
    time: "20:00",
    createdAt: "2026-08-14T11:00:00.000Z",
    attendeeIds: ["A", "B"],
    winnerId: "B",
    loserId: "A",
  });
  const board = computeGameDayBoard(participants, [g10, g14], "2026-08-16");
  assert(
    board?.date === "2026-08-14",
    `case2 (대상 영업일 선택): should target the latest date with games (2026-08-14), got ${board?.date}`
  );
  assert(
    board?.status === "closed",
    `case2: target date (8/14) != today (8/16) -> status must be closed, got ${board?.status}`
  );
}

// Case 3: status "live" when the target date equals today.
{
  const participants: ParticipantLike[] = [
    { id: "A", name: "A", active: true },
    { id: "B", name: "B", active: true },
  ];
  const g = mkGame({
    id: "glive",
    date: "2026-08-16",
    time: "20:00",
    createdAt: "2026-08-16T11:00:00.000Z",
    attendeeIds: ["A", "B"],
    winnerId: "A",
    loserId: "B",
  });
  const board = computeGameDayBoard(participants, [g], "2026-08-16");
  assert(board?.status === "live", `case3 (진행 중): target date === today -> live, got ${board?.status}`);
}

// Case 4: midnight crossing — a 22:00 game and a 01:00 game both filed under
// the same business date (2026-08-14) must both appear in `games`, sorted
// most-recent-first (withinDayKey descending), with games[0] being the
// 01:00 one — proving withinDayKey (not createdAt, and not a raw "HH:mm"
// string compare) governs ordering. The 22:00 game is deliberately given a
// LATER createdAt than the 01:00 game, so a createdAt-based (or naive
// string) sort would get this backwards.
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
  const board = computeGameDayBoard(participants, [evening, lateNight], "2026-08-14");
  assert(board !== null, "case4 (자정 교차): board must exist");
  assert(board?.totalGames === 2, `case4: both games should count toward the same board, got ${board?.totalGames}`);
  assert(board?.games.length === 2, `case4: games[] should hold both, got ${board?.games.length}`);
  assert(
    board?.games[0]?.game.id === "g-latenight",
    `case4: games[0] (most recent first) must be the 01:00 game, got ${board?.games[0]?.game.id}`
  );
  assert(
    board?.games[1]?.game.id === "g-evening",
    `case4: games[1] must be the 22:00 game, got ${board?.games[1]?.game.id}`
  );
}

// Case 5: attendees with no decisive game yet still appear as 0승0패.
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
  const board = computeGameDayBoard(participants, games, "2026-08-14");
  const rowC = board?.rows.find((r) => r.id === "C");
  assert(rowC !== undefined, "case5 (승패 없는 참석자): C attended but never won/lost — must still appear in rows");
  assert(
    rowC?.wins === 0 && rowC?.losses === 0 && rowC?.netPoints === 0,
    `case5: C should show 0승0패0점, got ${JSON.stringify(rowC)}`
  );
}

// Case 6: a participant who exists in the roster but wasn't at that day's
// table must not appear at all.
{
  const participants: ParticipantLike[] = [
    { id: "A", name: "A", active: true },
    { id: "B", name: "B", active: true },
    { id: "D", name: "D", active: true }, // in the roster, not that day
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
  const board = computeGameDayBoard(participants, games, "2026-08-14");
  assert(
    board?.rows.find((r) => r.id === "D") === undefined,
    "case6 (미참석자 제외): D is in the roster but not that day's attendeeIds — must not appear in rows"
  );
  assert(board?.rows.length === 2, `case6: only A and B should appear, got ${board?.rows.length}`);
}

// Case 7: a soft-deleted game must not affect the count, score, or ranking.
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
  const board = computeGameDayBoard(participants, games, "2026-08-14");
  assert(board?.totalGames === 1, `case7 (소프트 삭제 제외): soft-deleted game must not count, got totalGames=${board?.totalGames}`);
  const rowA = board?.rows.find((r) => r.id === "A");
  assert(
    rowA?.wins === 1 && rowA?.losses === 0,
    `case7: A's record must reflect only the active game (1승0패), got ${JSON.stringify(rowA)}`
  );
}

// Case 8: a legacy game with no `points` field counts as 1 point.
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
  const board = computeGameDayBoard(participants, games, "2026-08-14");
  const rowA = board?.rows.find((r) => r.id === "A");
  assert(rowA?.netPoints === 1, `case8 (레거시 점수): a pointless legacy game should count as 1 point, got ${rowA?.netPoints}`);
}

// Case 9: sort order — net points desc, then wins desc, then Korean name
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
  const board = computeGameDayBoard(participants, games, "2026-08-14");
  const order = (board?.rows ?? []).filter((r) => r.id !== "Z").map((r) => r.name);
  assert(
    order[0] === "다다",
    `case9 (정렬): 다다 has the most wins (2) among the net-points-tied group, should rank first, got order=${JSON.stringify(order)}`
  );
  assert(
    order[1] === "가가" && order[2] === "나나",
    `case9: 나나/가가 tie on both net points and wins (1승0패 each) -> Korean name order (가가 before 나나), got order=${JSON.stringify(order)}`
  );
}

// Case 10: that day's streak, not career streak. A participant who won 3 in
// a row YESTERDAY and lost once on the target day must show streakType "L",
// length 1 — using the career streak here would wrongly show "W"/3.
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
  const board = computeGameDayBoard(participants, games, "2026-08-14");
  const rowA = board?.rows.find((r) => r.id === "A");
  assert(
    rowA?.streakType === "L" && rowA?.streakLength === 1,
    `case10 (해당 경기일 스트릭): A won 3 straight yesterday then lost once today — the board must show L/1, not the career W/3 streak. got ${JSON.stringify(rowA)}`
  );
}

// Case 11: computeRecentGameDaysSummary's 7-day window — today plus the 6
// days before it are all in range (no count cap), and the 8th day back is
// excluded.
{
  const today11 = "2026-08-16";
  const participants11: ParticipantLike[] = [
    { id: "A", name: "A", active: true },
    { id: "B", name: "B", active: true },
  ];
  const games11: GameResult[] = [];
  for (let i = 0; i <= 6; i++) {
    const d = addDaysToIsoDate(today11, -i);
    games11.push(
      mkGame({ id: `d${i}`, date: d, time: "20:00", createdAt: `${d}T11:00:00.000Z`, attendeeIds: ["A", "B"], winnerId: "A", loserId: "B" })
    );
  }
  const outside = addDaysToIsoDate(today11, -7);
  games11.push(
    mkGame({ id: "out", date: outside, time: "20:00", createdAt: `${outside}T11:00:00.000Z`, attendeeIds: ["A", "B"], winnerId: "A", loserId: "B" })
  );

  const summary11 = computeRecentGameDaysSummary(participants11, games11, today11);
  assert(summary11.length === 7, `case11 (7일 창): expected all 7 in-window days with no cap, got ${summary11.length}`);
  assert(
    !summary11.some((d) => d.date === outside),
    `case11: the 8th-day-back entry must be excluded, got dates=${summary11.map((d) => d.date)}`
  );
}

// Case 12: 7-day window across a month/year boundary — today=2026-01-03, so
// the window's earliest day (today - 6) is 2025-12-28, and a game logged
// there must be included (exercises addDaysToIsoDate's month/year rollover,
// not just same-month arithmetic).
{
  const today12 = "2026-01-03";
  const target = addDaysToIsoDate(today12, -6);
  assert(target === "2025-12-28", `case12 sanity: addDaysToIsoDate(2026-01-03, -6) should be 2025-12-28, got ${target}`);

  const participants12: ParticipantLike[] = [
    { id: "A", name: "A", active: true },
    { id: "B", name: "B", active: true },
  ];
  const games12: GameResult[] = [
    mkGame({ id: "g12", date: target, time: "20:00", createdAt: `${target}T11:00:00.000Z`, attendeeIds: ["A", "B"], winnerId: "A", loserId: "B" }),
  ];
  const summary12 = computeRecentGameDaysSummary(participants12, games12, today12);
  assert(
    summary12.some((d) => d.date === target),
    `case12 (연 경계): a game day 6 days before 2026-01-03 (2025-12-28) must be included in the 7-day window, got ${JSON.stringify(summary12)}`
  );
}

// Case 13: computeRecords' daily margin (하루 최고/최저 득실차). A: 1 win
// worth 2 points + 2 losses worth 1 point each on the same day -> margin 0.
// B: 3 wins worth 1 point each, 0 losses -> margin +3 (the day's best). X
// loses a 2-point game and nothing else -> margin -2 (the day's worst). C
// attends as a pure bystander (never wins/loses) and must not appear in
// either category at all.
{
  const participants13: ParticipantLike[] = [
    { id: "A", name: "A", active: true },
    { id: "B", name: "B", active: true },
    { id: "C", name: "C", active: true },
    { id: "X", name: "X", active: true },
    { id: "Y1", name: "Y1", active: true },
    { id: "Y2", name: "Y2", active: true },
    { id: "Y3", name: "Y3", active: true },
  ];
  const games13: GameResult[] = [
    mkGame({ id: "m1", date: "2026-08-14", time: "20:00", createdAt: "2026-08-14T11:00:00.000Z", attendeeIds: ["A", "X", "C"], winnerId: "A", loserId: "X", points: 2 }),
    mkGame({ id: "m2", date: "2026-08-14", time: "20:05", createdAt: "2026-08-14T11:05:00.000Z", attendeeIds: ["A", "Y1"], winnerId: "Y1", loserId: "A" }),
    mkGame({ id: "m3", date: "2026-08-14", time: "20:10", createdAt: "2026-08-14T11:10:00.000Z", attendeeIds: ["A", "Y2"], winnerId: "Y2", loserId: "A" }),
    mkGame({ id: "m4", date: "2026-08-14", time: "20:15", createdAt: "2026-08-14T11:15:00.000Z", attendeeIds: ["B", "Y1"], winnerId: "B", loserId: "Y1" }),
    mkGame({ id: "m5", date: "2026-08-14", time: "20:20", createdAt: "2026-08-14T11:20:00.000Z", attendeeIds: ["B", "Y2"], winnerId: "B", loserId: "Y2" }),
    mkGame({ id: "m6", date: "2026-08-14", time: "20:25", createdAt: "2026-08-14T11:25:00.000Z", attendeeIds: ["B", "Y3"], winnerId: "B", loserId: "Y3" }),
  ];
  const records13 = computeRecords(participants13, games13);
  const bestEntries = records13.bestDailyMargin.flatMap((tier) => tier.entries);
  const worstEntries = records13.worstDailyMargin.flatMap((tier) => tier.entries);

  assert(
    records13.bestDailyMargin[0]?.entries.some((e) => e.id === "B" && e.value === 3),
    `case13 (하루 최고 득실차): B (3승0패, 각 1점) should top bestDailyMargin at +3, got ${JSON.stringify(records13.bestDailyMargin[0])}`
  );
  assert(
    records13.worstDailyMargin[0]?.entries.some((e) => e.id === "X" && e.value === -2),
    `case13 (하루 최저 득실차): X (2점짜리 게임에서 짐) should top worstDailyMargin at -2, got ${JSON.stringify(records13.worstDailyMargin[0])}`
  );
  assert(
    !bestEntries.some((e) => e.id === "C") && !worstEntries.some((e) => e.id === "C"),
    "case13: C attended only as a bystander (never won/lost) — must not appear in either daily-margin category"
  );
}

// Case 14: computeCumulativeNetPointsTrend's "quarter" grouping must bucket
// by quarterKeyOf (string slicing), not `new Date(date)` — a 2026-01-01 game
// must land in 2026-Q1, not get shifted to 2025-Q4 by a UTC-midnight parse.
{
  const games14: GameResult[] = [
    mkGame({ id: "q1a", date: "2026-01-01", time: "20:00", createdAt: "2026-01-01T11:00:00.000Z", attendeeIds: ["A", "B"], winnerId: "A", loserId: "B" }),
    mkGame({ id: "q1b", date: "2026-03-31", time: "20:00", createdAt: "2026-03-31T11:00:00.000Z", attendeeIds: ["A", "B"], winnerId: "A", loserId: "B" }),
    mkGame({ id: "q2a", date: "2026-04-01", time: "20:00", createdAt: "2026-04-01T11:00:00.000Z", attendeeIds: ["A", "B"], winnerId: "A", loserId: "B" }),
  ];
  const rows14 = computeCumulativeNetPointsTrend(games14, "quarter");
  assert(
    rows14.length === 2,
    `case14 (분기 버킷): 2026-01-01/03-31 should share one Q1 bucket and 2026-04-01 a separate Q2 bucket, got ${rows14.length} (${rows14.map((r) => r.label).join(",")})`
  );
  assert(
    rows14[0]?.label === quarterKeyOf("2026-01-01") && rows14[0]?.label === "2026-Q1",
    `case14: the 2026-01-01 game's bucket must be 2026-Q1 (matching quarterKeyOf, not shifted by UTC parsing), got ${rows14[0]?.label}`
  );
  assert(rows14[1]?.label === "2026-Q2", `case14: the 2026-04-01 game must land in a separate 2026-Q2 bucket, got ${rows14[1]?.label}`);
}

// Case 15: computeCumulativeNetPointsTrend's "game" grouping plots one row
// per active game (soft-deleted games excluded from the row count), ordered
// by withinDayKey — reusing the midnight-crossing pair from case 4, with the
// evening game's createdAt again deliberately LATER than the late-night
// game's, so a createdAt-based sort would get the row order backwards.
{
  const gEvening15 = mkGame({ id: "ge15", date: "2026-08-14", time: "22:00", createdAt: "2026-08-14T20:00:00.000Z", attendeeIds: ["A", "B"], winnerId: "A", loserId: "B" });
  const gLateNight15 = mkGame({ id: "gl15", date: "2026-08-14", time: "01:00", createdAt: "2026-08-14T13:00:00.000Z", attendeeIds: ["A", "B"], winnerId: "B", loserId: "A" });
  const gDeleted15 = mkGame({ id: "gd15", date: "2026-08-14", time: "23:00", createdAt: "2026-08-14T21:00:00.000Z", attendeeIds: ["A", "B"], winnerId: "A", loserId: "B", active: false });

  const rows15 = computeCumulativeNetPointsTrend([gEvening15, gLateNight15, gDeleted15], "game");
  assert(rows15.length === 2, `case15 (게임별 버킷): row count must equal active game count (2, excluding the soft-deleted one), got ${rows15.length}`);
  assert(
    rows15[0]?.values.A === 1 && rows15[1]?.values.A === 0,
    `case15: row order must follow withinDayKey (evening=22:00 first, then late-night=01:00), got ${JSON.stringify(rows15.map((r) => r.values))}`
  );
  assert(
    rows15.every((r) => r.date === "2026-08-14"),
    `case15: every "game" row must carry its business date for the tooltip, got ${JSON.stringify(rows15.map((r) => r.date))}`
  );
}

// Case 16 (v2.22, PRD §30.2): computeCumulativeNetPointsTrend seeds every
// attendee at 0 before applying that game's win/loss delta, so a
// participant's line starts at their first ATTENDANCE, not their first
// decisive game. Three games, one per day: g1 (A beats B, C attends as a
// bystander), g2 (C beats A), g3 (A beats B, D attends as a bystander for
// the first time). E attends all three but never wins or loses (draws
// only, the whole way through). Checked under both "game" and "day"
// grouping since each path seeds attendees independently.
{
  const g1 = mkGame({ id: "s1", date: "2026-08-10", time: "20:00", createdAt: "2026-08-10T11:00:00.000Z", attendeeIds: ["A", "B", "C", "E"], winnerId: "A", loserId: "B" });
  const g2 = mkGame({ id: "s2", date: "2026-08-11", time: "20:00", createdAt: "2026-08-11T11:00:00.000Z", attendeeIds: ["A", "C", "E"], winnerId: "C", loserId: "A" });
  const g3 = mkGame({ id: "s3", date: "2026-08-12", time: "20:00", createdAt: "2026-08-12T11:00:00.000Z", attendeeIds: ["A", "B", "D", "E"], winnerId: "A", loserId: "B" });
  const games16 = [g1, g2, g3];

  for (const grouping of ["game", "day"] as const) {
    const rows = computeCumulativeNetPointsTrend(games16, grouping);
    assert(rows.length === 3, `case16 (${grouping}): expected one row per game/day (3), got ${rows.length}`);

    // 1. First attendance, not first decisive game: C is a bystander in g1
    // (row 0) and must already show 0 there, not be absent.
    assert(
      rows[0]?.values.C === 0,
      `case16 (${grouping}): C attended g1 as a bystander — row0.values.C must be 0 (present), got ${JSON.stringify(rows[0]?.values)}`
    );

    // 2. Draws-only participant: E attends every game, never wins/loses,
    // and must be 0 in every row.
    assert(
      rows.every((r) => r.values.E === 0),
      `case16 (${grouping}): E never wins or loses across any game — every row must show E at 0, got ${JSON.stringify(rows.map((r) => r.values))}`
    );

    // 3. Not present before attendance: D first appears in g3 (row 2) and
    // must have no key at all in rows 0-1.
    assert(
      rows[0]?.values.D === undefined && rows[1]?.values.D === undefined,
      `case16 (${grouping}): D hasn't attended yet in rows 0-1 — must have no key, got row0=${JSON.stringify(rows[0]?.values)} row1=${JSON.stringify(rows[1]?.values)}`
    );
    assert(
      rows[2]?.values.D === 0,
      `case16 (${grouping}): D attends (as a bystander) in g3 (row2) — must be 0 there, got ${JSON.stringify(rows[2]?.values)}`
    );

    // 4. Values unchanged: A/B/C's actual win/loss math must be identical
    // to what it was before attendee-seeding existed (seeding only adds
    // zero-valued keys, never changes a delta).
    assert(
      rows[2]?.values.A === 1 && rows[2]?.values.B === -2 && rows[2]?.values.C === 1,
      `case16 (${grouping}): win/loss totals must be unaffected by attendee seeding (A=+1, B=-2, C=+1 after all 3 games), got ${JSON.stringify(rows[2]?.values)}`
    );
  }
}

console.log("Done.");
