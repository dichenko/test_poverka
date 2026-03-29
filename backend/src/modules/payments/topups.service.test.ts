import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../common/app-error";

function ensureEnv() {
  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/test";
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "12345678901234567890123456789012";
  process.env.MAX_BOT_TOKEN = process.env.MAX_BOT_TOKEN || "bot_token";
  process.env.MAX_WEBHOOK_SECRET = process.env.MAX_WEBHOOK_SECRET || "webhook_secret";
  process.env.MAX_BOT_API_BASE_URL = process.env.MAX_BOT_API_BASE_URL || "https://botapi.max.ru";
  process.env.MINIAPP_PUBLIC_URL = process.env.MINIAPP_PUBLIC_URL || "https://miniapp.example.com";
  process.env.BACKEND_PUBLIC_URL = process.env.BACKEND_PUBLIC_URL || "https://api.example.com";
  process.env.YOOKASSA_API_BASE_URL = process.env.YOOKASSA_API_BASE_URL || "https://api.yookassa.ru";
  process.env.YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID || "shop";
  process.env.YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY || "secret";
}

function makeTopup(overrides: Partial<any> = {}) {
  return {
    id: "76a2c557-8423-4291-b94c-eb475a1d67f0",
    organizationId: 77n,
    userId: 101n,
    status: "awaiting_payment",
    packagesCount: 2,
    tariffPerPackageKopecks: 150n,
    amountKopecks: 300n,
    currency: "RUB",
    provider: "yookassa",
    providerInvoiceId: "inv_1",
    providerInvoiceUrl: "https://pay.test/inv_1",
    providerPaymentId: null,
    providerStatus: "pending",
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
      balanceKopecks: 1000n,
      tariffPerPackageKopecks: 150n,
      userTarif: null,
      balance: null
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
    createInvoice: vi.fn(),
    getInvoice: vi.fn(),
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
      text: "Профиль пользователя:\n...",
      attachments: [{ type: "inline_keyboard", payload: { buttons: [[{ text: "Пополнить баланс", payload: "topup_balance" }]] } }]
    }))
  };

  vi.doMock("../../common/prisma", () => ({ prisma: mockPrisma }));
  vi.doMock("../bot/max-bot.client", () => ({ maxBotClient: mockBotClient }));
  vi.doMock("../bot/profile.service", () => mockProfileService);
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
    expect(mockYookassaClient.createInvoice).not.toHaveBeenCalled();
  });

  it("stores failed topup if YooKassa create invoice returns error", async () => {
    const { service, mockPrisma, mockYookassaClient, TestYookassaHttpError } = await loadService();

    mockPrisma.organizationTopup.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 101n,
      organizationId: 77n,
      userTarif: null,
      organization: {
        id: 77n,
        tariffPerPackageKopecks: 200n,
        userTarif: null,
        balanceKopecks: 1000n,
        balance: null
      }
    });

    mockPrisma.organizationTopup.create.mockResolvedValue(makeTopup({
      id: "0ec4ac2f-8242-46a9-8ed2-0684e5b2100d",
      amountKopecks: 400n,
      tariffPerPackageKopecks: 200n,
      packagesCount: 2
    }));

    mockYookassaClient.createInvoice.mockRejectedValue(
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

  it("keeps tariff snapshot for created topup", async () => {
    const { service, mockPrisma, mockYookassaClient } = await loadService();

    mockPrisma.organizationTopup.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 101n,
      organizationId: 77n,
      userTarif: null,
      organization: {
        id: 77n,
        tariffPerPackageKopecks: 150n,
        userTarif: null,
        balanceKopecks: 1000n,
        balance: null
      }
    });

    const createdTopup = makeTopup({
      id: "63bc55d5-d9da-42f7-b5db-07cb5170065f",
      packagesCount: 2,
      tariffPerPackageKopecks: 150n,
      amountKopecks: 300n
    });

    mockPrisma.organizationTopup.create.mockResolvedValue(createdTopup);
    mockYookassaClient.createInvoice.mockResolvedValue({
      id: "inv_1",
      status: "pending",
      delivery_method: {
        url: "https://pay.example/inv_1"
      },
      expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString()
    });

    mockPrisma.organizationTopup.update.mockResolvedValue(createdTopup);

    const result = await service.createOrReuseTopupForUser({ userIdRaw: "101", packagesCount: 2 });

    expect(result.topup.tariffPerPackageKopecks).toBe(150n);
    expect(result.topup.amountKopecks).toBe(300n);
  });

  it("throws ACTIVE_TOPUP_PENDING from backend guard", async () => {
    const { service, mockPrisma } = await loadService();

    mockPrisma.organizationTopup.findFirst.mockResolvedValue(
      makeTopup({
        providerInvoiceUrl: "https://pay.example/existing"
      })
    );

    await expect(service.assertNoActiveTopupForUser("101")).rejects.toMatchObject({
      code: "ACTIVE_TOPUP_PENDING"
    });
  });

  it("handles successful payment and sends success + profile messages", async () => {
    const { service, mockPrisma, mockBotClient } = await loadService();

    const topup = makeTopup({ amountKopecks: 500n });
    let topupStatus = "awaiting_payment";
    let balanceKopecks = 1000n;
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
                amount_kopecks: topup.amountKopecks
              }
            ];
          }
          return [
            {
              org_id: topup.organizationId,
              balance_kopecks: balanceKopecks
            }
          ];
        }),
        organization: {
          update: vi.fn(async ({ data }: any) => {
            balanceKopecks = data.balanceKopecks;
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

    await service.processPaymentSucceeded({
      payment: {
        id: "pay_1",
        status: "succeeded",
        paid: true,
        metadata: {
          topup_id: topup.id
        },
        amount: {
          value: "5.00",
          currency: "RUB"
        }
      },
      source: "webhook"
    });

    expect(ledgerCreates).toBe(1);
    expect(balanceKopecks).toBe(1500n);
    expect(mockBotClient.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("ignores duplicate payment.succeeded without double credit", async () => {
    const { service, mockPrisma, mockBotClient } = await loadService();

    const topup = makeTopup({ amountKopecks: 500n });
    let topupStatus = "awaiting_payment";
    let balanceKopecks = 1000n;
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
                amount_kopecks: topup.amountKopecks
              }
            ];
          }
          return [{ org_id: topup.organizationId, balance_kopecks: balanceKopecks }];
        }),
        organization: {
          update: vi.fn(async ({ data }: any) => {
            balanceKopecks = data.balanceKopecks;
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
        topup_id: topup.id
      },
      amount: {
        value: "5.00",
        currency: "RUB"
      }
    };

    await service.processPaymentSucceeded({ payment, source: "webhook" });
    await service.processPaymentSucceeded({ payment, source: "webhook" });

    expect(ledgerCreates).toBe(1);
    expect(balanceKopecks).toBe(1500n);
    expect(mockBotClient.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("is idempotent under concurrent finalization", async () => {
    const { service, mockPrisma } = await loadService();

    const topup = makeTopup({ amountKopecks: 700n });
    let topupStatus = "awaiting_payment";
    let balanceKopecks = 1000n;
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
                  amount_kopecks: topup.amountKopecks
                }
              ];
            }
            return [{ org_id: topup.organizationId, balance_kopecks: balanceKopecks }];
          }),
          organization: {
            update: vi.fn(async ({ data }: any) => {
              balanceKopecks = data.balanceKopecks;
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
    expect(balanceKopecks).toBe(1700n);
  });

  it("keeps topup active when payment is canceled but invoice is still pending", async () => {
    const { service, mockPrisma, mockYookassaClient, mockBotClient } = await loadService();

    const topup = makeTopup();
    mockPrisma.organizationTopup.findUnique.mockResolvedValue(topup);
    mockPrisma.organizationTopupPaymentAttempt.upsert.mockResolvedValue({ id: "attempt" });

    mockYookassaClient.getInvoice.mockResolvedValue({
      id: topup.providerInvoiceId,
      status: "pending",
      expires_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      payment_details: {
        id: "pay_1"
      }
    });

    mockPrisma.organizationTopup.update.mockResolvedValue({});

    await service.processPaymentCanceled({
      payment: {
        id: "pay_1",
        status: "canceled",
        metadata: {
          topup_id: topup.id
        },
        invoice_details: {
          id: topup.providerInvoiceId
        },
        cancellation_details: {
          party: "merchant",
          reason: "canceled_by_merchant"
        },
        amount: {
          value: "3.00",
          currency: "RUB"
        }
      },
      source: "webhook"
    });

    expect(mockPrisma.organizationTopup.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "awaiting_payment"
        })
      })
    );
    expect(mockBotClient.sendMessage).not.toHaveBeenCalled();
  });

  it("closes topup as expired when invoice has expired", async () => {
    const { service, mockPrisma, mockYookassaClient, mockBotClient } = await loadService();

    const topup = makeTopup();
    mockPrisma.organizationTopup.findUnique.mockResolvedValue(topup);
    mockPrisma.organizationTopupPaymentAttempt.upsert.mockResolvedValue({ id: "attempt" });

    mockYookassaClient.getInvoice.mockResolvedValue({
      id: topup.providerInvoiceId,
      status: "pending",
      expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
      payment_details: {
        id: "pay_1"
      }
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

    await service.processPaymentCanceled({
      payment: {
        id: "pay_1",
        status: "canceled",
        metadata: {
          topup_id: topup.id
        },
        invoice_details: {
          id: topup.providerInvoiceId
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
});
