// Quick standalone sanity check for the open-redirect fix in src/lib/auth.ts.
// Run with: npx tsx scripts/verify-auth.ts
import { safeNextPath } from "../src/lib/auth";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("PASS:", msg);
  }
}

// Legitimate same-origin paths pass through unchanged.
assert(safeNextPath("/") === "/", "root path allowed");
assert(safeNextPath("/games") === "/games", "plain relative path allowed");
assert(
  safeNextPath("/adjustments?foo=bar") === "/adjustments?foo=bar",
  "relative path with query string allowed"
);

// Absolute URLs to another host must be rejected (the actual open-redirect
// payload: /login?next=https://evil.example).
assert(safeNextPath("https://evil.example") === "/", "absolute https URL rejected");
assert(safeNextPath("http://evil.example") === "/", "absolute http URL rejected");

// Protocol-relative and backslash variants some browsers still resolve as
// protocol-relative — both must be rejected too.
assert(safeNextPath("//evil.example") === "/", "protocol-relative //host rejected");
assert(safeNextPath("/\\evil.example") === "/", "backslash-variant /\\host rejected");

// Anything containing "://" anywhere is rejected, not just at the start.
assert(
  safeNextPath("/redirect?to=javascript://evil") === "/",
  "path containing :// anywhere is rejected"
);

// Custom fallback (used by admin-login) is honored.
assert(
  safeNextPath("https://evil.example", "/participants") === "/participants",
  "custom fallback used when rejecting"
);

// Non-leading-slash garbage also falls back.
assert(safeNextPath("not-a-path") === "/", "non-slash-leading string rejected");

console.log("Done.");
