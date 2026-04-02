import Link from "next/link";
import { notFound } from "next/navigation";
import { FlashMessage } from "@/components/flash-message";
import { getPrisma } from "@/lib/prisma";
import { updateOrganizationAction } from "@/app/(admin)/organizations/actions";

export const dynamic = "force-dynamic";

type EditOrganizationPageProps = {
  params: {
    id: string;
  };
  searchParams?: {
    status?: string;
    message?: string;
  };
};

export default async function EditOrganizationPage({ params, searchParams }: EditOrganizationPageProps) {
  if (!/^\d+$/.test(params.id)) {
    notFound();
  }

  const prisma = getPrisma();
  const organization = await prisma.organization.findUnique({
    where: { id: BigInt(params.id) }
  });

  if (!organization) {
    notFound();
  }

  return (
    <div className="grid-2">
      <section>
        <h1 className="page-title">Edit organization #{organization.id.toString()}</h1>
        <div className="actions">
          <Link className="button-link secondary" href="/organizations">
            Back to organizations
          </Link>
        </div>
        <FlashMessage status={searchParams?.status} message={searchParams?.message} />
      </section>
      <section className="card">
        <form action={updateOrganizationAction} className="form-grid">
          <input type="hidden" name="id" value={organization.id.toString()} />
          <label htmlFor="name">
            Name
            <input id="name" name="name" defaultValue={organization.name} required />
          </label>
          <label htmlFor="email">
            Email
            <input id="email" name="email" type="email" defaultValue={organization.email ?? ""} />
          </label>
          <label htmlFor="balance">
            Balance (rubles)
            <input
              id="balance"
              name="balance"
              type="number"
              min="0"
              step="1"
              defaultValue={organization.balance.toString()}
              required
            />
          </label>
          <label htmlFor="userTarif">
            Tariff (rubles)
            <input
              id="userTarif"
              name="userTarif"
              type="number"
              min="0"
              step="1"
              defaultValue={organization.userTarif.toString()}
              required
            />
          </label>
          <label htmlFor="balanceStartOfDay">
            Balance start of day (rubles)
            <input
              id="balanceStartOfDay"
              name="balanceStartOfDay"
              type="number"
              min="0"
              step="1"
              defaultValue={organization.balanceStartOfDay?.toString() ?? ""}
            />
          </label>
          <div className="actions">
            <button type="submit">Save</button>
          </div>
        </form>
      </section>
    </div>
  );
}
