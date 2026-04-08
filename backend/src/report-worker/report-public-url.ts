import crypto from "crypto";

const REPORT_PUBLIC_TOKEN_BYTES = 24;
const REPORT_PUBLIC_TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, "");
}

export function generateReportPublicToken() {
  return crypto.randomBytes(REPORT_PUBLIC_TOKEN_BYTES).toString("base64url");
}

export function isValidReportPublicToken(value: string) {
  return REPORT_PUBLIC_TOKEN_RE.test(value);
}

export function buildReportPublicUrl(input: { publicBaseUrl: string; publicToken: string }) {
  return `${trimTrailingSlashes(input.publicBaseUrl)}/${encodeURIComponent(input.publicToken)}`;
}

export function extractPathnameFromPublicBaseUrl(publicBaseUrl: string) {
  try {
    const parsed = new URL(publicBaseUrl);
    return parsed.pathname || "/";
  } catch {
    return publicBaseUrl;
  }
}

export function normalizePublicRoutePath(pathname: string) {
  const normalized = pathname.trim().replace(/\/+/g, "/");
  if (!normalized || normalized === "/") {
    return "/";
  }
  return `/${normalized.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}
