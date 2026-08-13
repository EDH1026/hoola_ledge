import "server-only";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifyAdminCookie } from "./auth";

/**
 * Server actions that mutate admin-only data must call this even though the
 * relevant pages are also gated in proxy.ts — proxy is an optimistic,
 * request-path check, not a full authorization solution, and a server action
 * can in principle be invoked without going through the page that renders its
 * form. Throws (which surfaces as a form error) if the admin cookie is
 * missing or stale.
 */
export async function requireAdmin(): Promise<void> {
  const store = await cookies();
  const cookie = store.get(ADMIN_COOKIE_NAME)?.value;
  if (!(await verifyAdminCookie(cookie))) {
    throw new Error("관리자 인증이 필요합니다.");
  }
}
