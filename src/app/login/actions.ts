"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  checkPassword,
  expectedToken,
  safeNextPath,
  COOKIE_NAME,
  ADMIN_COOKIE_NAME,
} from "@/lib/auth";

export async function loginAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? "/"));

  const ok = await checkPassword(password);
  if (!ok) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

  const token = await expectedToken();
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 60, // 60 days
  });

  redirect(next);
}

export async function logoutAction() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
  store.delete(ADMIN_COOKIE_NAME);
  redirect("/login");
}
