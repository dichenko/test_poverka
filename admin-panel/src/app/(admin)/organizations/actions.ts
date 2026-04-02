"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getReadableError } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth";
import { parseIdFromForm, parseOrganizationForm } from "@/lib/validators";

function routeWithMessage(path: string, status: "success" | "error", message: string) {
  return `${path}?status=${status}&message=${encodeURIComponent(message)}`;
}

function logAdminAction(actor: string, action: string, payload: Record<string, unknown>) {
  console.info("[admin-panel]", {
    actor,
    action,
    payload,
    timestamp: new Date().toISOString()
  });
}

export async function createOrganizationAction(formData: FormData) {
  const session = requireAdminSession();
  const prisma = getPrisma();

  try {
    const input = parseOrganizationForm(formData);
    const organization = await prisma.organization.create({
      data: {
        name: input.name,
        email: input.email,
        balance: input.balance,
        userTarif: input.userTarif,
        balanceStartOfDay: input.balanceStartOfDay
      }
    });

    logAdminAction(session.login, "organization.create", {
      organizationId: organization.id.toString()
    });

    revalidatePath("/organizations");
    revalidatePath("/users");
    redirect(routeWithMessage("/organizations", "success", "Organization created."));
  } catch (error) {
    const message = getReadableError(error, "Failed to create organization.");
    redirect(routeWithMessage("/organizations", "error", message));
  }
}

export async function updateOrganizationAction(formData: FormData) {
  const session = requireAdminSession();
  const prisma = getPrisma();

  try {
    const input = parseOrganizationForm(formData);
    if (!input.id) {
      redirect(routeWithMessage("/organizations", "error", "Organization id is required."));
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

    logAdminAction(session.login, "organization.update", {
      organizationId: organization.id.toString()
    });

    revalidatePath("/organizations");
    revalidatePath(`/organizations/${organization.id.toString()}/edit`);
    revalidatePath("/users");
    redirect(
      routeWithMessage(`/organizations/${organization.id.toString()}/edit`, "success", "Organization updated.")
    );
  } catch (error) {
    const id = String(formData.get("id") ?? "");
    const target = /^\d+$/.test(id) ? `/organizations/${id}/edit` : "/organizations";
    const message = getReadableError(error, "Failed to update organization.");
    redirect(routeWithMessage(target, "error", message));
  }
}

export async function deleteOrganizationAction(formData: FormData) {
  const session = requireAdminSession();
  const prisma = getPrisma();

  try {
    const organizationId = parseIdFromForm(formData, "id");
    await prisma.organization.delete({
      where: { id: organizationId }
    });

    logAdminAction(session.login, "organization.delete", {
      organizationId: organizationId.toString()
    });

    revalidatePath("/organizations");
    revalidatePath("/users");
    redirect(routeWithMessage("/organizations", "success", "Organization deleted."));
  } catch (error) {
    const message = getReadableError(error, "Failed to delete organization.");
    redirect(routeWithMessage("/organizations", "error", message));
  }
}
