import { afterEach, describe, expect, it, vi } from "vitest";

function ensureEnv() {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/test";
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "12345678901234567890123456789012";
  process.env.MAX_BOT_TOKEN = process.env.MAX_BOT_TOKEN || "bot_token";
  process.env.MAX_WEBHOOK_SECRET = process.env.MAX_WEBHOOK_SECRET || "webhook_secret";
  process.env.MAX_BOT_API_BASE_URL = process.env.MAX_BOT_API_BASE_URL || "https://botapi.max.ru";
  process.env.MINIAPP_PUBLIC_URL = process.env.MINIAPP_PUBLIC_URL || "https://miniapp.example.com";
  process.env.BACKEND_PUBLIC_URL = process.env.BACKEND_PUBLIC_URL || "https://api.example.com";
  process.env.YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID || "shop";
  process.env.YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY || "secret";
  process.env.YOOKASSA_CURRENCY = process.env.YOOKASSA_CURRENCY || "RUB";
  process.env.YOOKASSA_RETURN_URL = process.env.YOOKASSA_RETURN_URL || "https://app.example.com/return";
  process.env.YOOKASSA_HTTP_TIMEOUT_MS = process.env.YOOKASSA_HTTP_TIMEOUT_MS || "10000";
  process.env.YOOKASSA_WEBHOOK_ALLOWED_IPS = process.env.YOOKASSA_WEBHOOK_ALLOWED_IPS || "127.0.0.1,::1";
  process.env.TOPUP_LINK_TTL_SECONDS = process.env.TOPUP_LINK_TTL_SECONDS || "180";
}

async function loadClient() {
  vi.resetModules();
  return import("./yookassa.client");
}

const payload = {
  amount: { value: "10.00", currency: "RUB" },
  capture: true,
  confirmation: {
    type: "redirect" as const,
    return_url: "https://app.example.com/return"
  },
  description: "test",
  metadata: {
    internal_topup_id: "topup-1"
  }
};

describe("yookassa.client url building", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses /v3/payments when base url already includes /v3", async () => {
    ensureEnv();
    process.env.YOOKASSA_API_BASE_URL = "https://api.yookassa.ru/v3";

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "pay_1", status: "pending" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { yookassaClient } = await loadClient();
    await yookassaClient.createPayment(payload, "idem-1");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.yookassa.ru/v3/payments");
  });

  it("adds /v3/payments when base url has no /v3", async () => {
    ensureEnv();
    process.env.YOOKASSA_API_BASE_URL = "https://api.yookassa.ru";

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "pay_2", status: "pending" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { yookassaClient } = await loadClient();
    await yookassaClient.createPayment(payload, "idem-2");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.yookassa.ru/v3/payments");
  });
});

