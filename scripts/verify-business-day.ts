// Quick standalone sanity check for the v2.16 business-day redefinition
// (06:00-30:00 day boundary). Run with: npm run verify:business-day
import {
  BUSINESS_DAY_START_HOUR,
  addDaysToIsoDate,
  businessDateFromWallClock,
  minutesSinceBusinessDayStart,
} from "../src/lib/time";
import { withinDayKey } from "../src/lib/games";
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

console.log("Done.");
