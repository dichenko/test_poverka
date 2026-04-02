import { redirect } from "next/navigation";
import { readAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const session = readAdminSession();
  if (session) {
    redirect("/organizations");
  }
  redirect("/login");
}
