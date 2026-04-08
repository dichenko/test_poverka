import fs from "fs/promises";
import ExcelJS from "exceljs";
import { Prisma, type PrismaClient } from "@prisma/client";
import { buildReportPaths } from "./report-paths";
import { generateReportPublicToken } from "./report-public-url";
import type {
  GeneratedReportResult,
  ReportBatchGenerateInput,
  ReportGenerator,
  ReportLogger,
  ReportRunItemResult
} from "./report.types";

const REPORT_CODE = "org_metrolog";
const REPORT_TITLE = "Organization Metrolog";
const SHEET_TITLE = "Indications";
const EXCEL_DATE_FORMAT = "dd.mm.yyyy";
const CLIENT_NAME_CANDIDATES = [
  "client_name",
  "client_fullname",
  "client_fio",
  "customer_name",
  "customer_fullname",
  "customer_fio",
  "fio"
] as const;

const HEADERS = [
  "Порядковый номер",
  "ФИО Пользователя",
  "Модификация СИ",
  "Заводской номер СИ",
  "Вид счетчика",
  "Год выпуска",
  "Показания счетчика",
  "Дата поверки",
  "Дата следующей поверки",
  "Телефон",
  "Клиент",
  "Адрес"
] as const;

const COLUMN_WIDTHS = [18, 32, 28, 24, 16, 14, 20, 16, 24, 18, 30, 42] as const;

interface OrganizationRow {
  id: bigint;
  name: string;
  balanceStartOfDay: bigint | null;
  balance: bigint;
  userTarif: bigint;
}

interface OrgMetrologRawRow {
  submission_id: string;
  user_fullname: string;
  modification_name: string | null;
  meter_number: string;
  water_type_raw: string | null;
  water_type_label: string | null;
  production_year: number | null;
  current_value: string | null;
  verification_date: Date | string | null;
  next_verification_date: Date | string | null;
  client_phone: string | null;
  client_name: string | null;
  address: string | null;
}

interface CreateOrgMetrologReportGeneratorInput {
  prisma: PrismaClient;
  logger: ReportLogger;
  reportsStorageDir: string;
  reportsPublicBaseUrl: string;
  reportsTimeZone: string;
}

function toErrorText(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function formatDateForFileName(reportDate: string) {
  const [year, month, day] = reportDate.split("-");
  return `${day}-${month}-${year}`;
}

function toBigIntOrZero(value: bigint | null | undefined) {
  return value ?? 0n;
}

function calculatePackagesCount(input: {
  balanceRubles: bigint | null | undefined;
  tariffRubles: bigint | null | undefined;
  logger: ReportLogger;
  organizationId: string;
  organizationName: string;
  reportDate: string;
  metric: "start" | "end";
}) {
  const balance = toBigIntOrZero(input.balanceRubles);
  const tariff = input.tariffRubles;

  if (!tariff || tariff <= 0n) {
    input.logger.warn(
      {
        reportCode: REPORT_CODE,
        date: input.reportDate,
        organizationId: input.organizationId,
        organizationName: input.organizationName,
        tariffRubles: tariff === null || tariff === undefined ? null : tariff.toString(),
        metric: input.metric
      },
      "Organization has invalid tariff, packages count set to 0"
    );
    return 0;
  }

  const balanceNumber = Number(balance);
  const tariffNumber = Number(tariff);
  if (!Number.isFinite(balanceNumber) || !Number.isFinite(tariffNumber) || tariffNumber <= 0) {
    input.logger.warn(
      {
        reportCode: REPORT_CODE,
        date: input.reportDate,
        organizationId: input.organizationId,
        organizationName: input.organizationName,
        balanceRubles: balance.toString(),
        tariffRubles: tariff.toString(),
        metric: input.metric
      },
      "Packages count cannot be calculated with non-finite values, set to 0"
    );
    return 0;
  }

  return balanceNumber / tariffNumber;
}

function toExcelDate(value: Date | string | null) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 12, 0, 0));
  }

  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    return new Date(
      Date.UTC(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]) - 1, Number(dateOnlyMatch[3]), 12, 0, 0)
    );
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 12, 0, 0));
  }

  return null;
}

function normalizeCellValue(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return "";
  }
  return value;
}

async function writeWorkbookAtomically(workbook: ExcelJS.Workbook, absolutePath: string) {
  const tempPath = `${absolutePath}.tmp`;

  try {
    await workbook.xlsx.writeFile(tempPath);
    await fs.rm(absolutePath, { force: true });
    await fs.rename(tempPath, absolutePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    await fs.rm(absolutePath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function resolveClientNameColumn(prisma: PrismaClient) {
  const rows = await prisma.$queryRaw<{ column_name: string }[]>(Prisma.sql`
    SELECT c.column_name
    FROM information_schema.columns AS c
    WHERE c.table_schema = current_schema()
      AND c.table_name = 'meter_submissions'
  `);

  const available = new Set(rows.map((row) => row.column_name.toLowerCase()));
  return CLIENT_NAME_CANDIDATES.find((column) => available.has(column)) ?? null;
}

async function fetchOrgMetrologRows(input: {
  prisma: PrismaClient;
  reportDate: string;
  reportsTimeZone: string;
  organizationId: bigint;
  clientNameColumn: string | null;
}) {
  const clientNameExpression = input.clientNameColumn
    ? Prisma.raw(`ms."${input.clientNameColumn}"`)
    : Prisma.sql`NULL::text`;

  return input.prisma.$queryRaw<OrgMetrologRawRow[]>(Prisma.sql`
    SELECT
      ms.id AS submission_id,
      u.user_fullname,
      COALESCE(et.name, ms.custom_equipment_type_name) AS modification_name,
      ms.meter_number,
      ms.water_type::text AS water_type_raw,
      CASE
        WHEN lower(ms.water_type::text) IN ('hvs', 'cold', 'хвс') THEN 'ХВС'
        WHEN lower(ms.water_type::text) IN ('gvs', 'hot', 'гвс') THEN 'ГВС'
        ELSE NULL
      END AS water_type_label,
      ms.production_year,
      ms.current_value::text AS current_value,
      (ms.confirmed_at AT TIME ZONE ${input.reportsTimeZone})::date AS verification_date,
      CASE
        WHEN lower(ms.water_type::text) IN ('hvs', 'cold', 'хвс')
          THEN ((ms.confirmed_at AT TIME ZONE ${input.reportsTimeZone})::date + interval '6 years' - interval '1 day')::date
        WHEN lower(ms.water_type::text) IN ('gvs', 'hot', 'гвс')
          THEN ((ms.confirmed_at AT TIME ZONE ${input.reportsTimeZone})::date + interval '4 years' - interval '1 day')::date
        ELSE NULL
      END AS next_verification_date,
      ms.phone AS client_phone,
      ${clientNameExpression} AS client_name,
      ms.address
    FROM meter_submissions AS ms
    INNER JOIN users AS u
      ON u.user_id = ms.user_id
    LEFT JOIN equipment_types AS et
      ON et.id = ms.equipment_type_id
    WHERE ms.status = 'CONFIRMED'
      AND ms.organization_id = ${input.organizationId}
      AND ms.confirmed_at IS NOT NULL
      AND (ms.confirmed_at AT TIME ZONE ${input.reportsTimeZone}) >= (${input.reportDate}::date + TIME '00:01:00')
      AND (ms.confirmed_at AT TIME ZONE ${input.reportsTimeZone}) <= (${input.reportDate}::date + TIME '21:59:59')
    ORDER BY ms.confirmed_at ASC, ms.id ASC
  `);
}

function buildWorkbook(input: {
  reportDate: string;
  startPackages: number;
  transferredPackages: number;
  endPackages: number;
  rows: OrgMetrologRawRow[];
}) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(SHEET_TITLE);

  worksheet.columns = COLUMN_WIDTHS.map((width, index) => ({
    key: `c${index + 1}`,
    width
  }));

  worksheet.getCell("A1").value = "Пакеты информации на начало дня";
  worksheet.getCell("B1").value = input.startPackages;
  worksheet.getCell("A2").value = "Передано пакетов информации";
  worksheet.getCell("B2").value = input.transferredPackages;
  worksheet.getCell("A3").value = "Дата отчета";
  worksheet.getCell("B3").value = toExcelDate(input.reportDate);
  worksheet.getCell("B3").numFmt = EXCEL_DATE_FORMAT;

  HEADERS.forEach((header, index) => {
    worksheet.getCell(4, index + 1).value = header;
  });

  const headerRow = worksheet.getRow(4);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle", horizontal: "left", wrapText: true };

  input.rows.forEach((row, index) => {
    const rowNumber = 5 + index;
    const worksheetRow = worksheet.getRow(rowNumber);

    worksheetRow.getCell(1).value = index + 1;
    worksheetRow.getCell(2).value = normalizeCellValue(row.user_fullname);
    worksheetRow.getCell(3).value = normalizeCellValue(row.modification_name);
    worksheetRow.getCell(4).value = normalizeCellValue(row.meter_number);
    worksheetRow.getCell(5).value = normalizeCellValue(row.water_type_label);
    worksheetRow.getCell(6).value = normalizeCellValue(row.production_year);
    worksheetRow.getCell(7).value = normalizeCellValue(row.current_value);

    const verificationDate = toExcelDate(row.verification_date);
    worksheetRow.getCell(8).value = verificationDate;
    worksheetRow.getCell(8).numFmt = EXCEL_DATE_FORMAT;

    const nextVerificationDate = toExcelDate(row.next_verification_date);
    worksheetRow.getCell(9).value = nextVerificationDate;
    worksheetRow.getCell(9).numFmt = EXCEL_DATE_FORMAT;

    worksheetRow.getCell(10).value = normalizeCellValue(row.client_phone);
    worksheetRow.getCell(11).value = normalizeCellValue(row.client_name);
    worksheetRow.getCell(12).value = normalizeCellValue(row.address);
    worksheetRow.alignment = { vertical: "top", horizontal: "left", wrapText: true };
  });

  const finalRowNumber = 5 + input.rows.length;
  worksheet.getCell(finalRowNumber, 1).value = "Пакеты информации на конец дня";
  worksheet.getCell(finalRowNumber, 2).value = input.endPackages;

  return workbook;
}

export function createOrgMetrologReportGenerator(
  input: CreateOrgMetrologReportGeneratorInput
): ReportGenerator {
  return {
    code: REPORT_CODE,
    title: REPORT_TITLE,

    getFileName(reportDate: string) {
      return `Otchet_metrolog_all_${formatDateForFileName(reportDate)}.xlsx`;
    },

    async generate(): Promise<GeneratedReportResult> {
      throw new Error("org_metrolog report supports only batch generation");
    },

    async generateBatch(batchInput: ReportBatchGenerateInput): Promise<ReportRunItemResult[]> {
      input.logger.info(
        {
          reportCode: REPORT_CODE,
          date: batchInput.reportDate,
          trigger: batchInput.trigger,
          organizationId: batchInput.organizationId?.toString() ?? null
        },
        "Start report generation: org_metrolog"
      );

      const organizations = await input.prisma.organization.findMany({
        where: batchInput.organizationId ? { id: batchInput.organizationId } : undefined,
        select: {
          id: true,
          name: true,
          balanceStartOfDay: true,
          balance: true,
          userTarif: true
        },
        orderBy: {
          id: "asc"
        }
      });

      if (batchInput.organizationId && organizations.length === 0) {
        throw new Error(`Organization not found: ${batchInput.organizationId.toString()}`);
      }

      input.logger.info(
        {
          reportCode: REPORT_CODE,
          date: batchInput.reportDate,
          organizationsCount: organizations.length
        },
        "Organizations found"
      );

      const clientNameColumn = await resolveClientNameColumn(input.prisma);
      if (!clientNameColumn) {
        input.logger.warn(
          {
            reportCode: REPORT_CODE
          },
          "No client name column found in meter_submissions, column 'Клиент' will be empty"
        );
      }

      const items: ReportRunItemResult[] = [];

      for (const organization of organizations as OrganizationRow[]) {
        const organizationId = organization.id.toString();
        const organizationName = organization.name?.trim() ?? "";
        const fileName = `Otchet_metrolog_${organizationId}_${formatDateForFileName(batchInput.reportDate)}.xlsx`;
        const publicToken = generateReportPublicToken();
        const plannedPaths = buildReportPaths({
          storageDir: input.reportsStorageDir,
          publicBaseUrl: input.reportsPublicBaseUrl,
          publicToken,
          reportCode: REPORT_CODE,
          pathSegments: [organizationId],
          fileName
        });

        let pendingSaved = false;

        try {
          await batchInput.generatedReportsRepository.markPending({
            reportCode: REPORT_CODE,
            reportDate: batchInput.reportDate,
            organizationId: organization.id,
            fileName: plannedPaths.fileName,
            filePath: plannedPaths.absolutePath,
            publicToken,
            publicUrl: plannedPaths.publicUrl
          });
          pendingSaved = true;

          input.logger.info(
            {
              reportCode: REPORT_CODE,
              date: batchInput.reportDate,
              organizationId,
              orgName: organizationName
            },
            "Generate org report"
          );

          const rows = await fetchOrgMetrologRows({
            prisma: input.prisma,
            reportDate: batchInput.reportDate,
            reportsTimeZone: input.reportsTimeZone,
            organizationId: organization.id,
            clientNameColumn
          });

          for (const row of rows) {
            if (!row.water_type_label) {
              input.logger.warn(
                {
                  reportCode: REPORT_CODE,
                  submissionId: row.submission_id,
                  waterType: row.water_type_raw
                },
                "Unknown water_type value, next verification date left empty"
              );
            }

            if (!row.current_value) {
              input.logger.warn(
                {
                  reportCode: REPORT_CODE,
                  submissionId: row.submission_id,
                  organizationId
                },
                "Submission has empty meter reading value"
              );
            }

            if (!row.client_name) {
              input.logger.warn(
                {
                  reportCode: REPORT_CODE,
                  submissionId: row.submission_id,
                  organizationId
                },
                "Submission has empty client name"
              );
            }
          }

          const startPackages = calculatePackagesCount({
            balanceRubles: organization.balanceStartOfDay,
            tariffRubles: organization.userTarif,
            logger: input.logger,
            organizationId,
            organizationName,
            reportDate: batchInput.reportDate,
            metric: "start"
          });
          const transferredPackages = rows.length;
          const endPackages = calculatePackagesCount({
            balanceRubles: organization.balance,
            tariffRubles: organization.userTarif,
            logger: input.logger,
            organizationId,
            organizationName,
            reportDate: batchInput.reportDate,
            metric: "end"
          });

          input.logger.info(
            {
              reportCode: REPORT_CODE,
              organizationId,
              rowsFetched: rows.length,
              startPackages,
              transferredPackages,
              endPackages
            },
            "Prepared data for organization report"
          );

          await fs.mkdir(plannedPaths.reportDir, { recursive: true });
          const workbook = buildWorkbook({
            reportDate: batchInput.reportDate,
            startPackages,
            transferredPackages,
            endPackages,
            rows
          });
          await writeWorkbookAtomically(workbook, plannedPaths.absolutePath);

          await batchInput.generatedReportsRepository.markSuccess({
            reportCode: REPORT_CODE,
            reportDate: batchInput.reportDate,
            organizationId: organization.id,
            fileName,
            filePath: plannedPaths.absolutePath,
            publicToken,
            publicUrl: plannedPaths.publicUrl,
            rowsCount: rows.length
          });

          input.logger.info(
            {
              reportCode: REPORT_CODE,
              organizationId,
              orgName: organizationName,
              filePath: plannedPaths.absolutePath,
              publicUrl: plannedPaths.publicUrl
            },
            "File saved"
          );

          items.push({
            reportCode: REPORT_CODE,
            reportTitle: REPORT_TITLE,
            status: "success",
            fileName,
            absolutePath: plannedPaths.absolutePath,
            publicUrl: plannedPaths.publicUrl,
            rowsCount: rows.length,
            errorText: null,
            organizationId,
            organizationName
          });
        } catch (error) {
          await fs.rm(plannedPaths.absolutePath, { force: true }).catch(() => undefined);

          if (pendingSaved) {
            try {
              await batchInput.generatedReportsRepository.markError({
                reportCode: REPORT_CODE,
                reportDate: batchInput.reportDate,
                organizationId: organization.id,
                error
              });
            } catch (metaError) {
              input.logger.error(
                {
                  err: metaError,
                  reportCode: REPORT_CODE,
                  date: batchInput.reportDate,
                  organizationId
                },
                "Failed to mark generated_reports row as error"
              );
            }
          } else {
            input.logger.error(
              {
                err: error,
                reportCode: REPORT_CODE,
                date: batchInput.reportDate,
                organizationId
              },
              "Failed before generated_reports pending metadata was saved"
            );
          }

          input.logger.error(
            {
              err: error,
              reportCode: REPORT_CODE,
              date: batchInput.reportDate,
              organizationId,
              orgName: organizationName
            },
            "Generate org report failed"
          );

          items.push({
            reportCode: REPORT_CODE,
            reportTitle: REPORT_TITLE,
            status: "error",
            fileName: plannedPaths.fileName,
            absolutePath: plannedPaths.absolutePath,
            publicUrl: plannedPaths.publicUrl,
            rowsCount: 0,
            errorText: toErrorText(error),
            organizationId,
            organizationName
          });
        }
      }

      return items;
    }
  };
}
