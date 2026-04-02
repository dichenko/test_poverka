import Link from "next/link";
import { ConfirmButton } from "@/components/confirm-button";
import { FlashMessage } from "@/components/flash-message";
import { SortableHeader } from "@/components/sortable-header";
import { getPrisma } from "@/lib/prisma";
import { createOrganizationAction, deleteOrganizationAction } from "@/app/(admin)/organizations/actions";

export const dynamic = "force-dynamic";

type SortDir = "asc" | "desc";
type SearchParams = Record<string, string | string[] | undefined>;
const ORGANIZATION_SORT_KEYS = ["id", "name", "email", "balance", "userTarif", "balanceStartOfDay"] as const;
type OrganizationSortKey = (typeof ORGANIZATION_SORT_KEYS)[number];

type OrganizationsPageProps = {
  searchParams?: SearchParams;
};

function getStringParam(searchParams: SearchParams | undefined, key: string): string | undefined {
  const value = searchParams?.[key];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function parseSort(searchParams: SearchParams | undefined): { sortKey: OrganizationSortKey; sortDir: SortDir } {
  const rawSort = getStringParam(searchParams, "sort");
  const rawDir = getStringParam(searchParams, "dir");
  const sortKey: OrganizationSortKey = ORGANIZATION_SORT_KEYS.includes(rawSort as OrganizationSortKey)
    ? (rawSort as OrganizationSortKey)
    : "name";
  const sortDir: SortDir = rawDir === "desc" ? "desc" : "asc";
  return { sortKey, sortDir };
}

function compareBigInt(a: bigint, b: bigint): number {
  if (a === b) {
    return 0;
  }
  return a > b ? 1 : -1;
}

function compareNullableBigInt(a: bigint | null, b: bigint | null): number {
  if (a === b) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return compareBigInt(a, b);
}

function compareNullableText(a: string | null, b: string | null): number {
  const left = (a ?? "").toLocaleLowerCase();
  const right = (b ?? "").toLocaleLowerCase();
  return left.localeCompare(right);
}

export default async function OrganizationsPage({ searchParams }: OrganizationsPageProps) {
  const prisma = getPrisma();
  const { sortKey, sortDir } = parseSort(searchParams);

  const organizations = await prisma.organization.findMany();

  organizations.sort((left, right) => {
    const direction = sortDir === "asc" ? 1 : -1;
    let result = 0;

    switch (sortKey) {
      case "id":
        result = compareBigInt(left.id, right.id);
        break;
      case "name":
        result = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
        break;
      case "email":
        result = compareNullableText(left.email, right.email);
        break;
      case "balance":
        result = compareBigInt(left.balance, right.balance);
        break;
      case "userTarif":
        result = compareBigInt(left.userTarif, right.userTarif);
        break;
      case "balanceStartOfDay":
        result = compareNullableBigInt(left.balanceStartOfDay, right.balanceStartOfDay);
        break;
    }

    if (result === 0) {
      return compareBigInt(left.id, right.id) * direction;
    }

    return result * direction;
  });

  return (
    <div className="grid-2">
      <section>
        <h1 className="page-title">Organizations</h1>
        <FlashMessage
          status={getStringParam(searchParams, "status")}
          message={getStringParam(searchParams, "message")}
        />
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
        <p className="table-hint">Click any column header to sort. Click again to reverse direction.</p>
        <table>
          <thead>
            <tr>
              <th>
                <SortableHeader
                  label="ID"
                  path="/organizations"
                  sortKey="id"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  searchParams={searchParams}
                />
              </th>
              <th>
                <SortableHeader
                  label="Name"
                  path="/organizations"
                  sortKey="name"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  searchParams={searchParams}
                />
              </th>
              <th>
                <SortableHeader
                  label="Email"
                  path="/organizations"
                  sortKey="email"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  searchParams={searchParams}
                />
              </th>
              <th>
                <SortableHeader
                  label="Balance"
                  path="/organizations"
                  sortKey="balance"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  searchParams={searchParams}
                />
              </th>
              <th>
                <SortableHeader
                  label="Tariff"
                  path="/organizations"
                  sortKey="userTarif"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  searchParams={searchParams}
                />
              </th>
              <th>
                <SortableHeader
                  label="Balance start of day"
                  path="/organizations"
                  sortKey="balanceStartOfDay"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  searchParams={searchParams}
                />
              </th>
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
