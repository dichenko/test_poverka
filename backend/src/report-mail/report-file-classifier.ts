export const ADMIN_REPORT_TYPES = ["arshin", "balance_arshin"] as const;
export type AdminReportType = (typeof ADMIN_REPORT_TYPES)[number];

export type ReportClassification =
  | {
      kind: "admin";
      reportType: AdminReportType;
      reportDate: string;
      fileName: string;
      organizationId: null;
    }
  | {
      kind: "organization";
      reportType: "org_metrolog";
      reportDate: string;
      fileName: string;
      organizationId: bigint;
    };

const ARSHIN_RE = /^Arshin_(\d{4}-\d{2}-\d{2})\.xlsx$/;
const BALANCE_ARSHIN_RE = /^Balance_Arshin_(\d{4}-\d{2}-\d{2})\.xlsx$/;
const ORG_METROLOG_RE = /^Otchet_metrolog_(\d+)_(\d{2})-(\d{2})-(\d{4})\.xlsx$/;

function isValidDateParts(year: number, month: number, day: number) {
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day
  );
}

function isValidDateOnly(value: string) {
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  return isValidDateParts(year, month, day);
}

function fromDmy(dayRaw: string, monthRaw: string, yearRaw: string) {
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const year = Number(yearRaw);

  if (!isValidDateParts(year, month, day)) {
    return null;
  }

  return `${yearRaw}-${monthRaw}-${dayRaw}`;
}

export function classifyReportFileName(fileNameRaw: string): ReportClassification | null {
  const fileName = fileNameRaw.trim();
  if (!fileName) {
    return null;
  }

  const arshinMatch = fileName.match(ARSHIN_RE);
  if (arshinMatch) {
    const reportDate = arshinMatch[1];
    if (!isValidDateOnly(reportDate)) {
      return null;
    }
    return {
      kind: "admin",
      reportType: "arshin",
      reportDate,
      fileName,
      organizationId: null
    };
  }

  const balanceMatch = fileName.match(BALANCE_ARSHIN_RE);
  if (balanceMatch) {
    const reportDate = balanceMatch[1];
    if (!isValidDateOnly(reportDate)) {
      return null;
    }
    return {
      kind: "admin",
      reportType: "balance_arshin",
      reportDate,
      fileName,
      organizationId: null
    };
  }

  const orgMatch = fileName.match(ORG_METROLOG_RE);
  if (orgMatch) {
    const organizationId = BigInt(orgMatch[1]);
    const reportDate = fromDmy(orgMatch[2], orgMatch[3], orgMatch[4]);
    if (!reportDate) {
      return null;
    }

    return {
      kind: "organization",
      reportType: "org_metrolog",
      reportDate,
      fileName,
      organizationId
    };
  }

  return null;
}

export function isAdminReportType(reportType: string) {
  return ADMIN_REPORT_TYPES.includes(reportType as AdminReportType);
}
