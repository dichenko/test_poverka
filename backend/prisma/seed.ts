import { PrismaClient, SubmissionSource, SubmissionStatus, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { inn: "7700000001" },
    update: {
      name: "ООО Поверка Тест",
      isActive: true,
      balance: "50000.00",
      submissionLimit: 1000
    },
    create: {
      inn: "7700000001",
      name: "ООО Поверка Тест",
      isActive: true,
      balance: "50000.00",
      submissionLimit: 1000
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
      firstName: "Иван",
      lastName: "Петров",
      fullName: "Иван Петров",
      username: "ivan.petrov",
      role: UserRole.USER,
      organizationId: org.id,
      isActive: true
    },
    create: {
      maxUserId: "1001",
      firstName: "Иван",
      lastName: "Петров",
      fullName: "Иван Петров",
      username: "ivan.petrov",
      role: UserRole.USER,
      organizationId: org.id,
      isActive: true
    }
  });

  await prisma.user.upsert({
    where: { maxUserId: "1002" },
    update: {
      firstName: "Мария",
      lastName: "Сидорова",
      fullName: "Мария Сидорова",
      username: "maria.sidorova",
      role: UserRole.USER,
      organizationId: org.id,
      isActive: true
    },
    create: {
      maxUserId: "1002",
      firstName: "Мария",
      lastName: "Сидорова",
      fullName: "Мария Сидорова",
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
