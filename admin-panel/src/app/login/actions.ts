"use server";

import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { createAdminSession, readAdminSession } from "@/lib/session";

export async function loginAction(formData: FormData) {
  const activeSession = readAdminSession();
  if (activeSession) {
    redirect("/organizations");
  }

  const login = String(formData.get("login") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const env = getEnv();

  if (login !== env.ADMIN_AUTH_LOGIN || password !== env.ADMIN_AUTH_PASSWORD) {
    redirect("/login?status=error&message=Invalid%20credentials");
  }

  createAdminSession(login);
  redirect("/organizations");
}

