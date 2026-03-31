import { z } from "zod";
import type { ReportClassification } from "./report-file-classifier";

const emailSchema = z.string().trim().email();

export interface OrganizationRecipient {
  id: bigint;
  name: string;
  email: string | null;
}

export interface RecipientResolverDeps {
  adminEmails: string[];
  findOrganizationById(id: bigint): Promise<OrganizationRecipient | null>;
}

export interface ResolvedRecipient {
  recipientType: "admin" | "organization";
  recipientEmail: string;
  recipientKey: string;
  organizationId: bigint | null;
  organizationName: string | null;
}

export type ResolveRecipientsResult =
  | {
      ok: true;
      recipients: ResolvedRecipient[];
    }
  | {
      ok: false;
      recipientType: "admin" | "organization";
      recipientKey: string;
      organizationId: bigint | null;
      organizationName: string | null;
      errorMessage: string;
    };

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function parseEmail(value: string) {
  const parsed = emailSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  return normalizeEmail(parsed.data);
}

export async function resolveReportRecipients(
  classification: ReportClassification,
  deps: RecipientResolverDeps
): Promise<ResolveRecipientsResult> {
  if (classification.kind === "admin") {
    if (!deps.adminEmails.length) {
      return {
        ok: false,
        recipientType: "admin",
        recipientKey: "admin:no-configured-emails",
        organizationId: null,
        organizationName: null,
        errorMessage: "Administrative emails are not configured"
      };
    }

    const recipients: ResolvedRecipient[] = [];
    for (const rawEmail of deps.adminEmails) {
      const parsed = parseEmail(rawEmail);
      if (!parsed) {
        return {
          ok: false,
          recipientType: "admin",
          recipientKey: `admin:invalid-email:${rawEmail}`,
          organizationId: null,
          organizationName: null,
          errorMessage: `Invalid admin email: ${rawEmail}`
        };
      }

      recipients.push({
        recipientType: "admin",
        recipientEmail: parsed,
        recipientKey: parsed,
        organizationId: null,
        organizationName: null
      });
    }

    return {
      ok: true,
      recipients
    };
  }

  const organization = await deps.findOrganizationById(classification.organizationId);
  if (!organization) {
    return {
      ok: false,
      recipientType: "organization",
      recipientKey: `organization:${classification.organizationId.toString()}:not-found`,
      organizationId: classification.organizationId,
      organizationName: null,
      errorMessage: `Organization not found: ${classification.organizationId.toString()}`
    };
  }

  const email = parseEmail(organization.email ?? "");
  if (!email) {
    return {
      ok: false,
      recipientType: "organization",
      recipientKey: `organization:${classification.organizationId.toString()}:missing-email`,
      organizationId: classification.organizationId,
      organizationName: organization.name,
      errorMessage: `Organization email is missing or invalid for org_id=${classification.organizationId.toString()}`
    };
  }

  return {
    ok: true,
    recipients: [
      {
        recipientType: "organization",
        recipientEmail: email,
        recipientKey: email,
        organizationId: classification.organizationId,
        organizationName: organization.name
      }
    ]
  };
}
