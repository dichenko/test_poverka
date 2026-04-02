import { AuditEntityType, UserRole } from "@prisma/client";
import type { Request } from "express";
import { logger } from "../../common/logger";
import { prisma } from "../../common/prisma";
import { env } from "../../config/env";
import { assertValidReportDate, resolveReportDate } from "../../report-worker/date.utils";
import { createReportMailService } from "../../report-mail/create-report-mail-service";
import { logAuditEvent } from "../../services/audit.service";
import { MAX_ADMIN_HELP_TEXT } from "./admin-help-text";
import { maxBotClient } from "./max-bot.client";

const ACCESS_DENIED_TEXT = "У тебя нет доступа к этой команде.";
const UNKNOWN_COMMAND_TEXT = "Неизвестная команда.\nНапиши /start, чтобы посмотреть список команд.";

const ADD_FORMAT_ERROR_TEXT = "Неверный формат команды.\nИспользуй: /add [org_id] [amount]\nПример: /add 1 200";
const WITHDRAW_FORMAT_ERROR_TEXT =
  "Неверный формат команды.\nИспользуй: /withdraw [org_id] [amount]\nПример: /withdraw 1 200";
const ADD_ADMIN_FORMAT_ERROR_TEXT =
  "Неверный формат команды.\nИспользуй: /add_admin [max_user_id]\nПример: /add_admin 382159692";
const REPORT_DATA_FORMAT_ERROR_TEXT =
  "Неверный формат команды.\nИспользуй: /report_data DD/MM/YYYY\nПример: /report_data 01/04/2026";
const INVALID_AMOUNT_TEXT = "Сумма должна быть положительным числом.";

type AdminCommand = "/add" | "/withdraw" | "/add_admin" | "/report_admin" | "/report_buh" | "/report_data";
const { service: reportMailService } = createReportMailService({ prisma, logger });

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function parseTokens(raw: string) {
  const normalized = normalizeText(raw);
  if (!normalized) {
    return [] as string[];
  }
  return normalized.split(" ");
}

function parsePositiveBigInt(value: string): bigint | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  try {
    const parsed = BigInt(normalized);
    if (parsed <= 0n) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parsePositiveInt(value: string): bigint | null {
  return parsePositiveBigInt(value);
}

function isMenuCommand(value: string) {
  const normalized = normalizeText(value).toLowerCase();
  return (
    normalized === "/start" ||
    normalized === "start" ||
    normalized === "меню" ||
    normalized === "help" ||
    normalized === "помощь"
  );
}

function pickCommandToken(text: string) {
  const [token] = parseTokens(text);
  return (token || "").toLowerCase();
}

const adminCommandTokens = new Set<AdminCommand>([
  "/add",
  "/withdraw",
  "/add_admin",
  "/report_admin",
  "/report_buh",
  "/report_data"
]);

export function isAdminCommandText(text: string) {
  return adminCommandTokens.has(pickCommandToken(text) as AdminCommand);
}

function parseReportDateInput(value: string): string | null {
  const normalized = value.trim();
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(normalized);
  if (!match) {
    return null;
  }

  const [, day, month, year] = match;
  const reportDate = `${year}-${month}-${day}`;
  try {
    assertValidReportDate(reportDate);
    return reportDate;
  } catch {
    return null;
  }
}

function formatIsoReportDateToRu(value: string): string {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) {
    return value;
  }
  return `${day}/${month}/${year}`;
}

async function writeAdminActionLog(input: {
  adminUserId: bigint;
  command: string;
  success: boolean;
  req: Request;
  meta?: Record<string, unknown>;
  entityType?: AuditEntityType;
  entityId?: string | null;
  errorText?: string;
}) {
  const baseMeta = {
    admin_max_user_id: input.adminUserId.toString(),
    command: input.command,
    success: input.success,
    error: input.errorText ?? null,
    ...(input.meta ?? {})
  };

  logger.info(baseMeta, "MAX admin command processed");

  await logAuditEvent({
    actorUserId: input.adminUserId,
    action: `bot.admin.${input.command}.${input.success ? "success" : "fail"}`,
    entityType: input.entityType ?? "SYSTEM",
    entityId: input.entityId ?? null,
    meta: baseMeta,
    req: input.req
  });
}

async function sendAdminHelp(userIdText: string) {
  await maxBotClient.sendMessage({
    userId: userIdText,
    text: MAX_ADMIN_HELP_TEXT
  });
}

async function isFirstAdminMessage(adminUserId: bigint) {
  const existing = await prisma.auditLog.findFirst({
    where: {
      actorUserId: adminUserId,
      action: {
        startsWith: "bot.admin."
      }
    },
    select: { id: true }
  });

  return !existing;
}

async function addBalance(input: {
  adminUserId: bigint;
  userIdText: string;
  orgId: bigint;
  amount: bigint;
  req: Request;
}) {
  const sourceId = `max_admin_add:${input.adminUserId.toString()}:${Date.now()}`;
  const result = await prisma.$transaction(async (tx) => {
    const organizations = await tx.$queryRaw<Array<{ org_id: bigint; balance: bigint; org_name: string }>>`
      SELECT org_id, balance, org_name FROM organizations WHERE org_id = ${input.orgId} FOR UPDATE
    `;
    const organization = organizations[0];
    if (!organization) {
      return { ok: false as const };
    }

    const balanceBefore = BigInt(organization.balance);
    const balanceAfter = balanceBefore + input.amount;

    await tx.organization.update({
      where: { id: input.orgId },
      data: { balance: balanceAfter }
    });

    await tx.organizationBalanceTransaction.create({
      data: {
        organizationId: input.orgId,
        direction: "credit",
        amountRubles: input.amount,
        balanceBeforeRubles: balanceBefore,
        balanceAfterRubles: balanceAfter,
        sourceType: "admin_add",
        sourceId,
        createdByUserId: input.adminUserId,
        comment: "MAX admin /add"
      }
    });

    return { ok: true as const, balanceAfter, organizationName: organization.org_name };
  });

  if (!result.ok) {
    await maxBotClient.sendMessage({
      userId: input.userIdText,
      text: `Организация с id ${input.orgId.toString()} не найдена.`
    });
    await writeAdminActionLog({
      adminUserId: input.adminUserId,
      command: "add",
      success: false,
      req: input.req,
      meta: {
        org_id: input.orgId.toString(),
        amount: input.amount.toString()
      },
      entityType: "ORGANIZATION",
      entityId: input.orgId.toString(),
      errorText: "ORG_NOT_FOUND"
    });
    return;
  }

  await maxBotClient.sendMessage({
    userId: input.userIdText,
    text: `Баланс организации ${input.orgId.toString()} (${result.organizationName}) увеличен на ${input.amount.toString()}.\nНовый баланс: ${result.balanceAfter.toString()}.`
  });

  await writeAdminActionLog({
    adminUserId: input.adminUserId,
    command: "add",
    success: true,
    req: input.req,
    meta: {
      org_id: input.orgId.toString(),
      amount: input.amount.toString(),
      new_balance: result.balanceAfter.toString()
    },
    entityType: "ORGANIZATION",
    entityId: input.orgId.toString()
  });
}

async function withdrawBalance(input: {
  adminUserId: bigint;
  userIdText: string;
  orgId: bigint;
  amount: bigint;
  req: Request;
}) {
  const sourceId = `max_admin_withdraw:${input.adminUserId.toString()}:${Date.now()}`;
  const result = await prisma.$transaction(async (tx) => {
    const organizations = await tx.$queryRaw<Array<{ org_id: bigint; balance: bigint; org_name: string }>>`
      SELECT org_id, balance, org_name FROM organizations WHERE org_id = ${input.orgId} FOR UPDATE
    `;
    const organization = organizations[0];
    if (!organization) {
      return { ok: false as const, reason: "ORG_NOT_FOUND" as const };
    }

    const balanceBefore = BigInt(organization.balance);
    if (balanceBefore < input.amount) {
      return {
        ok: false as const,
        reason: "INSUFFICIENT_BALANCE" as const,
        currentBalance: balanceBefore
      };
    }

    const balanceAfter = balanceBefore - input.amount;

    await tx.organization.update({
      where: { id: input.orgId },
      data: { balance: balanceAfter }
    });

    await tx.organizationBalanceTransaction.create({
      data: {
        organizationId: input.orgId,
        direction: "debit",
        amountRubles: input.amount,
        balanceBeforeRubles: balanceBefore,
        balanceAfterRubles: balanceAfter,
        sourceType: "admin_withdraw",
        sourceId,
        createdByUserId: input.adminUserId,
        comment: "MAX admin /withdraw"
      }
    });

    return { ok: true as const, balanceAfter, organizationName: organization.org_name };
  });

  if (!result.ok && result.reason === "ORG_NOT_FOUND") {
    await maxBotClient.sendMessage({
      userId: input.userIdText,
      text: `Организация с id ${input.orgId.toString()} не найдена.`
    });
    await writeAdminActionLog({
      adminUserId: input.adminUserId,
      command: "withdraw",
      success: false,
      req: input.req,
      meta: {
        org_id: input.orgId.toString(),
        amount: input.amount.toString()
      },
      entityType: "ORGANIZATION",
      entityId: input.orgId.toString(),
      errorText: "ORG_NOT_FOUND"
    });
    return;
  }

  if (!result.ok && result.reason === "INSUFFICIENT_BALANCE") {
    await maxBotClient.sendMessage({
      userId: input.userIdText,
      text: `Недостаточно средств на балансе организации ${input.orgId.toString()}.\nТекущий баланс: ${result.currentBalance.toString()}.`
    });
    await writeAdminActionLog({
      adminUserId: input.adminUserId,
      command: "withdraw",
      success: false,
      req: input.req,
      meta: {
        org_id: input.orgId.toString(),
        amount: input.amount.toString(),
        current_balance: result.currentBalance.toString()
      },
      entityType: "ORGANIZATION",
      entityId: input.orgId.toString(),
      errorText: "INSUFFICIENT_BALANCE"
    });
    return;
  }

  await maxBotClient.sendMessage({
    userId: input.userIdText,
    text: `С баланса организации ${input.orgId.toString()} (${result.organizationName}) списано ${input.amount.toString()}.\nНовый баланс: ${result.balanceAfter.toString()}.`
  });

  await writeAdminActionLog({
    adminUserId: input.adminUserId,
    command: "withdraw",
    success: true,
    req: input.req,
    meta: {
      org_id: input.orgId.toString(),
      amount: input.amount.toString(),
      new_balance: result.balanceAfter.toString()
    },
    entityType: "ORGANIZATION",
    entityId: input.orgId.toString()
  });
}

async function addAdmin(input: {
  adminUserId: bigint;
  userIdText: string;
  targetMaxUserId: bigint;
  req: Request;
}) {
  const target = await prisma.user.findUnique({
    where: { id: input.targetMaxUserId },
    select: { id: true, role: true }
  });

  if (!target) {
    await maxBotClient.sendMessage({
      userId: input.userIdText,
      text: `Пользователь с MAX ID ${input.targetMaxUserId.toString()} не найден в базе.`
    });
    await writeAdminActionLog({
      adminUserId: input.adminUserId,
      command: "add_admin",
      success: false,
      req: input.req,
      meta: {
        target_max_user_id: input.targetMaxUserId.toString()
      },
      entityType: "USER",
      entityId: input.targetMaxUserId.toString(),
      errorText: "USER_NOT_FOUND"
    });
    return;
  }

  if (target.role !== UserRole.ADMIN) {
    await prisma.user.update({
      where: { id: target.id },
      data: { role: UserRole.ADMIN }
    });
  }

  await maxBotClient.sendMessage({
    userId: input.userIdText,
    text: `Пользователь с MAX ID ${input.targetMaxUserId.toString()} назначен администратором.`
  });

  await writeAdminActionLog({
    adminUserId: input.adminUserId,
    command: "add_admin",
    success: true,
    req: input.req,
    meta: {
      target_max_user_id: input.targetMaxUserId.toString()
    },
    entityType: "USER",
    entityId: input.targetMaxUserId.toString()
  });
}

async function runReportByCode(reportCode: "arshin" | "balance_arshin") {
  const endpoint = new URL("/internal/reports/run", env.REPORT_WORKER_INTERNAL_BASE_URL);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": env.INTERNAL_API_TOKEN
    },
    body: JSON.stringify({ reportCode })
  });

  const payload = (await response.json().catch(() => ({}))) as any;
  const result = payload?.result;

  if (!response.ok || !payload?.ok || !result?.lockAcquired) {
    throw new Error("REPORT_RUN_FAILED");
  }

  const reportDate = resolveReportDate(undefined, env.REPORTS_TZ);
  const generated = await prisma.generatedReport.findFirst({
    where: {
      reportCode,
      reportDate: new Date(`${reportDate}T00:00:00.000Z`),
      status: "SUCCESS",
      organizationId: null
    },
    orderBy: { finishedAt: "desc" }
  });

  if (!generated || !generated.publicUrl) {
    throw new Error("REPORT_FILE_NOT_FOUND");
  }

  return {
    reportDate,
    fileName: generated.fileName,
    filePath: generated.filePath,
    publicUrl: generated.publicUrl
  };
}

async function sendGeneratedReportToAdminEmails(input: {
  adminUserId: bigint;
  reportDate: string;
  fileName: string;
  filePath: string;
  reportCode: "arshin" | "balance_arshin";
  force?: boolean;
}) {
  try {
    const mailResult = await reportMailService.sendOne({
      reportDate: input.reportDate,
      fileName: input.fileName,
      filePath: input.filePath,
      force: input.force ?? false,
      requestedBy: `max-bot-admin:${input.adminUserId.toString()}`
    });

    logger.info(
      {
        reportCode: input.reportCode,
        reportDate: input.reportDate,
        fileName: input.fileName,
        runId: mailResult.runId.toString(),
        totalDeliveries: mailResult.totalDeliveries,
        sentCount: mailResult.sentCount,
        failedCount: mailResult.failedCount
      },
      "Admin report email run completed"
    );

    return {
      ok: true as const,
      ...mailResult
    };
  } catch (error) {
    logger.error(
      {
        err: error,
        reportCode: input.reportCode,
        reportDate: input.reportDate,
        fileName: input.fileName
      },
      "Failed to send admin report to email recipients"
    );

    return {
      ok: false as const,
      errorText: error instanceof Error ? error.message : String(error)
    };
  }
}

async function handleAdminReport(input: {
  adminUserId: bigint;
  userIdText: string;
  req: Request;
  reportCode: "arshin" | "balance_arshin";
  doneText: string;
  command: "report_admin" | "report_buh";
}) {
  await maxBotClient.sendMessage({
    userId: input.userIdText,
    text: "Формирую отчет, подожди..."
  });

  try {
    const report = await runReportByCode(input.reportCode);
    await maxBotClient.sendMessage({
      userId: input.userIdText,
      text: input.doneText
    });
    await maxBotClient.sendMessage({
      userId: input.userIdText,
      text: `Файл отчета: ${report.fileName}\n${report.publicUrl}`
    });

    const mailResult = await sendGeneratedReportToAdminEmails({
      adminUserId: input.adminUserId,
      reportDate: report.reportDate,
      fileName: report.fileName,
      filePath: report.filePath,
      reportCode: input.reportCode,
      force: true
    });

    if (mailResult.ok && mailResult.sentCount > 0) {
      await maxBotClient.sendMessage({
        userId: input.userIdText,
        text: "Отчет отправлен на почту администраторов."
      });
    } else if (!mailResult.ok) {
      await maxBotClient.sendMessage({
        userId: input.userIdText,
        text: "Отчет в чат отправлен, но отправка на почту администраторов не удалась."
      });
    }

    await writeAdminActionLog({
      adminUserId: input.adminUserId,
      command: input.command,
      success: true,
      req: input.req,
      meta: {
        report_code: input.reportCode,
        file_name: report.fileName,
        report_date: report.reportDate,
        public_url: report.publicUrl,
        mail_sent: mailResult.ok ? mailResult.sentCount : 0,
        mail_failed: mailResult.ok ? mailResult.failedCount : null,
        mail_error: mailResult.ok ? null : mailResult.errorText
      }
    });
  } catch (error) {
    await maxBotClient.sendMessage({
      userId: input.userIdText,
      text: "Не удалось сформировать отчет. Попробуй позже."
    });
    await writeAdminActionLog({
      adminUserId: input.adminUserId,
      command: input.command,
      success: false,
      req: input.req,
      meta: {
        report_code: input.reportCode
      },
      errorText: error instanceof Error ? error.message : String(error)
    });
  }
}

async function findAdminReportsByDate(reportDate: string) {
  const reports = await prisma.generatedReport.findMany({
    where: {
      reportDate: new Date(`${reportDate}T00:00:00.000Z`),
      reportCode: {
        in: ["arshin", "balance_arshin"]
      },
      status: "SUCCESS",
      organizationId: null
    },
    orderBy: [
      { reportCode: "asc" },
      { finishedAt: "desc" }
    ]
  });

  const byCode = new Map<string, (typeof reports)[number]>();
  for (const report of reports) {
    if (!byCode.has(report.reportCode)) {
      byCode.set(report.reportCode, report);
    }
  }

  return {
    arshin: byCode.get("arshin") ?? null,
    balanceArshin: byCode.get("balance_arshin") ?? null
  };
}

async function handleAdminReportByDate(input: {
  adminUserId: bigint;
  userIdText: string;
  req: Request;
  reportDate: string;
}) {
  const reportDateRu = formatIsoReportDateToRu(input.reportDate);

  await maxBotClient.sendMessage({
    userId: input.userIdText,
    text: `Ищу отчеты за ${reportDateRu}...`
  });

  try {
    const reports = await findAdminReportsByDate(input.reportDate);
    const arshinReport = reports.arshin;
    const balanceArshinReport = reports.balanceArshin;
    const missingCodes: string[] = [];
    if (!arshinReport) {
      missingCodes.push("Arshin");
    }
    if (!balanceArshinReport) {
      missingCodes.push("Balance_Arshin");
    }

    if (missingCodes.length > 0) {
      await maxBotClient.sendMessage({
        userId: input.userIdText,
        text: `Не найдены отчеты за ${reportDateRu}: ${missingCodes.join(", ")}.`
      });

      await writeAdminActionLog({
        adminUserId: input.adminUserId,
        command: "report_data",
        success: false,
        req: input.req,
        meta: {
          report_date: input.reportDate,
          missing_reports: missingCodes
        },
        errorText: "REPORT_FILES_NOT_FOUND"
      });
      return;
    }

    if (!arshinReport || !balanceArshinReport) {
      return;
    }

    await maxBotClient.sendMessage({
      userId: input.userIdText,
      text:
        `Отчеты за ${reportDateRu}:\n` +
        `Arshin: ${arshinReport.fileName}\n${arshinReport.publicUrl}\n\n` +
        `Balance_Arshin: ${balanceArshinReport.fileName}\n${balanceArshinReport.publicUrl}`
    });

    const mailArshin = await sendGeneratedReportToAdminEmails({
      adminUserId: input.adminUserId,
      reportDate: input.reportDate,
      fileName: arshinReport.fileName,
      filePath: arshinReport.filePath,
      reportCode: "arshin"
    });

    const mailBalance = await sendGeneratedReportToAdminEmails({
      adminUserId: input.adminUserId,
      reportDate: input.reportDate,
      fileName: balanceArshinReport.fileName,
      filePath: balanceArshinReport.filePath,
      reportCode: "balance_arshin"
    });

    const mailFailed = !mailArshin.ok || !mailBalance.ok;
    if (!mailFailed) {
      await maxBotClient.sendMessage({
        userId: input.userIdText,
        text: "Оба отчета отправлены на почту администраторов."
      });
    } else if (mailFailed) {
      await maxBotClient.sendMessage({
        userId: input.userIdText,
        text: "Ссылки на отчеты отправлены, но отправка на почту выполнена с ошибкой."
      });
    }

    await writeAdminActionLog({
      adminUserId: input.adminUserId,
      command: "report_data",
      success: true,
      req: input.req,
      meta: {
        report_date: input.reportDate,
        arshin_file_name: arshinReport.fileName,
        arshin_public_url: arshinReport.publicUrl,
        balance_file_name: balanceArshinReport.fileName,
        balance_public_url: balanceArshinReport.publicUrl,
        arshin_mail_sent: mailArshin.ok ? mailArshin.sentCount : 0,
        arshin_mail_failed: mailArshin.ok ? mailArshin.failedCount : null,
        arshin_mail_error: mailArshin.ok ? null : mailArshin.errorText,
        balance_mail_sent: mailBalance.ok ? mailBalance.sentCount : 0,
        balance_mail_failed: mailBalance.ok ? mailBalance.failedCount : null,
        balance_mail_error: mailBalance.ok ? null : mailBalance.errorText
      }
    });
  } catch (error) {
    await maxBotClient.sendMessage({
      userId: input.userIdText,
      text: "Не удалось обработать команду /report_data. Попробуй позже."
    });

    await writeAdminActionLog({
      adminUserId: input.adminUserId,
      command: "report_data",
      success: false,
      req: input.req,
      meta: {
        report_date: input.reportDate
      },
      errorText: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function sendAdminAccessDenied(userIdText: string) {
  await maxBotClient.sendMessage({
    userId: userIdText,
    text: ACCESS_DENIED_TEXT
  });
}

export async function handleAdminCommand(input: {
  adminUserId: bigint;
  userIdText: string;
  text: string;
  req: Request;
}) {
  const normalizedText = normalizeText(input.text);
  const firstMessage = await isFirstAdminMessage(input.adminUserId);

  if (firstMessage || isMenuCommand(normalizedText)) {
    await sendAdminHelp(input.userIdText);
    await writeAdminActionLog({
      adminUserId: input.adminUserId,
      command: "help",
      success: true,
      req: input.req
    });
    return;
  }

  const [commandToken, arg1, arg2] = parseTokens(normalizedText);
  const command = commandToken.toLowerCase();

  if (command === "/add") {
    const orgId = arg1 ? parsePositiveInt(arg1) : null;
    const amount = arg2 ? parsePositiveBigInt(arg2) : null;
    if (!orgId || !amount || parseTokens(normalizedText).length !== 3) {
      await maxBotClient.sendMessage({
        userId: input.userIdText,
        text: !amount && arg2 ? INVALID_AMOUNT_TEXT : ADD_FORMAT_ERROR_TEXT
      });
      await writeAdminActionLog({
        adminUserId: input.adminUserId,
        command: "add",
        success: false,
        req: input.req,
        meta: {
          raw_text: normalizedText
        },
        errorText: "INVALID_FORMAT"
      });
      return;
    }

    await addBalance({
      adminUserId: input.adminUserId,
      userIdText: input.userIdText,
      orgId,
      amount,
      req: input.req
    });
    return;
  }

  if (command === "/withdraw") {
    const orgId = arg1 ? parsePositiveInt(arg1) : null;
    const amount = arg2 ? parsePositiveBigInt(arg2) : null;
    if (!orgId || !amount || parseTokens(normalizedText).length !== 3) {
      await maxBotClient.sendMessage({
        userId: input.userIdText,
        text: !amount && arg2 ? INVALID_AMOUNT_TEXT : WITHDRAW_FORMAT_ERROR_TEXT
      });
      await writeAdminActionLog({
        adminUserId: input.adminUserId,
        command: "withdraw",
        success: false,
        req: input.req,
        meta: {
          raw_text: normalizedText
        },
        errorText: "INVALID_FORMAT"
      });
      return;
    }

    await withdrawBalance({
      adminUserId: input.adminUserId,
      userIdText: input.userIdText,
      orgId,
      amount,
      req: input.req
    });
    return;
  }

  if (command === "/add_admin") {
    const targetMaxUserId = arg1 ? parsePositiveBigInt(arg1) : null;
    if (!targetMaxUserId || parseTokens(normalizedText).length !== 2) {
      await maxBotClient.sendMessage({
        userId: input.userIdText,
        text: ADD_ADMIN_FORMAT_ERROR_TEXT
      });
      await writeAdminActionLog({
        adminUserId: input.adminUserId,
        command: "add_admin",
        success: false,
        req: input.req,
        meta: {
          raw_text: normalizedText
        },
        errorText: "INVALID_FORMAT"
      });
      return;
    }

    await addAdmin({
      adminUserId: input.adminUserId,
      userIdText: input.userIdText,
      targetMaxUserId,
      req: input.req
    });
    return;
  }

  if (command === "/report_admin") {
    await handleAdminReport({
      adminUserId: input.adminUserId,
      userIdText: input.userIdText,
      req: input.req,
      reportCode: "arshin",
      doneText: "Отчет для администратора за сегодня готов.",
      command: "report_admin"
    });
    return;
  }

  if (command === "/report_buh") {
    await handleAdminReport({
      adminUserId: input.adminUserId,
      userIdText: input.userIdText,
      req: input.req,
      reportCode: "balance_arshin",
      doneText: "Бухгалтерский отчет за сегодня готов.",
      command: "report_buh"
    });
    return;
  }

  if (command === "/report_data") {
    const reportDate = arg1 ? parseReportDateInput(arg1) : null;
    if (!reportDate || parseTokens(normalizedText).length !== 2) {
      await maxBotClient.sendMessage({
        userId: input.userIdText,
        text: REPORT_DATA_FORMAT_ERROR_TEXT
      });
      await writeAdminActionLog({
        adminUserId: input.adminUserId,
        command: "report_data",
        success: false,
        req: input.req,
        meta: {
          raw_text: normalizedText
        },
        errorText: "INVALID_FORMAT"
      });
      return;
    }

    await handleAdminReportByDate({
      adminUserId: input.adminUserId,
      userIdText: input.userIdText,
      req: input.req,
      reportDate
    });
    return;
  }

  await maxBotClient.sendMessage({
    userId: input.userIdText,
    text: UNKNOWN_COMMAND_TEXT
  });
  await writeAdminActionLog({
    adminUserId: input.adminUserId,
    command: "unknown",
    success: false,
    req: input.req,
    meta: {
      raw_text: normalizedText
    },
    errorText: "UNKNOWN_COMMAND"
  });
}
