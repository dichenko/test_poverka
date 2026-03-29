import crypto from "crypto";
import ipaddr from "ipaddr.js";
import { logger } from "../../common/logger";
import { env } from "../../config/env";

export interface YookassaAmount {
  value: string;
  currency: string;
}

export interface YookassaInvoice {
  id: string;
  status: string;
  amount?: YookassaAmount;
  expires_at?: string;
  delivery_method?: {
    type?: string;
    url?: string;
  };
  payment_details?: {
    id?: string;
    status?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface YookassaPayment {
  id: string;
  status: string;
  paid?: boolean;
  amount?: YookassaAmount;
  metadata?: Record<string, unknown>;
  invoice_details?: {
    id?: string;
  };
  cancellation_details?: {
    party?: string;
    reason?: string;
  };
  paid_at?: string;
  captured_at?: string;
  created_at?: string;
}

export interface YookassaCreateInvoicePayload {
  payment_data: {
    amount: YookassaAmount;
    capture: boolean;
    description: string;
    metadata: Record<string, string>;
  };
  cart: Array<{
    description: string;
    price: YookassaAmount;
    quantity: number;
  }>;
  delivery_method_data: {
    type: "self";
  };
  locale: "ru_RU";
  expires_at: string;
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function maskBodyForLog(body: unknown) {
  if (!body || typeof body !== "object") {
    return body;
  }

  const clone = JSON.parse(JSON.stringify(body));
  if (clone?.payment_data?.metadata) {
    clone.payment_data.metadata = "[REDACTED_METADATA]";
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
  private readonly allowlist = env.YOOKASSA_WEBHOOK_IP_ALLOWLIST.split(",")
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

  async createInvoice(payload: YookassaCreateInvoicePayload, idempotenceKey: string) {
    return this.requestJson<YookassaInvoice>("POST", "/v3/invoices", payload, idempotenceKey);
  }

  async getInvoice(invoiceId: string) {
    return this.requestJson<YookassaInvoice>("GET", `/v3/invoices/${encodeURIComponent(invoiceId)}`);
  }

  async getPayment(paymentId: string) {
    return this.requestJson<YookassaPayment>("GET", `/v3/payments/${encodeURIComponent(paymentId)}`);
  }

  async cancelPayment(paymentId: string, idempotenceKey: string) {
    return this.requestJson<YookassaPayment>(
      "POST",
      `/v3/payments/${encodeURIComponent(paymentId)}/cancel`,
      {},
      idempotenceKey
    );
  }

  private async requestJson<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, idempotenceKey?: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, env.YOOKASSA_REQUEST_TIMEOUT_MS);

    const url = new URL(path, env.YOOKASSA_API_BASE_URL);
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
          path,
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
            path,
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
          path,
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
