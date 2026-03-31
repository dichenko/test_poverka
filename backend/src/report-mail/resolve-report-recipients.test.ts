import { describe, expect, it, vi } from "vitest";
import { resolveReportRecipients } from "./resolve-report-recipients";

describe("resolveReportRecipients", () => {
  it("returns all admin recipients for admin reports", async () => {
    const result = await resolveReportRecipients(
      {
        kind: "admin",
        reportType: "arshin",
        reportDate: "2026-03-31",
        fileName: "Arshin_2026-03-31.xlsx",
        organizationId: null
      },
      {
        adminEmails: ["admin1@example.com", "admin2@example.com"],
        findOrganizationById: vi.fn()
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipients).toHaveLength(2);
      expect(result.recipients.map((item) => item.recipientEmail)).toEqual([
        "admin1@example.com",
        "admin2@example.com"
      ]);
    }
  });

  it("returns managed error when organization is missing", async () => {
    const result = await resolveReportRecipients(
      {
        kind: "organization",
        reportType: "org_metrolog",
        reportDate: "2026-03-31",
        fileName: "Otchet_metrolog_9_31-03-2026.xlsx",
        organizationId: 9n
      },
      {
        adminEmails: [],
        findOrganizationById: vi.fn(async () => null)
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.recipientType).toBe("organization");
      expect(result.errorMessage).toContain("Organization not found");
    }
  });

  it("returns managed error when organization email is empty", async () => {
    const result = await resolveReportRecipients(
      {
        kind: "organization",
        reportType: "org_metrolog",
        reportDate: "2026-03-31",
        fileName: "Otchet_metrolog_9_31-03-2026.xlsx",
        organizationId: 9n
      },
      {
        adminEmails: [],
        findOrganizationById: vi.fn(async () => ({
          id: 9n,
          name: "Org 9",
          email: null
        }))
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorMessage).toContain("missing or invalid");
      expect(result.recipientKey).toBe("organization:9:missing-email");
    }
  });

  it("resolves organization recipient email", async () => {
    const result = await resolveReportRecipients(
      {
        kind: "organization",
        reportType: "org_metrolog",
        reportDate: "2026-03-31",
        fileName: "Otchet_metrolog_9_31-03-2026.xlsx",
        organizationId: 9n
      },
      {
        adminEmails: [],
        findOrganizationById: vi.fn(async () => ({
          id: 9n,
          name: "Org 9",
          email: "MAIL@EXAMPLE.COM"
        }))
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipients).toEqual([
        {
          recipientType: "organization",
          recipientEmail: "mail@example.com",
          recipientKey: "mail@example.com",
          organizationId: 9n,
          organizationName: "Org 9"
        }
      ]);
    }
  });
});
