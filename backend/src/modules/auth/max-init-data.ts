import crypto from "crypto";
import { AppError } from "../../common/app-error";
import { env } from "../../config/env";

export interface ValidatedMaxInitData {
  maxUserId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  authDate: number;
  replayKey: string;
}

function timingSafeHexCompare(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

export function verifyMaxInitData(rawInitData: string): ValidatedMaxInitData {
  if (!rawInitData) {
    throw new AppError("initData is required.", 400, "INITDATA_MISSING");
  }

  const params = new URLSearchParams(rawInitData);
  const hash = params.get("hash");
  const authDateRaw = params.get("auth_date");
  const userRaw = params.get("user");
  const queryId = params.get("query_id");

  if (!hash || !authDateRaw || !userRaw) {
    throw new AppError("initData is missing required fields.", 400, "INITDATA_INVALID");
  }

  const authDate = Number(authDateRaw);
  if (!Number.isInteger(authDate)) {
    throw new AppError("initData auth_date is invalid.", 400, "INITDATA_INVALID");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds - authDate > env.MAX_INITDATA_TTL_SECONDS) {
    throw new AppError("initData is expired.", 401, "INITDATA_EXPIRED");
  }

  const entries: Array<[string, string]> = [];
  params.forEach((value, key) => {
    if (key !== "hash") {
      entries.push([key, value]);
    }
  });
  entries.sort((a, b) => a[0].localeCompare(b[0]));

  const dataCheckString = entries.map(([key, value]) => `${key}=${value}`).join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(env.MAX_BOT_TOKEN).digest();
  const expectedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (!timingSafeHexCompare(expectedHash, hash)) {
    throw new AppError("initData hash validation failed.", 401, "INITDATA_HASH_INVALID");
  }

  let userParsed: Record<string, unknown>;
  try {
    userParsed = JSON.parse(userRaw) as Record<string, unknown>;
  } catch {
    throw new AppError("initData user JSON is invalid.", 400, "INITDATA_INVALID");
  }

  const maxUserId = String(userParsed.id ?? "").trim();
  if (!maxUserId) {
    throw new AppError("initData user id is missing.", 400, "INITDATA_INVALID");
  }

  return {
    maxUserId,
    username: typeof userParsed.username === "string" ? userParsed.username : undefined,
    firstName: typeof userParsed.first_name === "string" ? userParsed.first_name : undefined,
    lastName: typeof userParsed.last_name === "string" ? userParsed.last_name : undefined,
    authDate,
    replayKey: queryId?.trim() || `${maxUserId}:${authDate}:${hash}`
  };
}
