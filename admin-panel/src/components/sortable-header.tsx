import Link from "next/link";

type SearchParams = Record<string, string | string[] | undefined>;

type SortableHeaderProps = {
  label: string;
  path: string;
  sortKey: string;
  currentSort: string;
  currentDir: "asc" | "desc";
  searchParams?: SearchParams;
};

function createSortHref(
  path: string,
  sortKey: string,
  currentSort: string,
  currentDir: "asc" | "desc",
  searchParams?: SearchParams
) {
  const params = new URLSearchParams();
  const keysToSkip = new Set(["status", "message", "sort", "dir"]);

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (keysToSkip.has(key) || value === undefined) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          params.append(key, item);
        }
      } else {
        params.set(key, value);
      }
    }
  }

  const nextDir = currentSort === sortKey && currentDir === "asc" ? "desc" : "asc";
  params.set("sort", sortKey);
  params.set("dir", nextDir);

  const query = params.toString();
  return query.length > 0 ? `${path}?${query}` : path;
}

export function SortableHeader({ label, path, sortKey, currentSort, currentDir, searchParams }: SortableHeaderProps) {
  const active = currentSort === sortKey;
  const indicator = active ? (currentDir === "asc" ? "↑" : "↓") : "↕";
  const href = createSortHref(path, sortKey, currentSort, currentDir, searchParams);
  const className = active ? "sortable-header active" : "sortable-header";

  return (
    <Link className={className} href={href}>
      <span>{label}</span>
      <span className="sort-indicator">{indicator}</span>
    </Link>
  );
}

