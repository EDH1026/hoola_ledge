"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  checkAdminPassword,
  expectedAdminToken,
  ADMIN_COOKIE_NAME,
} from "@/lib/auth";

export async function adminLoginAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/participants") || "/participants";

  if (!process.env.ADMIN_PASSWORD) {
    redirect(`/admin-login?error=unset&next=${encodeURIComponent(next)}`);
  }

  const ok = await checkAdminPassword(password);
  if (!ok) {
    redirect(`/admin-login?error=1&next=${encodeURIComponent(next)}`);
  }

  const token = await expectedAdminToken();
  const store = await cookies();
  store.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8, // 8 hours — shorter-lived than the shared session
  });

  redirect(next);
}

export async function adminLogoutAction() {
  const store = await cookies();
  store.delete(ADMIN_COOKIE_NAME);
  redirect("/");
}
