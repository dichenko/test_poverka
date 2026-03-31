const DEFAULT_APP_TIMEZONE = "Europe/Moscow";
const OPEN_FROM_SECONDS = 60; // 00:01:00
const OPEN_UNTIL_SECONDS = 21 * 3600 + 59 * 60 + 59; // 21:59:59

function resolveTimezone() {
  return process.env.APP_TIMEZONE || DEFAULT_APP_TIMEZONE;
}

function getTimeParts(now: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const parts = formatter.formatToParts(now);
  const partByType = new Map(parts.map((part) => [part.type, part.value]));

  const year = Number(partByType.get("year"));
  const month = Number(partByType.get("month"));
  const day = Number(partByType.get("day"));
  const hour = Number(partByType.get("hour"));
  const minute = Number(partByType.get("minute"));
  const second = Number(partByType.get("second"));

  return {
    year,
    month,
    day,
    hour,
    minute,
    second
  };
}

export function getMoscowNow(now: Date = new Date()) {
  const timezone = resolveTimezone();
  const parts = getTimeParts(now, timezone);

  return {
    timezone,
    ...parts
  };
}

export function isSubmissionWindowOpen(now: Date = new Date()) {
  const moscowNow = getMoscowNow(now);
  const daySeconds = moscowNow.hour * 3600 + moscowNow.minute * 60 + moscowNow.second;
  return daySeconds >= OPEN_FROM_SECONDS && daySeconds <= OPEN_UNTIL_SECONDS;
}

export function getSubmissionWindowStatus(now: Date = new Date()) {
  const isOpen = isSubmissionWindowOpen(now);

  return {
    is_open: isOpen,
    timezone: resolveTimezone(),
    allowed_from: "00:01",
    allowed_until: "21:59",
    ...(isOpen ? {} : { message: "Submission window is currently closed." })
  };
}
