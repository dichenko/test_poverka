import { describe, expect, it } from "vitest";
import { classifyReportFileName } from "./report-file-classifier";

describe("classifyReportFileName", () => {
  it("classifies Arshin admin report", () => {
    const parsed = classifyReportFileName("Arshin_2026-03-31.xlsx");

    expect(parsed).toEqual({
      kind: "admin",
      reportType: "arshin",
      reportDate: "2026-03-31",
      fileName: "Arshin_2026-03-31.xlsx",
      organizationId: null
    });
  });

  it("classifies Balance Arshin admin report", () => {
    const parsed = classifyReportFileName("Balance_Arshin_2026-03-31.xlsx");

    expect(parsed).toEqual({
      kind: "admin",
      reportType: "balance_arshin",
      reportDate: "2026-03-31",
      fileName: "Balance_Arshin_2026-03-31.xlsx",
      organizationId: null
    });
  });

  it("classifies organization report and extracts org id/date", () => {
    const parsed = classifyReportFileName("Otchet_metrolog_17_31-03-2026.xlsx");

    expect(parsed).toEqual({
      kind: "organization",
      reportType: "org_metrolog",
      reportDate: "2026-03-31",
      fileName: "Otchet_metrolog_17_31-03-2026.xlsx",
      organizationId: 17n
    });
  });

  it("returns null for unknown file names", () => {
    expect(classifyReportFileName("daily_2026-03-31.xlsx")).toBeNull();
  });

  it("returns null for invalid calendar dates", () => {
    expect(classifyReportFileName("Arshin_2026-02-31.xlsx")).toBeNull();
    expect(classifyReportFileName("Otchet_metrolog_17_31-02-2026.xlsx")).toBeNull();
  });
});
