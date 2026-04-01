import { beforeEach, describe, expect, it, vi } from "vitest";

const lockState = {
  tryAcquire: vi.fn(async () => true),
  release: vi.fn(async () => undefined)
};

vi.mock("./report-execution-lock", () => ({
  ReportExecutionLock: class {
    async tryAcquire() {
      return lockState.tryAcquire();
    }

    async release() {
      return lockState.release();
    }
  }
}));

import { ReportsRunner } from "./reports-runner";
import type { ReportGenerator, ReportLogger } from "./report.types";

function createLogger(): ReportLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };
}

function createGeneratedReportsRepository() {
  return {
    markPending: vi.fn(async () => undefined),
    markSuccess: vi.fn(async () => undefined),
    markError: vi.fn(async () => undefined)
  };
}

function createReport(code: string, onGenerate?: () => Promise<void> | void): ReportGenerator {
  return {
    code,
    title: code,
    getFileName: (reportDate: string) => `${code}_${reportDate}.xlsx`,
    async generate(reportDate: string) {
      await onGenerate?.();
      return {
        fileName: `${code}_${reportDate}.xlsx`,
        absolutePath: `C:/tmp/reports/${code}/${code}_${reportDate}.xlsx`,
        publicUrl: `https://example.com/reports/${code}/${code}_${reportDate}.xlsx`,
        rowsCount: 10
      };
    }
  };
}

describe("ReportsRunner balance_start_of_day sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockState.tryAcquire.mockResolvedValue(true);
  });

  it("runs organizations balance sync only after full successful daily pipeline", async () => {
    const events: string[] = [];
    const logger = createLogger();
    const generatedReportsRepository = createGeneratedReportsRepository();
    const organizationsBalanceStartOfDaySyncRepository = {
      syncFromCurrentBalance: vi.fn(async () => {
        events.push("sync");
        return 3;
      })
    };

    const reports = [
      createReport("arshin", () => events.push("arshin")),
      createReport("balance_arshin", () => events.push("balance_arshin")),
      createReport("org_metrolog", () => events.push("org_metrolog"))
    ];

    const runner = new ReportsRunner({
      databaseUrl: "postgres://test",
      lockId: 1n,
      reports,
      generatedReportsRepository: generatedReportsRepository as any,
      organizationsBalanceStartOfDaySyncRepository: organizationsBalanceStartOfDaySyncRepository as any,
      logger,
      reportsStorageDir: "C:/tmp/reports",
      reportsPublicBaseUrl: "https://example.com/reports"
    });

    const result = await runner.run({
      date: "2026-04-01",
      trigger: "cron"
    });

    expect(result.items.every((item) => item.status === "success")).toBe(true);
    expect(events).toEqual(["arshin", "balance_arshin", "org_metrolog", "sync"]);
    expect(organizationsBalanceStartOfDaySyncRepository.syncFromCurrentBalance).toHaveBeenCalledTimes(1);
  });

  it("does not run organizations balance sync for partial report runs", async () => {
    const logger = createLogger();
    const generatedReportsRepository = createGeneratedReportsRepository();
    const organizationsBalanceStartOfDaySyncRepository = {
      syncFromCurrentBalance: vi.fn(async () => 1)
    };

    const runner = new ReportsRunner({
      databaseUrl: "postgres://test",
      lockId: 1n,
      reports: [createReport("arshin")],
      generatedReportsRepository: generatedReportsRepository as any,
      organizationsBalanceStartOfDaySyncRepository: organizationsBalanceStartOfDaySyncRepository as any,
      logger,
      reportsStorageDir: "C:/tmp/reports",
      reportsPublicBaseUrl: "https://example.com/reports"
    });

    const result = await runner.run({
      date: "2026-04-01",
      trigger: "manual-http",
      reportCode: "arshin"
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.status).toBe("success");
    expect(organizationsBalanceStartOfDaySyncRepository.syncFromCurrentBalance).not.toHaveBeenCalled();
  });

  it("skips organizations balance sync when at least one report failed", async () => {
    const logger = createLogger();
    const generatedReportsRepository = createGeneratedReportsRepository();
    const organizationsBalanceStartOfDaySyncRepository = {
      syncFromCurrentBalance: vi.fn(async () => 2)
    };

    const runner = new ReportsRunner({
      databaseUrl: "postgres://test",
      lockId: 1n,
      reports: [
        createReport("arshin"),
        createReport("balance_arshin", () => {
          throw new Error("generation failed");
        }),
        createReport("org_metrolog")
      ],
      generatedReportsRepository: generatedReportsRepository as any,
      organizationsBalanceStartOfDaySyncRepository: organizationsBalanceStartOfDaySyncRepository as any,
      logger,
      reportsStorageDir: "C:/tmp/reports",
      reportsPublicBaseUrl: "https://example.com/reports"
    });

    const result = await runner.run({
      date: "2026-04-01",
      trigger: "cron"
    });

    expect(result.items.some((item) => item.status === "error")).toBe(true);
    expect(organizationsBalanceStartOfDaySyncRepository.syncFromCurrentBalance).not.toHaveBeenCalled();
    expect((logger.warn as any).mock.calls.some((call: unknown[]) => String(call[1]).includes("Skipping organizations.balance_start_of_day sync"))).toBe(true);
  });

  it("marks run as failed when final organizations balance sync fails", async () => {
    const logger = createLogger();
    const generatedReportsRepository = createGeneratedReportsRepository();
    const organizationsBalanceStartOfDaySyncRepository = {
      syncFromCurrentBalance: vi.fn(async () => {
        throw new Error("sync failed");
      })
    };

    const runner = new ReportsRunner({
      databaseUrl: "postgres://test",
      lockId: 1n,
      reports: [createReport("arshin"), createReport("balance_arshin"), createReport("org_metrolog")],
      generatedReportsRepository: generatedReportsRepository as any,
      organizationsBalanceStartOfDaySyncRepository: organizationsBalanceStartOfDaySyncRepository as any,
      logger,
      reportsStorageDir: "C:/tmp/reports",
      reportsPublicBaseUrl: "https://example.com/reports"
    });

    const result = await runner.run({
      date: "2026-04-01",
      trigger: "cron"
    });

    const syncItem = result.items.find((item) => item.reportCode === "balance_start_of_day_sync");
    expect(syncItem?.status).toBe("error");
    expect(syncItem?.errorText).toContain("sync failed");
  });
});
