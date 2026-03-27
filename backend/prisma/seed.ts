import { PrismaClient, SubmissionSource, SubmissionStatus, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { email: "org@poverka-bot.ru" },
    update: {
      name: "OOO Poverka Test",
      balance: 50000,
      balanceStartOfDay: 12000,
      userTarif: 1250
    },
    create: {
      name: "OOO Poverka Test",
      email: "org@poverka-bot.ru",
      balance: 50000,
      balanceStartOfDay: 12000,
      userTarif: 1250
    }
  });

  const admin = await prisma.user.upsert({
    where: { maxUserId: "900001" },
    update: {
      firstName: "Admin",
      lastName: "User",
      fullName: "Admin User",
      username: "admin_user",
      role: UserRole.ADMIN,
      isActive: true,
      organizationId: null
    },
    create: {
      maxUserId: "900001",
      firstName: "Admin",
      lastName: "User",
      fullName: "Admin User",
      username: "admin_user",
      role: UserRole.ADMIN,
      isActive: true
    }
  });

  const user1 = await prisma.user.upsert({
    where: { maxUserId: "1001" },
    update: {
      firstName: "Ivan",
      lastName: "Petrov",
      fullName: "Ivan Petrov",
      username: "ivan.petrov",
      role: UserRole.USER,
      organizationId: org.id,
      isActive: true
    },
    create: {
      maxUserId: "1001",
      firstName: "Ivan",
      lastName: "Petrov",
      fullName: "Ivan Petrov",
      username: "ivan.petrov",
      role: UserRole.USER,
      organizationId: org.id,
      isActive: true
    }
  });

  await prisma.user.upsert({
    where: { maxUserId: "1002" },
    update: {
      firstName: "Maria",
      lastName: "Sidorova",
      fullName: "Maria Sidorova",
      username: "maria.sidorova",
      role: UserRole.USER,
      organizationId: org.id,
      isActive: true
    },
    create: {
      maxUserId: "1002",
      firstName: "Maria",
      lastName: "Sidorova",
      fullName: "Maria Sidorova",
      username: "maria.sidorova",
      role: UserRole.USER,
      organizationId: org.id,
      isActive: true
    }
  });

  const submission = await prisma.meterSubmission.create({
    data: {
      userId: user1.id,
      organizationId: org.id,
      meterNumber: "123456",
      currentValue: "88.500",
      status: SubmissionStatus.CONFIRMED,
      source: SubmissionSource.MINIAPP,
      confirmedAt: new Date()
    }
  });

  await prisma.submissionStatusHistory.create({
    data: {
      submissionId: submission.id,
      oldStatus: SubmissionStatus.PENDING_CONFIRMATION,
      newStatus: SubmissionStatus.CONFIRMED,
      changedByUserId: user1.id,
      reason: "Seed confirmed sample"
    }
  });

  await prisma.auditLog.createMany({
    data: [
      {
        actorUserId: admin.id,
        action: "seed.admin.ready",
        entityType: "SYSTEM",
        meta: { note: "Initial admin seeded" }
      },
      {
        actorUserId: user1.id,
        action: "seed.submission.created",
        entityType: "SUBMISSION",
        entityId: submission.id
      }
    ]
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
