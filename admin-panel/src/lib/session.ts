import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";

const SESSION_COOKIE_NAME = "admin_panel_session";

type SessionPayload = {
  login: string;
  iat: number;
  exp: number;
};

export type AdminSession = {
  login: string;
  expiresAt: Date;
};

function sign(value: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, "utf8");
  const bBuffer = Buffer.from(b, "utf8");
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function encode(payload: SessionPayload, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

function decode(token: string, secret: string): SessionPayload | null {
  const [payloadPart, signature] = token.split(".");
  if (!payloadPart || !signature) {
    return null;
  }

  const expectedSignature = sign(payloadPart, secret);
  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.login || typeof payload.exp !== "number" || typeof payload.iat !== "number") {
      return null;
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function getMaxAgeSeconds(): number {
  const { ADMIN_SESSION_DURATION_DAYS } = getEnv();
  return ADMIN_SESSION_DURATION_DAYS * 24 * 60 * 60;
}

export function readAdminSession(): AdminSession | null {
  const { ADMIN_SESSION_SECRET } = getEnv();
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }

  const payload = decode(token, ADMIN_SESSION_SECRET);
  if (!payload) {
    return null;
  }

  return {
    login: payload.login,
    expiresAt: new Date(payload.exp * 1000)
  };
}

export function createAdminSession(login: string): void {
  const env = getEnv();
  const maxAge = getMaxAgeSeconds();
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    login,
    iat: issuedAt,
    exp: issuedAt + maxAge
  };

  const token = encode(payload, env.ADMIN_SESSION_SECRET);
  cookies().set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge
  });
}

export function clearAdminSession(): void {
  cookies().delete(SESSION_COOKIE_NAME);
}

