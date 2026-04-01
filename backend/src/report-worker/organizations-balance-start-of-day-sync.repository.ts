import type { PrismaClient } from "@prisma/client";

export class OrganizationsBalanceStartOfDaySyncRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async syncFromCurrentBalance(): Promise<number> {
    const updatedRows = await this.prisma.$executeRaw`
      UPDATE organizations
      SET balance_start_of_day = balance
    `;

    return Number(updatedRows);
  }
}
