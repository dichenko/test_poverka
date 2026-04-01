import { Prisma, type PrismaClient } from "@prisma/client";

interface SucceededIncomeRawRow {
  organizationId: string | number | bigint;
  incomeRubles: string | number | bigint | null;
  operationsCount: string | number | bigint;
}

export interface SucceededIncomeByOrganization {
  organizationId: bigint;
  incomeRubles: bigint;
  operationsCount: bigint;
}

interface GetSucceededIncomeByOrganizationInput {
  reportDate: string;
  reportsTimeZone: string;
}

function toBigIntOrZero(value: string | number | bigint | null | undefined) {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return 0n;
    }
    return BigInt(Math.trunc(value));
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      return 0n;
    }
    try {
      return BigInt(normalized);
    } catch {
      return 0n;
    }
  }

  return 0n;
}

// Adapter for payment storage schema used by balance_arshin report.
// If payment tables/fields change, adjust only this repository.
export class BalanceArshinPaymentsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getSucceededIncomeByOrganization(
    input: GetSucceededIncomeByOrganizationInput
  ): Promise<SucceededIncomeByOrganization[]> {
    const rows = await this.prisma.$queryRaw<SucceededIncomeRawRow[]>(Prisma.sql`
      SELECT
        obt.organization_id AS "organizationId",
        COALESCE(
          SUM(
            CASE
              WHEN lower(COALESCE(obt.direction, '')) = 'credit' THEN obt.amount_rubles
              WHEN lower(COALESCE(obt.direction, '')) = 'debit' THEN -obt.amount_rubles
              ELSE 0
            END
          ),
          0
        )::bigint AS "incomeRubles",
        COUNT(*)::bigint AS "operationsCount"
      FROM organization_balance_transactions AS obt
      WHERE lower(COALESCE(obt.source_type, '')) IN ('topup', 'admin_add', 'admin_withdraw')
        AND (obt.created_at AT TIME ZONE ${input.reportsTimeZone}) >= (${input.reportDate}::date + TIME '00:00:00')
        AND (obt.created_at AT TIME ZONE ${input.reportsTimeZone}) <= (${input.reportDate}::date + TIME '23:59:59.999')
      GROUP BY obt.organization_id
    `);

    return rows.map((row) => ({
      organizationId: toBigIntOrZero(row.organizationId),
      incomeRubles: toBigIntOrZero(row.incomeRubles),
      operationsCount: toBigIntOrZero(row.operationsCount)
    }));
  }
}
