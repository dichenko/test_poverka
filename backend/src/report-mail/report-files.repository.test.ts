import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function createGeneratedReportRow(input: { publicToken: string | null; publicUrl: string }) {
  return {
    id: 1n,
    reportCode: "arshin",
    reportDate: new Date("2026-04-08T00:00:00.000Z"),
    organizationId: null,
    fileName: "Arshin_2026-04-08.xlsx",
    filePath: "/app/storage/reports/arshin/Arshin_2026-04-08.xlsx",
    publicToken: input.publicToken,
    publicUrl: input.publicUrl
  };
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("ReportFilesRepository", () => {
  it("uses stored publicUrl when base URL env is not configured", async () => {
    delete process.env.REPORTS_PUBLIC_BASE_URL;
    delete process.env.PUBLIC_FILES_BASE_URL;
    delete process.env.BACKEND_PUBLIC_URL;

    const row = createGeneratedReportRow({
      publicToken: "token_123",
      publicUrl: "https://stored.example/reports/token_123"
    });

    const prisma = {
      generatedReport: {
        findMany: vi.fn().mockResolvedValue([row]),
        findFirst: vi.fn()
      }
    } as unknown as PrismaClient;

    const { ReportFilesRepository } = await import("./report-files.repository");
    const repository = new ReportFilesRepository(prisma);
    const result = await repository.listSuccessfulByDate("2026-04-08");

    expect(result).toHaveLength(1);
    expect(result[0]?.publicUrl).toBe("https://stored.example/reports/token_123");
  });

  it("builds token URL from REPORTS_PUBLIC_BASE_URL when configured", async () => {
    process.env.REPORTS_PUBLIC_BASE_URL = "https://api.example.com/public/reports/";

    const row = createGeneratedReportRow({
      publicToken: "token_abc",
      publicUrl: "https://legacy.example/reports/old-link"
    });

    const prisma = {
      generatedReport: {
        findMany: vi.fn().mockResolvedValue([row]),
        findFirst: vi.fn()
      }
    } as unknown as PrismaClient;

    const { ReportFilesRepository } = await import("./report-files.repository");
    const repository = new ReportFilesRepository(prisma);
    const result = await repository.listSuccessfulByDate("2026-04-08");

    expect(result).toHaveLength(1);
    expect(result[0]?.publicUrl).toBe("https://api.example.com/public/reports/token_abc");
  });
});
