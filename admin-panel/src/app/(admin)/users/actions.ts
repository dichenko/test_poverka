"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { getReadableError } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { parseIdFromForm, parseUserForm } from "@/lib/validators";

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

export async function createUserAction(formData: FormData) {
  const session = requireAdminSession();
  const prisma = getPrisma();

  try {
    const input = parseUserForm(formData);
    let userTarif = input.userTarif;
    let orgName = input.orgName;
    let orgEmail = input.orgEmail;

    if (input.organizationId) {
      const organization = await prisma.organization.findUnique({
        where: { id: input.organizationId },
        select: {
          name: true,
          email: true,
          userTarif: true
        }
      });

      if (!organization) {
        redirect(routeWithMessage("/users", "error", "Selected organization was not found."));
      }

      const organizationTarif = Number(organization.userTarif);
      if (!Number.isFinite(organizationTarif)) {
        redirect(routeWithMessage("/users", "error", "Organization tariff is invalid."));
      }

      userTarif = organizationTarif;
      orgName = organization.name;
      orgEmail = organization.email;
    }

    const user = await prisma.user.create({
      data: {
        fullName: input.fullName,
        role: input.role,
        organizationId: input.organizationId,
        phone: input.phone,
        city: input.city,
        userTarif,
        orgName,
        orgEmail
      }
    });

    logAdminAction(session.login, "user.create", {
      userId: user.id.toString()
    });

    revalidatePath("/users");
    redirect(routeWithMessage("/users", "success", "User created."));
  } catch (error) {
    const message = getReadableError(error, "Failed to create user.");
    redirect(routeWithMessage("/users", "error", message));
  }
}

export async function updateUserAction(formData: FormData) {
  const session = requireAdminSession();
  const prisma = getPrisma();

  try {
    const input = parseUserForm(formData);
    if (!input.id) {
      redirect(routeWithMessage("/users", "error", "User id is required."));
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

    logAdminAction(session.login, "user.update", {
      userId: user.id.toString()
    });

    revalidatePath("/users");
    revalidatePath(`/users/${user.id.toString()}/edit`);
    redirect(routeWithMessage(`/users/${user.id.toString()}/edit`, "success", "User updated."));
  } catch (error) {
    const id = String(formData.get("id") ?? "");
    const target = /^\d+$/.test(id) ? `/users/${id}/edit` : "/users";
    const message = getReadableError(error, "Failed to update user.");
    redirect(routeWithMessage(target, "error", message));
  }
}

export async function deleteUserAction(formData: FormData) {
  const session = requireAdminSession();
  const prisma = getPrisma();

  try {
    const userId = parseIdFromForm(formData, "id");
    await prisma.user.delete({
      where: { id: userId }
    });

    logAdminAction(session.login, "user.delete", {
      userId: userId.toString()
    });

    revalidatePath("/users");
    redirect(routeWithMessage("/users", "success", "User deleted."));
  } catch (error) {
    const message = getReadableError(error, "Failed to delete user.");
    redirect(routeWithMessage("/users", "error", message));
  }
}
