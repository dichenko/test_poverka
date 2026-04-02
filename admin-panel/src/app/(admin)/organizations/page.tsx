import Link from "next/link";
import { ConfirmButton } from "@/components/confirm-button";
import { FlashMessage } from "@/components/flash-message";
import { getPrisma } from "@/lib/prisma";
import { createOrganizationAction, deleteOrganizationAction } from "@/app/(admin)/organizations/actions";

export const dynamic = "force-dynamic";

type OrganizationsPageProps = {
  searchParams?: {
    status?: string;
    message?: string;
  };
};

export default async function OrganizationsPage({ searchParams }: OrganizationsPageProps) {
  const prisma = getPrisma();
  const organizations = await prisma.organization.findMany({
    orderBy: [{ name: "asc" }]
  });

  return (
    <div className="grid-2">
      <section>
        <h1 className="page-title">Organizations</h1>
        <FlashMessage status={searchParams?.status} message={searchParams?.message} />
      </section>

      <section className="card">
        <h2>Add organization</h2>
        <form action={createOrganizationAction} className="form-grid">
          <label htmlFor="name">
            Name
            <input id="name" name="name" required />
          </label>
          <label htmlFor="email">
            Email
            <input id="email" name="email" type="email" placeholder="optional" />
          </label>
          <label htmlFor="balance">
            Balance (rubles)
            <input id="balance" name="balance" type="number" min="0" step="1" defaultValue="0" required />
          </label>
          <label htmlFor="userTarif">
            Tariff (rubles)
            <input id="userTarif" name="userTarif" type="number" min="0" step="1" defaultValue="0" required />
          </label>
          <label htmlFor="balanceStartOfDay">
            Balance start of day (rubles)
            <input id="balanceStartOfDay" name="balanceStartOfDay" type="number" min="0" step="1" />
          </label>
          <div className="actions">
            <button type="submit">Create</button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>All organizations</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Email</th>
              <th>Balance</th>
              <th>Tariff</th>
              <th>Balance start of day</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {organizations.map((organization) => (
              <tr key={organization.id.toString()}>
                <td>{organization.id.toString()}</td>
                <td>{organization.name}</td>
                <td>{organization.email ?? "-"}</td>
                <td>{organization.balance.toString()}</td>
                <td>{organization.userTarif.toString()}</td>
                <td>{organization.balanceStartOfDay?.toString() ?? "-"}</td>
                <td>
                  <div className="actions">
                    <Link className="button-link secondary" href={`/organizations/${organization.id.toString()}/edit`}>
                      Edit
                    </Link>
                    <form action={deleteOrganizationAction}>
                      <input type="hidden" name="id" value={organization.id.toString()} />
                      <ConfirmButton
                        className="danger"
                        label="Delete"
                        confirmText={`Delete organization "${organization.name}"?`}
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
