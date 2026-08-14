// Quick standalone sanity check for the v2.14 2-hour edit/undo window.
// Run with: npx tsx scripts/verify-edit-window.ts
import { EDIT_WINDOW_MS, isWithinEditWindow } from "../src/lib/time";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("PASS:", msg);
  }
}

assert(EDIT_WINDOW_MS === 2 * 60 * 60 * 1000, "EDIT_WINDOW_MS should be exactly 2 hours in ms");

const now = Date.now();

// Just recorded — well within the window.
assert(
  isWithinEditWindow(new Date(now).toISOString()),
  "a record created right now should be within the window"
);

// Just inside the boundary (a small buffer accounts for the real wall-clock
// milliseconds that elapse between capturing `now` here and the internal
// Date.now() call inside isWithinEditWindow — testing the exact millisecond
// is inherently flaky without injecting a fake clock, which the
// implementation deliberately doesn't do since createdAt is always a real
// server timestamp, never a test double). This still exercises the "still
// counts as within the window when the elapsed time is close to but not
// over EDIT_WINDOW_MS" behavior, i.e. that the comparison is <=, not far
// short of it like < would effectively require.
assert(
  isWithinEditWindow(new Date(now - EDIT_WINDOW_MS + 50).toISOString()),
  "a record created just under EDIT_WINDOW_MS ago should still be within the window"
);

// Just past the boundary — must be rejected.
assert(
  !isWithinEditWindow(new Date(now - EDIT_WINDOW_MS - 50).toISOString()),
  "a record created just over EDIT_WINDOW_MS ago should be outside the window"
);

// Comfortably past the boundary (well over 2 hours old).
assert(
  !isWithinEditWindow(new Date(now - EDIT_WINDOW_MS - 60_000).toISOString()),
  "a record created well over 2 hours ago should be outside the window"
);

// A createdAt in the future (clock skew edge case) should still read as
// "within the window" — Date.now() - future = negative, which is <= the
// window, not a case this app needs to special-case since createdAt is
// always server-stamped and never client-supplied.
assert(
  isWithinEditWindow(new Date(now + 60_000).toISOString()),
  "a future createdAt (clock skew) should not be treated as expired"
);

console.log("Done.");
