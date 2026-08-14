// Quick standalone sanity check for the v2.16 business-day redefinition
// (06:00-30:00 day boundary) and its v2.17 backfill (PRD §20). Run with:
// npm run verify:business-day
import {
  BUSINESS_DAY_START_HOUR,
  addDaysToIsoDate,
  businessDateFromWallClock,
  minutesSinceBusinessDayStart,
  seoulLocalToUtcIso,
} from "../src/lib/time";
import { withinDayKey } from "../src/lib/games";
import { planBusinessDayBackfill } from "../src/lib/backfill";
import { GameResult } from "../src/lib/types";

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

console.log("Done.");
