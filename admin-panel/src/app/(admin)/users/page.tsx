import Link from "next/link";
import { UserRole } from "@prisma/client";
import { ConfirmButton } from "@/components/confirm-button";
import { FlashMessage } from "@/components/flash-message";
import { SortableHeader } from "@/components/sortable-header";
import { getPrisma } from "@/lib/prisma";
import { createUserAction, deleteUserAction } from "@/app/(admin)/users/actions";

export const dynamic = "force-dynamic";

type SortDir = "asc" | "desc";
type SearchParams = Record<string, string | string[] | undefined>;
const USER_SORT_KEYS = ["id", "maxUserId", "fullName", "role", "organizationId", "organizationName", "phone", "city"] as const;
type UserSortKey = (typeof USER_SORT_KEYS)[number];

type UsersPageProps = {
  searchParams?: SearchParams;
};

function getStringParam(searchParams: SearchParams | undefined, key: string): string | undefined {
  const value = searchParams?.[key];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function parseSort(searchParams: SearchParams | undefined): { sortKey: UserSortKey; sortDir: SortDir } {
  const rawSort = getStringParam(searchParams, "sort");
  const rawDir = getStringParam(searchParams, "dir");
  const sortKey: UserSortKey = USER_SORT_KEYS.includes(rawSort as UserSortKey) ? (rawSort as UserSortKey) : "id";
  const sortDir: SortDir = rawDir === "asc" ? "asc" : "desc";
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

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const prisma = getPrisma();
  const { sortKey, sortDir } = parseSort(searchParams);

  const [users, organizations] = await Promise.all([
    prisma.user.findMany({
      include: {
        organization: true
      }
    }),
    prisma.organization.findMany({
      orderBy: [{ name: "asc" }]
    })
  ]);

  users.sort((left, right) => {
    const direction = sortDir === "asc" ? 1 : -1;
    let result = 0;

    switch (sortKey) {
      case "id":
      case "maxUserId":
        result = compareBigInt(left.id, right.id);
        break;
      case "fullName":
        result = left.fullName.localeCompare(right.fullName, undefined, { sensitivity: "base" });
        break;
      case "role":
        result = left.role.localeCompare(right.role, undefined, { sensitivity: "base" });
        break;
      case "organizationId":
        result = compareNullableBigInt(left.organizationId, right.organizationId);
        break;
      case "organizationName":
        result = compareNullableText(left.organization?.name ?? left.orgName, right.organization?.name ?? right.orgName);
        break;
      case "phone":
        result = compareNullableText(left.phone, right.phone);
        break;
      case "city":
        result = compareNullableText(left.city, right.city);
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
        <h1 className="page-title">Users</h1>
        <FlashMessage
          status={getStringParam(searchParams, "status")}
          message={getStringParam(searchParams, "message")}
        />
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
        <p className="table-hint">Click any column header to sort. Click again to reverse direction.</p>
        <table>
          <thead>
            <tr>
              <th>
                <SortableHeader
                  label="ID"
                  path="/users"
                  sortKey="id"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  searchParams={searchParams}
                />
              </th>
              <th>
                <SortableHeader
                  label="MAX user id"
                  path="/users"
                  sortKey="maxUserId"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  searchParams={searchParams}
                />
              </th>
              <th>
                <SortableHeader
                  label="Full name"
                  path="/users"
                  sortKey="fullName"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  searchParams={searchParams}
                />
              </th>
              <th>
                <SortableHeader
                  label="Role"
                  path="/users"
                  sortKey="role"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  searchParams={searchParams}
                />
              </th>
              <th>
                <SortableHeader
                  label="Organization id"
                  path="/users"
                  sortKey="organizationId"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  searchParams={searchParams}
                />
              </th>
              <th>
                <SortableHeader
                  label="Organization name"
                  path="/users"
                  sortKey="organizationName"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  searchParams={searchParams}
                />
              </th>
              <th>
                <SortableHeader
                  label="Phone"
                  path="/users"
                  sortKey="phone"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  searchParams={searchParams}
                />
              </th>
              <th>
                <SortableHeader
                  label="City"
                  path="/users"
                  sortKey="city"
                  currentSort={sortKey}
                  currentDir={sortDir}
                  searchParams={searchParams}
                />
              </th>
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
