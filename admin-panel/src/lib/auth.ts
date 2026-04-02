import "server-only";
import { redirect } from "next/navigation";
import { readAdminSession } from "@/lib/session";

export function requireAdminSession() {
  const session = readAdminSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export function redirectIfAuthenticated() {
  const session = readAdminSession();
  if (session) {
    redirect("/organizations");
  }
}

