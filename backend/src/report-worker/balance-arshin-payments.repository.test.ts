import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { BalanceArshinPaymentsRepository } from "./balance-arshin-payments.repository";

function createPrismaMock(rows: unknown[]) {
  return {
    $queryRaw: vi.fn().mockResolvedValue(rows)
  } as unknown as PrismaClient;
}

describe("BalanceArshinPaymentsRepository", () => {
  it("maps daily income rows to bigint values", async () => {
    const prisma = createPrismaMock([
      {
        organizationId: "15",
        incomeRubles: "1200",
        operationsCount: "3"
      }
    ]);

    const repository = new BalanceArshinPaymentsRepository(prisma);
    const result = await repository.getSucceededIncomeByOrganization({
      reportDate: "2026-04-01",
      reportsTimeZone: "Europe/Moscow"
    });

    expect(result).toEqual([
      {
        organizationId: 15n,
        incomeRubles: 1200n,
        operationsCount: 3n
      }
    ]);
  });

  it("builds SQL with topup/admin sources and half-open day interval", async () => {
    const prisma = createPrismaMock([]);
    const repository = new BalanceArshinPaymentsRepository(prisma);

    await repository.getSucceededIncomeByOrganization({
      reportDate: "2026-04-01",
      reportsTimeZone: "Europe/Moscow"
    });

    const queryArg = (prisma.$queryRaw as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      strings: string[];
      values: unknown[];
    };
    const sqlText = queryArg.strings.join(" ");

    expect(sqlText).toContain("lower(trim(COALESCE(obt.source_type, ''))) = 'topup'");
    expect(sqlText).toContain("IN ('admin_add', 'admin_withdraw')");
    expect(sqlText).toContain("source_id, '')) LIKE 'max_admin_add:%'");
    expect(sqlText).toContain("source_id, '')) LIKE 'max_admin_withdraw:%'");
    expect(sqlText).toContain(">= ");
    expect(sqlText).toContain("::date");
    expect(sqlText).toContain("INTERVAL '1 day'");

    expect(queryArg.values).toEqual(["Europe/Moscow", "2026-04-01", "Europe/Moscow", "2026-04-01"]);
  });
});
