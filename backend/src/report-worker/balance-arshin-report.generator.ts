import fs from "fs/promises";
import ExcelJS from "exceljs";
import { Prisma, type PrismaClient } from "@prisma/client";
import { BalanceArshinPaymentsRepository } from "./balance-arshin-payments.repository";
import { buildReportPaths } from "./report-paths";
import type { GeneratedReportResult, ReportGenerator, ReportLogger } from "./report.types";

const REPORT_CODE = "balance_arshin";
const REPORT_TITLE = "Balance Arshin";
const SHEET_TITLE = "Balance_Arshin";

const HEADERS = [
  "Наименование организации",
  "Сумма на начало дня",
  "Сумма на конец дня",
  "Количество пакетов",
  "Цена за пакет",
  "Поступление за день",
  "Количество пакетов передано"
] as const;

const COLUMN_WIDTHS = [44, 22, 22, 24, 18, 22, 28] as const;

interface PackagesTransferredRawRow {
  organizationId: string | number | bigint;
  packagesTransferredCount: string | number | bigint;
}

interface CreateBalanceArshinReportGeneratorInput {
  prisma: PrismaClient;
  logger: ReportLogger;
  reportsStorageDir: string;
  reportsPublicBaseUrl: string;
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

function toNumberOrZero(value: bigint) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}

async function fetchPackagesTransferredByOrganization(input: {
  prisma: PrismaClient;
  reportDate: string;
  reportsTimeZone: string;
}) {
  const rows = await input.prisma.$queryRaw<PackagesTransferredRawRow[]>(Prisma.sql`
    SELECT
      ms.organization_id AS "organizationId",
      COUNT(*)::bigint AS "packagesTransferredCount"
    FROM meter_submissions AS ms
    WHERE ms.status = 'CONFIRMED'
      AND ms.confirmed_at IS NOT NULL
      AND (ms.confirmed_at AT TIME ZONE ${input.reportsTimeZone}) >= (${input.reportDate}::date + TIME '00:00:00')
      AND (ms.confirmed_at AT TIME ZONE ${input.reportsTimeZone}) <= (${input.reportDate}::date + TIME '23:59:59.999')
    GROUP BY ms.organization_id
  `);

  return rows.map((row) => ({
    organizationId: toBigIntOrZero(row.organizationId),
    packagesTransferredCount: toBigIntOrZero(row.packagesTransferredCount)
  }));
}

export function createBalanceArshinReportGenerator(
  input: CreateBalanceArshinReportGeneratorInput
): ReportGenerator {
  const paymentsRepository = new BalanceArshinPaymentsRepository(input.prisma);

  return {
    code: REPORT_CODE,
    title: REPORT_TITLE,

    getFileName(reportDate: string) {
      return `Balance_Arshin_${reportDate}.xlsx`;
    },

    async generate(reportDate: string): Promise<GeneratedReportResult> {
      const fileName = `Balance_Arshin_${reportDate}.xlsx`;
      const paths = buildReportPaths({
        storageDir: input.reportsStorageDir,
        publicBaseUrl: input.reportsPublicBaseUrl,
        reportCode: REPORT_CODE,
        fileName
      });

      input.logger.info(
        {
          reportCode: REPORT_CODE,
          date: reportDate
        },
        "Preparing data for balance_arshin report"
      );

      await fs.mkdir(paths.reportDir, { recursive: true });

      const [organizations, incomeRows, transferredRows] = await Promise.all([
        input.prisma.organization.findMany({
          select: {
            id: true,
            name: true,
            balanceStartOfDay: true,
            balance: true,
            userTarif: true
          },
          orderBy: {
            name: "asc"
          }
        }),
        paymentsRepository.getSucceededIncomeByOrganization({
          reportDate,
          reportsTimeZone: input.reportsTimeZone
        }),
        fetchPackagesTransferredByOrganization({
          prisma: input.prisma,
          reportDate,
          reportsTimeZone: input.reportsTimeZone
        })
      ]);

      const incomeByOrgId = new Map(incomeRows.map((row) => [row.organizationId.toString(), row]));
      const transferredByOrgId = new Map(transferredRows.map((row) => [row.organizationId.toString(), row]));

      const totalPaymentsFound = incomeRows.reduce(
        (sum, row) => sum + toNumberOrZero(row.paymentsCount),
        0
      );
      const totalPackagesTransferredFound = transferredRows.reduce(
        (sum, row) => sum + toNumberOrZero(row.packagesTransferredCount),
        0
      );

      input.logger.info(
        {
          reportCode: REPORT_CODE,
          date: reportDate,
          organizationsCount: organizations.length,
          paymentsFound: totalPaymentsFound,
          packagesTransferredFound: totalPackagesTransferredFound
        },
        "Prepared aggregates for balance_arshin report"
      );

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(SHEET_TITLE);

      worksheet.columns = HEADERS.map((header, index) => ({
        header,
        key: `c${index + 1}`,
        width: COLUMN_WIDTHS[index]
      }));
      worksheet.views = [{ state: "frozen", ySplit: 1 }];
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: HEADERS.length }
      };

      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.alignment = { vertical: "middle", horizontal: "left", wrapText: true };

      for (const organization of organizations) {
        const orgId = organization.id.toString();
        const orgName = organization.name?.trim() ?? "";
        const balanceStartOfDay = toBigIntOrZero(organization.balanceStartOfDay);
        const balanceEndOfDay = toBigIntOrZero(organization.balance);
        const packagePrice = toBigIntOrZero(organization.userTarif);
        const income = incomeByOrgId.get(orgId)?.incomeRubles ?? 0n;
        const packagesTransferred = transferredByOrgId.get(orgId)?.packagesTransferredCount ?? 0n;

        let packagesCount = 0;

        if (packagePrice > 0n) {
          packagesCount = toNumberOrZero(balanceEndOfDay) / toNumberOrZero(packagePrice);
        } else {
          input.logger.warn(
            {
              reportCode: REPORT_CODE,
              date: reportDate,
              organizationId: organization.id.toString(),
              organizationName: orgName,
              packagePrice: packagePrice.toString()
            },
            "Organization has invalid tariff, packages count set to 0"
          );
        }

        worksheet.addRow({
          c1: orgName,
          c2: toNumberOrZero(balanceStartOfDay),
          c3: toNumberOrZero(balanceEndOfDay),
          c4: packagesCount,
          c5: toNumberOrZero(packagePrice),
          c6: toNumberOrZero(income),
          c7: toNumberOrZero(packagesTransferred)
        });
      }

      worksheet.getColumn(2).numFmt = "#,##0.00";
      worksheet.getColumn(3).numFmt = "#,##0.00";
      worksheet.getColumn(4).numFmt = "0.########";
      worksheet.getColumn(5).numFmt = "#,##0.00";
      worksheet.getColumn(6).numFmt = "#,##0.00";
      worksheet.getColumn(7).numFmt = "0";

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
          return;
        }
        row.alignment = { vertical: "middle", horizontal: "left" };
      });

      const tempPath = `${paths.absolutePath}.tmp`;

      try {
        await workbook.xlsx.writeFile(tempPath);
        await fs.rm(paths.absolutePath, { force: true });
        await fs.rename(tempPath, paths.absolutePath);
      } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
        await fs.rm(paths.absolutePath, { force: true }).catch(() => undefined);
        throw error;
      }

      input.logger.info(
        {
          reportCode: REPORT_CODE,
          date: reportDate,
          organizationsCount: organizations.length,
          filePath: paths.absolutePath,
          publicUrl: paths.publicUrl
        },
        "balance_arshin report file saved"
      );

      return {
        fileName,
        absolutePath: paths.absolutePath,
        publicUrl: paths.publicUrl,
        rowsCount: organizations.length
      };
    }
  };
}
