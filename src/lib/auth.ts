export const COOKIE_NAME = "gl_session";
export const ADMIN_COOKIE_NAME = "gl_admin_session";

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The cookie value a correctly-authenticated session should carry. */
export async function expectedToken(): Promise<string> {
  const password = process.env.SITE_PASSWORD ?? "";
  return sha256Hex(`game-ledger:${password}`);
}

export async function checkPassword(input: string): Promise<boolean> {
  const password = process.env.SITE_PASSWORD ?? "";
  return password.length > 0 && input === password;
}

/** The cookie value a correctly-authenticated admin session should carry. */
export async function expectedAdminToken(): Promise<string> {
  const password = process.env.ADMIN_PASSWORD ?? "";
  return sha256Hex(`game-ledger-admin:${password}`);
}

export async function checkAdminPassword(input: string): Promise<boolean> {
  const password = process.env.ADMIN_PASSWORD ?? "";
  return password.length > 0 && input === password;
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
