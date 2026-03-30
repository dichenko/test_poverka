import crypto from "crypto";
import ipaddr from "ipaddr.js";
import { logger } from "../../common/logger";
import { env } from "../../config/env";

export interface YookassaAmount {
  value: string;
  currency: string;
}

export interface YookassaPayment {
  id: string;
  status: string;
  paid?: boolean;
  amount?: YookassaAmount;
  metadata?: Record<string, unknown>;
  confirmation?: {
    type?: string;
    confirmation_url?: string;
    return_url?: string;
  };
  cancellation_details?: {
    party?: string;
    reason?: string;
  };
  paid_at?: string;
  captured_at?: string;
  created_at?: string;
}

export interface YookassaCreatePaymentPayload {
  amount: YookassaAmount;
  capture: boolean;
  confirmation: {
    type: "redirect";
    return_url: string;
  };
  description: string;
  metadata: Record<string, string>;
  receipt?: {
    customer: {
      email?: string;
      phone?: string;
    };
    items: Array<{
      description: string;
      quantity: string;
      amount: YookassaAmount;
      vat_code: number;
      payment_mode?: "full_prepayment" | "prepayment" | "advance" | "full_payment" | "partial_payment" | "credit" | "credit_payment";
      payment_subject?: "commodity" | "excise" | "job" | "service" | "gambling_bet" | "gambling_prize" | "lottery" | "lottery_prize" | "intellectual_activity" | "payment" | "agent_commission" | "composite" | "another";
    }>;
  };
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function maskBodyForLog(body: unknown) {
  if (!body || typeof body !== "object") {
    return body;
  }

  const clone = JSON.parse(JSON.stringify(body));
  if (clone?.metadata) {
    clone.metadata = "[REDACTED_METADATA]";
  }
  return clone;
}

function normalizeRemoteIp(rawIp: string): string {
  const first = rawIp.split(",")[0]?.trim() ?? "";
  if (!first) {
    return "";
  }

  if (first.startsWith("::ffff:")) {
    return first.slice("::ffff:".length);
  }

  return first;
}

function parseAllowlistEntry(entry: string) {
  const trimmed = entry.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.includes("/")) {
    const parsed = ipaddr.parseCIDR(trimmed);
    return {
      kind: "cidr" as const,
      value: parsed
    };
  }

  const parsed = ipaddr.parse(trimmed);
  return {
    kind: "single" as const,
    value: parsed
  };
}

function normalizeApiBaseUrl() {
  const base = env.YOOKASSA_API_BASE_URL.replace(/\/+$/, "");
  if (/\/v3$/i.test(base)) {
    return base;
  }
  return `${base}/v3`;
}

function normalizeRequestPath(path: string) {
  const trimmed = path.trim();
  const withoutLeadingSlash = trimmed.replace(/^\/+/, "");
  return withoutLeadingSlash.replace(/^v3\/+/i, "");
}

export class YookassaHttpError extends Error {
  public readonly status: number;
  public readonly responseBody: string;
  public readonly retryable: boolean;

  constructor(input: { status: number; responseBody: string; retryable: boolean }) {
    super(`YooKassa API request failed with status ${input.status}`);
    this.status = input.status;
    this.responseBody = input.responseBody;
    this.retryable = input.retryable;
  }
}

export class YookassaClient {
  private readonly allowlist = env.YOOKASSA_WEBHOOK_ALLOWED_IPS.split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => parseAllowlistEntry(item))
    .filter((item): item is NonNullable<ReturnType<typeof parseAllowlistEntry>> => Boolean(item));

  buildBasicAuthHeader() {
    const credentials = `${env.YOOKASSA_SHOP_ID}:${env.YOOKASSA_SECRET_KEY}`;
    return `Basic ${Buffer.from(credentials).toString("base64")}`;
  }

  generateIdempotenceKey() {
    return crypto.randomUUID();
  }

  verifyWebhookIp(ip: string | null | undefined) {
    if (!ip) {
      return false;
    }

    const normalized = normalizeRemoteIp(ip);
    if (!normalized) {
      return false;
    }

    let remote: ipaddr.IPv4 | ipaddr.IPv6;
    try {
      remote = ipaddr.parse(normalized);
    } catch {
      return false;
    }

    if (!this.allowlist.length) {
      return false;
    }

    for (const rule of this.allowlist) {
      try {
        if (rule.kind === "single") {
          if (remote.toNormalizedString() === rule.value.toNormalizedString()) {
            return true;
          }
          continue;
        }

        if (remote.kind() !== rule.value[0].kind()) {
          continue;
        }

        if (remote.match(rule.value)) {
          return true;
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  async createPayment(payload: YookassaCreatePaymentPayload, idempotenceKey: string) {
    return this.requestJson<YookassaPayment>("POST", "/payments", payload, idempotenceKey);
  }

  async getPayment(paymentId: string) {
    return this.requestJson<YookassaPayment>("GET", `/payments/${encodeURIComponent(paymentId)}`);
  }

  async cancelPayment(paymentId: string, idempotenceKey: string) {
    return this.requestJson<YookassaPayment>("POST", `/payments/${encodeURIComponent(paymentId)}/cancel`, {}, idempotenceKey);
  }

  private async requestJson<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, idempotenceKey?: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, env.YOOKASSA_HTTP_TIMEOUT_MS);

    const requestPath = normalizeRequestPath(path);
    const base = normalizeApiBaseUrl();
    const url = new URL(`${base}/${requestPath}`);

    const headers: Record<string, string> = {
      Authorization: this.buildBasicAuthHeader(),
      Accept: "application/json"
    };

    if (method !== "GET") {
      headers["Content-Type"] = "application/json";
    }

    if ((method === "POST" || method === "DELETE") && idempotenceKey) {
      headers["Idempotence-Key"] = idempotenceKey;
    }

    try {
      logger.debug(
        {
          provider: "yookassa",
          method,
          path: `/${requestPath}`,
          body: maskBodyForLog(body)
        },
        "YooKassa request"
      );

      const response = await fetch(url, {
        method,
        headers,
        body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
        signal: controller.signal
      });

      const responseBody = await response.text();
      if (!response.ok) {
        logger.warn(
          {
            provider: "yookassa",
            method,
            path: `/${requestPath}`,
            status: response.status,
            responseBody
          },
          "YooKassa non-200 response"
        );

        throw new YookassaHttpError({
          status: response.status,
          responseBody,
          retryable: isRetryableStatus(response.status)
        });
      }

      logger.debug(
        {
          provider: "yookassa",
          method,
          path: `/${requestPath}`,
          status: response.status
        },
        "YooKassa response"
      );

      if (!responseBody.trim()) {
        return {} as T;
      }

      return JSON.parse(responseBody) as T;
    } catch (error) {
      if (error instanceof YookassaHttpError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new YookassaHttpError({
          status: 504,
          responseBody: "YooKassa timeout",
          retryable: true
        });
      }

      throw new YookassaHttpError({
        status: 503,
        responseBody: error instanceof Error ? error.message : String(error),
        retryable: true
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const yookassaClient = new YookassaClient();
