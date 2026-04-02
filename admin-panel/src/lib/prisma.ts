import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { getEnv } from "@/lib/env";

declare global {
  // eslint-disable-next-line no-var
  var __adminPrisma: PrismaClient | undefined;
}

function createPrismaClient() {
  const { DATABASE_URL } = getEnv();
  const adapter = new PrismaPg({ connectionString: DATABASE_URL });
  return new PrismaClient({ adapter });
}

export function getPrisma() {
  if (!globalThis.__adminPrisma) {
    globalThis.__adminPrisma = createPrismaClient();
  }
  return globalThis.__adminPrisma;
}
