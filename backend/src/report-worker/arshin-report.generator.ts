import fs from "fs/promises";
import ExcelJS from "exceljs";
import { Prisma, type PrismaClient } from "@prisma/client";
import { buildReportPaths } from "./report-paths";
import type { GeneratedReportResult, ReportGenerator, ReportLogger } from "./report.types";

const REPORT_CODE = "arshin";
const REPORT_TITLE = "Arshin";
const SHEET_TITLE = "Arshin";

const HEADERS = [
  "№п/п",
  "Модификация СИ",
  "Заводской номер СИ",
  "Вид счетчика",
  "Год выпуска",
  "Дата поверки",
  "Дата следующей поверки",
  "Телефон клиента",
  "Клиент",
  "Город",
  "Адрес",
  "Фотографии",
  "MaxID",
  "Ф.И.О.пользователя",
  "Номер телефона",
  "Наименование организации"
] as const;

const COLUMN_WIDTHS = [8, 32, 24, 14, 12, 16, 22, 22, 20, 20, 36, 90, 16, 32, 22, 30] as const;

interface ArshinRow {
  submission_id: string;
  modification_name: string | null;
  meter_number: string;
  water_type_raw: string | null;
  water_type_label: string | null;
  production_year: number | null;
  verification_date: string;
  next_verification_date: string | null;
  client_phone: string | null;
  city: string | null;
  address: string | null;
  photos: string | null;
  max_id: string;
  user_fullname: string;
  user_phone: string | null;
  org_name: string | null;
}

interface CreateArshinReportGeneratorInput {
  prisma: PrismaClient;
  logger: ReportLogger;
  reportsStorageDir: string;
  reportsPublicBaseUrl: string;
  reportsTimeZone: string;
}

function normalizeCellValue(value: string | number | null) {
  if (value === null || value === undefined) {
    return "";
  }
  return value;
}

async function fetchArshinRows(input: {
  prisma: PrismaClient;
  reportDate: string;
  reportsTimeZone: string;
}) {
  return input.prisma.$queryRaw<ArshinRow[]>(Prisma.sql`
    WITH files_agg AS (
      SELECT
        f.submission_id,
        string_agg(f.public_url, E'\n' ORDER BY f.id) AS photos
      FROM files AS f
      WHERE f.submission_id IS NOT NULL
      GROUP BY f.submission_id
    )
    SELECT
      ms.id AS submission_id,
      COALESCE(et.name, ms.custom_equipment_type_name) AS modification_name,
      ms.meter_number,
      ms.water_type::text AS water_type_raw,
      CASE
        WHEN lower(ms.water_type::text) IN ('hvs', 'cold', 'хвс') THEN 'Холодная вода'
        WHEN lower(ms.water_type::text) IN ('gvs', 'hot', 'гвс') THEN 'Горячая вода'
        ELSE NULL
      END AS water_type_label,
      ms.production_year,
      to_char(ms.confirmed_at AT TIME ZONE ${input.reportsTimeZone}, 'DD.MM.YYYY') AS verification_date,
      CASE
        WHEN lower(ms.water_type::text) IN ('hvs', 'cold', 'хвс')
          THEN to_char(((ms.confirmed_at AT TIME ZONE ${input.reportsTimeZone})::date + interval '6 years' - interval '1 day'), 'DD.MM.YYYY')
        WHEN lower(ms.water_type::text) IN ('gvs', 'hot', 'гвс')
          THEN to_char(((ms.confirmed_at AT TIME ZONE ${input.reportsTimeZone})::date + interval '4 years' - interval '1 day'), 'DD.MM.YYYY')
        ELSE NULL
      END AS next_verification_date,
      ms.phone AS client_phone,
      u.user_city AS city,
      ms.address,
      fa.photos,
      u.user_id::text AS max_id,
      u.user_fullname,
      u.user_phone,
      u.org_name
    FROM meter_submissions AS ms
    INNER JOIN users AS u
      ON u.user_id = ms.user_id
    LEFT JOIN equipment_types AS et
      ON et.id = ms.equipment_type_id
    LEFT JOIN files_agg AS fa
      ON fa.submission_id = ms.id
    WHERE ms.status = 'CONFIRMED'
      AND ms.confirmed_at IS NOT NULL
      AND (ms.confirmed_at AT TIME ZONE ${input.reportsTimeZone}) >= (${input.reportDate}::date + TIME '00:01:00')
      AND (ms.confirmed_at AT TIME ZONE ${input.reportsTimeZone}) <= (${input.reportDate}::date + TIME '21:59:59')
    ORDER BY ms.confirmed_at ASC, ms.id ASC
  `);
}

export function createArshinReportGenerator(input: CreateArshinReportGeneratorInput): ReportGenerator {
  return {
    code: REPORT_CODE,
    title: REPORT_TITLE,

    getFileName(reportDate: string) {
      return `Arshin_${reportDate}.xlsx`;
    },

    async generate(reportDate: string): Promise<GeneratedReportResult> {
      const fileName = `Arshin_${reportDate}.xlsx`;
      const paths = buildReportPaths({
        storageDir: input.reportsStorageDir,
        publicBaseUrl: input.reportsPublicBaseUrl,
        reportCode: REPORT_CODE,
        fileName
      });

      await fs.mkdir(paths.reportDir, { recursive: true });

      const rows = await fetchArshinRows({
        prisma: input.prisma,
        reportDate,
        reportsTimeZone: input.reportsTimeZone
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
      }

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(SHEET_TITLE);
      worksheet.columns = HEADERS.map((header, index) => ({
        header,
        key: `c${index + 1}`,
        width: COLUMN_WIDTHS[index]
      }));
      worksheet.views = [{ state: "frozen", ySplit: 1 }];

      rows.forEach((row, index) => {
        worksheet.addRow({
          c1: index + 1,
          c2: normalizeCellValue(row.modification_name),
          c3: normalizeCellValue(row.meter_number),
          c4: normalizeCellValue(row.water_type_label),
          c5: normalizeCellValue(row.production_year),
          c6: normalizeCellValue(row.verification_date),
          c7: normalizeCellValue(row.next_verification_date),
          c8: normalizeCellValue(row.client_phone),
          c9: "",
          c10: normalizeCellValue(row.city),
          c11: normalizeCellValue(row.address),
          c12: normalizeCellValue(row.photos),
          c13: normalizeCellValue(row.max_id),
          c14: normalizeCellValue(row.user_fullname),
          c15: normalizeCellValue(row.user_phone),
          c16: normalizeCellValue(row.org_name)
        });
      });

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) {
          return;
        }
        row.alignment = { vertical: "top", wrapText: true };
      });

      worksheet.getColumn(12).alignment = { vertical: "top", wrapText: true };

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

      return {
        fileName,
        absolutePath: paths.absolutePath,
        publicUrl: paths.publicUrl,
        rowsCount: rows.length
      };
    }
  };
}

