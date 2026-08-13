// This app is used by a Korea-based group, and all displayed dates/times are
// meant to read as Asia/Seoul wall-clock time regardless of what timezone the
// Node process itself runs in (Vercel serverless defaults to UTC). Korea has
// no DST, so a fixed +9h offset is exact and avoids any Intl/ICU timezone
// database quirks — do date math here, not by reaching for `new Date()`
// getters or `toISOString()` slicing elsewhere in the app.
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Current wall-clock date/time in Asia/Seoul, as plain "yyyy-MM-dd" / "HH:mm" strings. */
export function nowInSeoul(): { date: string; time: string } {
  const d = new Date(Date.now() + SEOUL_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return { date: `${y}-${m}-${day}`, time: `${h}:${min}` };
}

/** Today's date in Asia/Seoul as "yyyy-MM-dd" — replacement for the old UTC-based todayIso(). */
export function todayInSeoul(): string {
  return nowInSeoul().date;
}

/**
 * Interprets a "yyyy-MM-ddTHH:mm[:ss]" string (as produced by an
 * `<input type="datetime-local">`) as Asia/Seoul wall-clock time and returns
 * the equivalent UTC instant as an ISO string, so it can be compared against
 * `createdAt` values (always stored as true UTC ISO instants).
 */
export function seoulLocalToUtcIso(localDateTime: string): string {
  const match = localDateTime.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (!match) throw new Error(`Invalid local datetime: ${localDateTime}`);
  const [, y, mo, d, h, mi, s] = match;
  const asIfUtcMs = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? 0)
  );
  return new Date(asIfUtcMs - SEOUL_OFFSET_MS).toISOString();
}

/** Formats a UTC ISO instant as Asia/Seoul "yyyy-MM-dd HH:mm", for display. */
export function formatInSeoul(iso: string): string {
  const d = new Date(new Date(iso).getTime() + SEOUL_OFFSET_MS);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${mo}-${day} ${h}:${mi}`;
}
