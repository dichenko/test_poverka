import Link from "next/link";
import { UserRole } from "@prisma/client";
import { ConfirmButton } from "@/components/confirm-button";
import { FlashMessage } from "@/components/flash-message";
import { getPrisma } from "@/lib/prisma";
import { createUserAction, deleteUserAction } from "@/app/(admin)/users/actions";

export const dynamic = "force-dynamic";

type UsersPageProps = {
  searchParams?: {
    status?: string;
    message?: string;
  };
};

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const prisma = getPrisma();
  const [users, organizations] = await Promise.all([
    prisma.user.findMany({
      include: {
        organization: true
      },
      orderBy: [{ id: "desc" }]
    }),
    prisma.organization.findMany({
      orderBy: [{ name: "asc" }]
    })
  ]);

  return (
    <div className="grid-2">
      <section>
        <h1 className="page-title">Users</h1>
        <FlashMessage status={searchParams?.status} message={searchParams?.message} />
      </section>

      <section className="card">
        <h2>Add user</h2>
        <form action={createUserAction} className="form-grid">
          <label htmlFor="fullName">
            Full name
            <input id="fullName" name="fullName" required />
          </label>
          <label htmlFor="role">
            Role
            <select id="role" name="role" defaultValue={UserRole.USER}>
              <option value={UserRole.USER}>{UserRole.USER}</option>
              <option value={UserRole.ADMIN}>{UserRole.ADMIN}</option>
            </select>
          </label>
          <label htmlFor="organizationId">
            Organization
            <select id="organizationId" name="organizationId" defaultValue="">
              <option value="">No organization</option>
              {organizations.map((organization) => (
                <option key={organization.id.toString()} value={organization.id.toString()}>
                  {organization.name} (#{organization.id.toString()})
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="phone">
            Phone
            <input id="phone" name="phone" />
          </label>
          <label htmlFor="city">
            City
            <input id="city" name="city" />
          </label>
          <div className="actions">
            <button type="submit">Create</button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>All users</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>MAX user id</th>
              <th>Full name</th>
              <th>Role</th>
              <th>Organization id</th>
              <th>Organization name</th>
              <th>Phone</th>
              <th>City</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id.toString()}>
                <td>{user.id.toString()}</td>
                <td>{user.id.toString()}</td>
                <td>{user.fullName}</td>
                <td>{user.role}</td>
                <td>{user.organizationId?.toString() ?? "-"}</td>
                <td>{user.organization?.name ?? user.orgName ?? "-"}</td>
                <td>{user.phone ?? "-"}</td>
                <td>{user.city ?? "-"}</td>
                <td>
                  <div className="actions">
                    <Link className="button-link secondary" href={`/users/${user.id.toString()}/edit`}>
                      Edit
                    </Link>
                    <form action={deleteUserAction}>
                      <input type="hidden" name="id" value={user.id.toString()} />
                      <ConfirmButton
                        className="danger"
                        label="Delete"
                        confirmText={`Delete user "${user.fullName}"?`}
                      />
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
