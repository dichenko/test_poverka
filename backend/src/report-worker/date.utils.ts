const REPORT_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function assertValidReportDate(value: string) {
  if (!REPORT_DATE_REGEX.test(value)) {
    throw new Error(`Invalid report date format: "${value}". Expected YYYY-MM-DD.`);
  }

  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid report date value: "${value}".`);
  }

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Invalid report date value: "${value}".`);
  }
}

export function getDateInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((item) => item.type === "year")?.value;
  const month = parts.find((item) => item.type === "month")?.value;
  const day = parts.find((item) => item.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Failed to resolve date in timezone "${timeZone}".`);
  }

  return `${year}-${month}-${day}`;
}

export function resolveReportDate(date: string | undefined, timeZone: string) {
  if (date) {
    assertValidReportDate(date);
    return date;
  }

  return getDateInTimeZone(new Date(), timeZone);
}
