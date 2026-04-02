import Link from "next/link";
import { UserRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { FlashMessage } from "@/components/flash-message";
import { getPrisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type EditUserPageProps = {
  params: {
    id: string;
  };
  searchParams?: {
    status?: string;
    message?: string;
  };
};

export default async function EditUserPage({ params, searchParams }: EditUserPageProps) {
  if (!/^\d+$/.test(params.id)) {
    notFound();
  }

  const prisma = getPrisma();
  const [user, organizations] = await Promise.all([
    prisma.user.findUnique({
      where: { id: BigInt(params.id) }
    }),
    prisma.organization.findMany({
      orderBy: [{ name: "asc" }]
    })
  ]);

  if (!user) {
    notFound();
  }

  return (
    <div className="grid-2">
      <section>
        <h1 className="page-title">Edit user #{user.id.toString()}</h1>
        <div className="actions">
          <Link className="button-link secondary" href="/users">
            Back to users
          </Link>
        </div>
        <FlashMessage status={searchParams?.status} message={searchParams?.message} />
      </section>

      <section className="card">
        <form action={`/users/${user.id.toString()}/edit/submit`} method="post" className="form-grid">
          <input type="hidden" name="id" value={user.id.toString()} />
          <label htmlFor="fullName">
            Full name
            <input id="fullName" name="fullName" defaultValue={user.fullName} required />
          </label>
          <label htmlFor="role">
            Role
            <select id="role" name="role" defaultValue={user.role}>
              <option value={UserRole.USER}>{UserRole.USER}</option>
              <option value={UserRole.ADMIN}>{UserRole.ADMIN}</option>
            </select>
          </label>
          <label htmlFor="organizationId">
            Organization
            <select id="organizationId" name="organizationId" defaultValue={user.organizationId?.toString() ?? ""}>
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
            <input id="phone" name="phone" defaultValue={user.phone ?? ""} />
          </label>
          <label htmlFor="city">
            City
            <input id="city" name="city" defaultValue={user.city ?? ""} />
          </label>
          <label htmlFor="userTarif">
            User tariff
            <input id="userTarif" name="userTarif" type="number" min="0" step="0.01" defaultValue={user.userTarif ?? ""} />
          </label>
          <label htmlFor="orgName">
            User org name
            <input id="orgName" name="orgName" defaultValue={user.orgName ?? ""} />
          </label>
          <label htmlFor="orgEmail">
            User org email
            <input id="orgEmail" name="orgEmail" type="email" defaultValue={user.orgEmail ?? ""} />
          </label>
          <div className="actions">
            <button type="submit">Save</button>
          </div>
        </form>
      </section>
    </div>
  );
}
