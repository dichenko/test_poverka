import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const rawConnectionString = process.env.DATABASE_URL;

if (!rawConnectionString) {
  throw new Error("DATABASE_URL is required to initialize Prisma client.");
}

function withUtcSessionTimezone(connectionString: string) {
  const parsed = new URL(connectionString);
  const currentOptions = parsed.searchParams.get("options")?.trim() ?? "";

  // Use UTC for app DB sessions to avoid timezone-dependent Date parsing/serialization drift.
  if (!/timezone\s*=/.test(currentOptions.toLowerCase())) {
    const mergedOptions = `${currentOptions} -c timezone=UTC`.trim();
    parsed.searchParams.set("options", mergedOptions);
  }

  return parsed.toString();
}

const connectionString = withUtcSessionTimezone(rawConnectionString);
const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });
