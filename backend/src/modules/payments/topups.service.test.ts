import { beforeEach, describe, expect, it, vi } from "vitest";

function ensureEnv() {
  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/test";
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "12345678901234567890123456789012";
  process.env.MAX_BOT_TOKEN = process.env.MAX_BOT_TOKEN || "bot_token";
  process.env.MAX_WEBHOOK_SECRET = process.env.MAX_WEBHOOK_SECRET || "webhook_secret";
  process.env.MAX_BOT_API_BASE_URL = process.env.MAX_BOT_API_BASE_URL || "https://botapi.max.ru";
  process.env.MINIAPP_PUBLIC_URL = process.env.MINIAPP_PUBLIC_URL || "https://miniapp.example.com";
  process.env.BACKEND_PUBLIC_URL = process.env.BACKEND_PUBLIC_URL || "https://api.example.com";
  process.env.YOOKASSA_API_BASE_URL = process.env.YOOKASSA_API_BASE_URL || "https://api.yookassa.ru/v3";
  process.env.YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID || "shop";
  process.env.YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY || "secret";
  process.env.YOOKASSA_CURRENCY = process.env.YOOKASSA_CURRENCY || "RUB";
  process.env.YOOKASSA_RETURN_URL = process.env.YOOKASSA_RETURN_URL || "https://app.example.com/return";
  process.env.YOOKASSA_HTTP_TIMEOUT_MS = process.env.YOOKASSA_HTTP_TIMEOUT_MS || "10000";
  process.env.YOOKASSA_WEBHOOK_ALLOWED_IPS = process.env.YOOKASSA_WEBHOOK_ALLOWED_IPS || "127.0.0.1,::1";
  process.env.TOPUP_LINK_TTL_SECONDS = process.env.TOPUP_LINK_TTL_SECONDS || "180";
}

function makeTopup(overrides: Partial<any> = {}) {
  return {
    id: "76a2c557-8423-4291-b94c-eb475a1d67f0",
    organizationId: 77n,
    userId: 101n,
    status: "awaiting_payment",
    packagesCount: 2,
    tariffPerPackageRubles: 150n,
    amountRubles: 300n,
    currency: "RUB",
    provider: "yookassa",
    providerPaymentId: "pay_1",
    providerStatus: "pending",
    providerConfirmationUrl: "https://pay.test/confirm_1",
    providerIdempotenceKey: "idem-1",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    paidAt: null,
    canceledAt: null,
    cancelReasonCode: null,
    cancelReasonText: null,
    lastProviderSyncAt: null,
    nextPollAt: new Date(),
    pollAttempts: 0,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {
      id: 101n,
      fullName: "User",
      role: "USER"
    },
    organization: {
      id: 77n,
      name: "Org",
      balance: 1000n,
      userTarif: 150n
    },
    ...overrides
  };
}

async function loadService() {
  ensureEnv();
  vi.resetModules();

  class TestYookassaHttpError extends Error {
    status: number;
    responseBody: string;
    retryable: boolean;

    constructor(input: { status: number; responseBody: string; retryable: boolean }) {
      super(`status ${input.status}`);
      this.status = input.status;
      this.responseBody = input.responseBody;
      this.retryable = input.retryable;
    }
  }

  const mockPrisma: any = {
    organizationTopup: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn()
    },
    user: {
      findUnique: vi.fn()
    },
    organizationTopupPaymentAttempt: {
      upsert: vi.fn()
    },
    organization: {
      update: vi.fn()
    },
    organizationBalanceTransaction: {
      create: vi.fn()
    },
    yookassaWebhookLog: {
      create: vi.fn(),
      update: vi.fn()
    },
    $transaction: vi.fn()
  };

  const mockYookassaClient: any = {
    createPayment: vi.fn(),
    getPayment: vi.fn(),
    cancelPayment: vi.fn(),
    buildBasicAuthHeader: vi.fn(),
    generateIdempotenceKey: vi.fn(() => "idem-key"),
    verifyWebhookIp: vi.fn(() => true)
  };

  const mockBotClient: any = {
    sendMessage: vi.fn(async () => ({ ok: true })),
    answerCallback: vi.fn(async () => undefined)
  };

  const mockProfileService: any = {
    getUserProfilePayload: vi.fn(async () => ({
      text: "Profile:\n...",
      attachments: [{ type: "inline_keyboard", payload: { buttons: [[{ text: "Top up balance", payload: "topup_balance" }]] } }]
    }))
  };

  const mockBotStateService: any = {
    clearBotUserState: vi.fn(async () => undefined)
  };

  vi.doMock("../../common/prisma", () => ({ prisma: mockPrisma }));
  vi.doMock("../bot/max-bot.client", () => ({ maxBotClient: mockBotClient }));
  vi.doMock("../bot/profile.service", () => mockProfileService);
  vi.doMock("../bot/bot-state.service", () => mockBotStateService);
  vi.doMock("./yookassa.client", () => ({
    YookassaHttpError: TestYookassaHttpError,
    yookassaClient: mockYookassaClient
  }));

  const service = await import("./topups.service");

  return {
    service,
    mockPrisma,
    mockYookassaClient,
    mockBotClient,
    mockProfileService,
    mockBotStateService,
    TestYookassaHttpError
  };
}

describe("topups.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid packages count", async () => {
    const { service } = await loadService();

    await expect(service.createOrReuseTopupForUser({ userIdRaw: "101", packagesCount: 0 })).rejects.toMatchObject({
      code: "TOPUP_INVALID_PACKAGES_COUNT"
    });

    await expect(service.createOrReuseTopupForUser({ userIdRaw: "101", packagesCount: 1.5 })).rejects.toMatchObject({
      code: "TOPUP_INVALID_PACKAGES_COUNT"
    });
  });

  it("returns existing active topup on repeated topup action", async () => {
    const { service, mockPrisma, mockYookassaClient } = await loadService();
    const activeTopup = makeTopup();

    mockPrisma.organizationTopup.findFirst.mockResolvedValue(activeTopup);

    const result = await service.createOrReuseTopupForUser({ userIdRaw: "101", packagesCount: 5 });

    expect(result.reused).toBe(true);
    expect(result.topup.id).toBe(activeTopup.id);
    expect(mockYookassaClient.createPayment).not.toHaveBeenCalled();
  });

  it("creates payment and stores confirmation_url", async () => {
    const { service, mockPrisma, mockYookassaClient } = await loadService();

    mockPrisma.organizationTopup.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 101n,
      organizationId: 77n,
      phone: "+79000000000",
      orgEmail: null,
      userTarif: null,
      organization: {
        id: 77n,
        email: "org@example.com",
        userTarif: 200n,
        balance: 1000n
      }
    });

    const createdTopup = makeTopup({
      id: "0ec4ac2f-8242-46a9-8ed2-0684e5b2100d",
      amountRubles: 400n,
      tariffPerPackageRubles: 200n,
      packagesCount: 2,
      providerPaymentId: null,
      providerConfirmationUrl: null
    });

    mockPrisma.organizationTopup.create.mockResolvedValue(createdTopup);
    mockYookassaClient.createPayment.mockResolvedValue({
      id: "pay_new",
      status: "pending",
      confirmation: {
        confirmation_url: "https://pay.example/confirm"
      }
    });

    mockPrisma.organizationTopup.update.mockResolvedValue(
      makeTopup({
        ...createdTopup,
        providerPaymentId: "pay_new",
        providerConfirmationUrl: "https://pay.example/confirm"
      })
    );

    const result = await service.createOrReuseTopupForUser({ userIdRaw: "101", packagesCount: 2 });

    expect(result.reused).toBe(false);
    expect(result.topup.providerPaymentId).toBe("pay_new");
    expect(result.topup.providerConfirmationUrl).toBe("https://pay.example/confirm");
  });

  it("stores failed topup if YooKassa createPayment returns error", async () => {
    const { service, mockPrisma, mockYookassaClient, TestYookassaHttpError } = await loadService();

    mockPrisma.organizationTopup.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 101n,
      organizationId: 77n,
      phone: "+79000000000",
      orgEmail: null,
      userTarif: null,
      organization: {
        id: 77n,
        email: "org@example.com",
        userTarif: 200n,
        balance: 1000n
      }
    });

    mockPrisma.organizationTopup.create.mockResolvedValue(
      makeTopup({
        id: "0ec4ac2f-8242-46a9-8ed2-0684e5b2100d",
        amountRubles: 400n,
        tariffPerPackageRubles: 200n,
        packagesCount: 2,
        providerPaymentId: null,
        providerConfirmationUrl: null
      })
    );

    mockYookassaClient.createPayment.mockRejectedValue(
      new TestYookassaHttpError({ status: 500, responseBody: "upstream", retryable: true })
    );

    await expect(service.createOrReuseTopupForUser({ userIdRaw: "101", packagesCount: 2 })).rejects.toMatchObject({
      code: "TOPUP_CREATE_FAILED"
    });

    expect(mockPrisma.organizationTopup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed"
        })
      })
    );
  });

  it("returns explicit error when receipt contact data is missing", async () => {
    const { service, mockPrisma, mockYookassaClient } = await loadService();

    mockPrisma.organizationTopup.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 101n,
      organizationId: 77n,
      phone: null,
      orgEmail: null,
      userTarif: null,
      organization: {
        id: 77n,
        email: null,
        userTarif: 200n,
        balance: 1000n
      }
    });

    mockPrisma.organizationTopup.create.mockResolvedValue(
      makeTopup({
        id: "88f247f0-99ec-4792-8f66-aef7e9f35e00",
        amountRubles: 400n,
        tariffPerPackageRubles: 200n,
        packagesCount: 2,
        providerPaymentId: null,
        providerConfirmationUrl: null
      })
    );

    await expect(service.createOrReuseTopupForUser({ userIdRaw: "101", packagesCount: 2 })).rejects.toMatchObject({
      code: "TOPUP_RECEIPT_CONTACT_REQUIRED"
    });

    expect(mockYookassaClient.createPayment).not.toHaveBeenCalled();
  });

  it("keeps tariff snapshot for created topup", async () => {
    const { service, mockPrisma, mockYookassaClient } = await loadService();

    mockPrisma.organizationTopup.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 101n,
      organizationId: 77n,
      phone: "+79000000000",
      orgEmail: null,
      userTarif: null,
      organization: {
        id: 77n,
        email: "org@example.com",
        userTarif: 150n,
        balance: 1000n
      }
    });

    const createdTopup = makeTopup({
      id: "63bc55d5-d9da-42f7-b5db-07cb5170065f",
      packagesCount: 2,
      tariffPerPackageRubles: 150n,
      amountRubles: 300n,
      providerPaymentId: null,
      providerConfirmationUrl: null
    });

    mockPrisma.organizationTopup.create.mockResolvedValue(createdTopup);
    mockYookassaClient.createPayment.mockResolvedValue({
      id: "pay_1",
      status: "pending",
      confirmation: {
        confirmation_url: "https://pay.example/pay_1"
      }
    });
    mockPrisma.organizationTopup.update.mockResolvedValue(createdTopup);

    const result = await service.createOrReuseTopupForUser({ userIdRaw: "101", packagesCount: 2 });

    expect(result.topup.tariffPerPackageRubles).toBe(150n);
    expect(result.topup.amountRubles).toBe(300n);
  });

  it("uses organization tariff and ignores user tariff when creating topup", async () => {
    const { service, mockPrisma, mockYookassaClient } = await loadService();

    mockPrisma.organizationTopup.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 101n,
      organizationId: 77n,
      phone: "+79000000000",
      orgEmail: null,
      userTarif: 9999,
      organization: {
        id: 77n,
        email: "org@example.com",
        userTarif: 100n,
        balance: 1000n
      }
    });

    mockPrisma.organizationTopup.create.mockResolvedValue(
      makeTopup({
        id: "9b44b985-7398-4533-9e99-2d979f6a4f66",
        packagesCount: 2,
        tariffPerPackageRubles: 100n,
        amountRubles: 200n,
        providerPaymentId: null,
        providerConfirmationUrl: null
      })
    );
    mockYookassaClient.createPayment.mockResolvedValue({
      id: "pay_org_tariff",
      status: "pending",
      confirmation: {
        confirmation_url: "https://pay.example/pay_org_tariff"
      }
    });
    mockPrisma.organizationTopup.update.mockResolvedValue(makeTopup());

    await service.createOrReuseTopupForUser({ userIdRaw: "101", packagesCount: 2 });

    expect(mockPrisma.organizationTopup.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tariffPerPackageRubles: 100n,
          amountRubles: 200n
        })
      })
    );
  });

  it("throws ACTIVE_TOPUP_PENDING from backend guard", async () => {
    const { service, mockPrisma } = await loadService();

    mockPrisma.organizationTopup.findFirst.mockResolvedValue(
      makeTopup({
        providerConfirmationUrl: "https://pay.example/existing"
      })
    );

    await expect(service.assertNoActiveTopupForUser("101")).rejects.toMatchObject({
      code: "ACTIVE_TOPUP_PENDING"
    });
  });

  it("ignores duplicate payment.succeeded without double credit", async () => {
    const { service, mockPrisma, mockBotClient } = await loadService();

    const topup = makeTopup({ amountRubles: 500n });
    let topupStatus = "awaiting_payment";
    let balanceRubles = 1000n;
    let ledgerCreates = 0;

    mockPrisma.organizationTopup.findUnique.mockResolvedValue(topup);
    mockPrisma.organizationTopupPaymentAttempt.upsert.mockResolvedValue({ id: "attempt-1" });

    mockPrisma.$transaction.mockImplementation(async (callback: any) => {
      let queryCalls = 0;
      const tx = {
        $queryRaw: vi.fn(async () => {
          queryCalls += 1;
          if (queryCalls === 1) {
            return [
              {
                id: topup.id,
                status: topupStatus,
                organization_id: topup.organizationId,
                user_id: topup.userId,
                amount_rubles: topup.amountRubles
              }
            ];
          }
          return [{ org_id: topup.organizationId, balance: balanceRubles }];
        }),
        organization: {
          update: vi.fn(async ({ data }: any) => {
            balanceRubles = data.balance;
            return {};
          })
        },
        organizationBalanceTransaction: {
          create: vi.fn(async () => {
            ledgerCreates += 1;
            return {};
          })
        },
        organizationTopup: {
          update: vi.fn(async ({ data }: any) => {
            topupStatus = data.status ?? topupStatus;
            return {};
          })
        }
      };
      return callback(tx);
    });

    const payment = {
      id: "pay_1",
      status: "succeeded",
      paid: true,
      metadata: {
        internal_topup_id: topup.id
      },
      amount: {
        value: "5.00",
        currency: "RUB"
      }
    };

    await service.processPaymentSucceeded({ payment, source: "webhook" });
    await service.processPaymentSucceeded({ payment, source: "webhook" });

    expect(ledgerCreates).toBe(1);
    expect(balanceRubles).toBe(1500n);
    expect(mockBotClient.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("is idempotent under concurrent finalization", async () => {
    const { service, mockPrisma } = await loadService();

    const topup = makeTopup({ amountRubles: 700n });
    let topupStatus = "awaiting_payment";
    let balanceRubles = 1000n;
    let ledgerCreates = 0;
    let txQueue = Promise.resolve();

    mockPrisma.$transaction.mockImplementation((callback: any) => {
      const run = txQueue.then(async () => {
        let queryCalls = 0;
        const tx = {
          $queryRaw: vi.fn(async () => {
            queryCalls += 1;
            if (queryCalls === 1) {
              return [
                {
                  id: topup.id,
                  status: topupStatus,
                  organization_id: topup.organizationId,
                  user_id: topup.userId,
                  amount_rubles: topup.amountRubles
                }
              ];
            }
            return [{ org_id: topup.organizationId, balance: balanceRubles }];
          }),
          organization: {
            update: vi.fn(async ({ data }: any) => {
              balanceRubles = data.balance;
              return {};
            })
          },
          organizationBalanceTransaction: {
            create: vi.fn(async () => {
              ledgerCreates += 1;
              return {};
            })
          },
          organizationTopup: {
            update: vi.fn(async ({ data }: any) => {
              topupStatus = data.status ?? topupStatus;
              return {};
            })
          }
        };

        return callback(tx);
      });

      txQueue = run.then(() => undefined, () => undefined);
      return run;
    });

    const [first, second] = await Promise.all([
      service.finalizeTopupAsPaid({ topupId: topup.id, providerPaymentId: "pay_1" }),
      service.finalizeTopupAsPaid({ topupId: topup.id, providerPaymentId: "pay_1" })
    ]);

    expect([first.credited, second.credited].filter(Boolean)).toHaveLength(1);
    expect(ledgerCreates).toBe(1);
    expect(balanceRubles).toBe(1700n);
  });

  it("closes topup as canceled from payment.canceled", async () => {
    const { service, mockPrisma, mockBotClient } = await loadService();

    const topup = makeTopup({ expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
    mockPrisma.organizationTopup.findUnique.mockResolvedValue(topup);
    mockPrisma.organizationTopupPaymentAttempt.upsert.mockResolvedValue({ id: "attempt" });

    mockPrisma.$transaction.mockImplementation(async (callback: any) => {
      const tx = {
        $queryRaw: vi.fn(async () => [
          {
            id: topup.id,
            status: "awaiting_payment",
            user_id: topup.userId
          }
        ]),
        organizationTopup: {
          update: vi.fn(async () => ({}))
        }
      };
      return callback(tx);
    });

    await service.processPaymentCanceled({
      payment: {
        id: "pay_1",
        status: "canceled",
        metadata: {
          internal_topup_id: topup.id
        },
        cancellation_details: {
          reason: "canceled_by_merchant"
        },
        amount: {
          value: "3.00",
          currency: "RUB"
        }
      },
      source: "webhook"
    });

    expect(mockBotClient.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("expires topup on local timeout when provider still pending", async () => {
    const { service, mockPrisma, mockYookassaClient, mockBotClient } = await loadService();

    const topup = makeTopup({
      providerPaymentId: "pay_1",
      expiresAt: new Date(Date.now() - 60 * 1000)
    });

    mockPrisma.organizationTopup.findUnique.mockResolvedValue(topup);
    mockYookassaClient.getPayment.mockResolvedValueOnce({
      id: "pay_1",
      status: "pending",
      amount: { value: "3.00", currency: "RUB" }
    });
    mockYookassaClient.getPayment.mockResolvedValueOnce({
      id: "pay_1",
      status: "pending",
      amount: { value: "3.00", currency: "RUB" }
    });

    mockPrisma.$transaction.mockImplementation(async (callback: any) => {
      const tx = {
        $queryRaw: vi.fn(async () => [
          {
            id: topup.id,
            status: "awaiting_payment",
            user_id: topup.userId
          }
        ]),
        organizationTopup: {
          update: vi.fn(async () => ({}))
        }
      };
      return callback(tx);
    });

    await service.reconcileTopupWithProvider(topup.id);

    expect(mockBotClient.sendMessage).toHaveBeenCalledTimes(2);
  });
});
