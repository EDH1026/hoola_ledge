export const COOKIE_NAME = "gl_session";
export const ADMIN_COOKIE_NAME = "gl_admin_session";

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time comparison of two equal-length hex strings, so a failed
 * password check can't leak how many leading characters matched via
 * response timing. Both callers below always pass two SHA-256 hex digests
 * (always 64 chars), so the length check never actually diverges based on
 * secret content — only content-independent digest length, which is public.
 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** The cookie value a correctly-authenticated session should carry. */
export async function expectedToken(): Promise<string> {
  const password = process.env.SITE_PASSWORD ?? "";
  return sha256Hex(`game-ledger:${password}`);
}

export async function checkPassword(input: string): Promise<boolean> {
  const password = process.env.SITE_PASSWORD ?? "";
  if (password.length === 0) return false;
  return timingSafeEqualHex(await sha256Hex(input), await sha256Hex(password));
}

/** The cookie value a correctly-authenticated admin session should carry. */
export async function expectedAdminToken(): Promise<string> {
  const password = process.env.ADMIN_PASSWORD ?? "";
  return sha256Hex(`game-ledger-admin:${password}`);
}

export async function checkAdminPassword(input: string): Promise<boolean> {
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (password.length === 0) return false;
  return timingSafeEqualHex(await sha256Hex(input), await sha256Hex(password));
}

/**
 * Validates a `next` redirect target coming from a query string or hidden
 * form field (the login and admin-login flows) is a same-origin relative
 * path, never an absolute URL — without this, a link like
 * `/login?next=https://evil.example` would make loginAction's redirect()
 * send a user who just typed in the real password straight to an
 * attacker's site (open redirect, useful for phishing). Anything that
 * doesn't look like a plain "/…" path — protocol-relative "//host", a
 * backslash variant "/\host" some browsers still treat as protocol-relative,
 * or any "://" — falls back to `fallback`.
 */
export function safeNextPath(next: string, fallback = "/"): string {
  if (
    typeof next === "string" &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.startsWith("/\\") &&
    !next.includes("://")
  ) {
    return next;
  }
  return fallback;
}

/**
 * Verifies an admin session cookie value. Deliberately fails closed when
 * ADMIN_PASSWORD is unset: expectedAdminToken() would otherwise hash an empty
 * string into a fixed, publicly-computable token, which anyone could paste
 * into a cookie to pass the check during the window before the env var is
 * configured on a fresh deploy.
 */
export async function verifyAdminCookie(
  cookieValue: string | undefined
): Promise<boolean> {
  if (!cookieValue) return false;
  if (!process.env.ADMIN_PASSWORD) return false;
  const expected = await expectedAdminToken();
  return cookieValue === expected;
}
