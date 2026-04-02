import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getReadableError } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { readAdminSession } from "@/lib/session";
import { parseOrganizationForm } from "@/lib/validators";

function redirectWithMessage(request: Request, path: string, status: "success" | "error", message: string) {
  const baseUrl = getEnv().ADMIN_PANEL_PUBLIC_URL;
  const url = new URL(path, baseUrl);
  url.searchParams.set("status", status);
  url.searchParams.set("message", message);
  return NextResponse.redirect(url);
}

export async function POST(
  request: Request,
  context: {
    params: { id: string };
  }
) {
  const session = readAdminSession();
  if (!session) {
    return NextResponse.redirect(new URL("/login", getEnv().ADMIN_PANEL_PUBLIC_URL));
  }

  const targetPath = `/organizations/${context.params.id}/edit`;
  if (!/^\d+$/.test(context.params.id)) {
    return redirectWithMessage(request, "/organizations", "error", "Invalid organization id.");
  }

  const prisma = getPrisma();

  try {
    const formData = await request.formData();
    const input = parseOrganizationForm(formData);
    const targetId = BigInt(context.params.id);

    if (!input.id || input.id !== targetId) {
      return redirectWithMessage(request, targetPath, "error", "Invalid organization id.");
    }

    const organization = await prisma.organization.update({
      where: { id: input.id },
      data: {
        name: input.name,
        email: input.email,
        balance: input.balance,
        userTarif: input.userTarif,
        balanceStartOfDay: input.balanceStartOfDay
      }
    });

    console.info("[admin-panel]", {
      actor: session.login,
      action: "organization.update",
      payload: { organizationId: organization.id.toString() },
      timestamp: new Date().toISOString()
    });

    return redirectWithMessage(request, targetPath, "success", "Organization updated.");
  } catch (error) {
    const message = getReadableError(error, "Failed to update organization.");
    return redirectWithMessage(request, targetPath, "error", message);
  }
}
