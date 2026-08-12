export const COOKIE_NAME = "gl_session";

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
