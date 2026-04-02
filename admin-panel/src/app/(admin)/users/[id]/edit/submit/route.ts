import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getReadableError } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { readAdminSession } from "@/lib/session";
import { parseUserForm } from "@/lib/validators";

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

  const targetPath = `/users/${context.params.id}/edit`;
  if (!/^\d+$/.test(context.params.id)) {
    return redirectWithMessage(request, "/users", "error", "Invalid user id.");
  }

  const prisma = getPrisma();

  try {
    const formData = await request.formData();
    const input = parseUserForm(formData);
    const targetId = BigInt(context.params.id);

    if (!input.id || input.id !== targetId) {
      return redirectWithMessage(request, targetPath, "error", "Invalid user id.");
    }

    const user = await prisma.user.update({
      where: { id: input.id },
      data: {
        fullName: input.fullName,
        role: input.role,
        organizationId: input.organizationId,
        phone: input.phone,
        city: input.city,
        userTarif: input.userTarif,
        orgName: input.orgName,
        orgEmail: input.orgEmail
      }
    });

    console.info("[admin-panel]", {
      actor: session.login,
      action: "user.update",
      payload: { userId: user.id.toString() },
      timestamp: new Date().toISOString()
    });

    return redirectWithMessage(request, targetPath, "success", "User updated.");
  } catch (error) {
    const message = getReadableError(error, "Failed to update user.");
    return redirectWithMessage(request, targetPath, "error", message);
  }
}
