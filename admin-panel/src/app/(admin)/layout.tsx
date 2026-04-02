import Link from "next/link";
import { requireAdminSession } from "@/lib/auth";
import { logoutAction } from "@/app/(admin)/actions";

export const dynamic = "force-dynamic";

export default function AdminLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = requireAdminSession();

  return (
    <div className="shell">
      <aside className="sidebar">
        <h1>Poverka Admin</h1>
        <nav className="nav">
          <Link href="/organizations">Organizations</Link>
          <Link href="/users">Users</Link>
        </nav>
        <form action={logoutAction}>
          <button type="submit" className="secondary">
            Logout
          </button>
        </form>
        <p className="meta">Signed in as: {session.login}</p>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
