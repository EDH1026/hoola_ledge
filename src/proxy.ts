import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, COOKIE_NAME, expectedToken, verifyAdminCookie } from "./lib/auth";

// Routes that require an admin session on top of the regular shared-password
// session. This is an optimistic, request-path check for UX (redirect to the
// right login screen) — the server actions these pages call also enforce
// admin auth independently via requireAdmin(), since proxy isn't a full
// authorization solution (a server action can be invoked without the page).
const ADMIN_ROUTES = ["/participants", "/adjustments"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/login") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  const expected = await expectedToken();

  if (!cookie || cookie !== expected) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/admin-login")) {
    return NextResponse.next();
  }

  if (ADMIN_ROUTES.some((route) => pathname.startsWith(route))) {
    const adminCookie = req.cookies.get(ADMIN_COOKIE_NAME)?.value;

    if (!(await verifyAdminCookie(adminCookie))) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin-login";
      url.search = "";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
