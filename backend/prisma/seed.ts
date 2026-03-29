import { PrismaClient, SubmissionSource, SubmissionStatus, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { email: "org@poverka-bot.ru" },
    update: {
      name: "OOO Poverka Test",
      balance: 50000,
      balanceStartOfDay: 12000,
      userTarif: 1250,
      balanceKopecks: 5000000n,
      tariffPerPackageKopecks: 125000n
    },
    create: {
      name: "OOO Poverka Test",
      email: "org@poverka-bot.ru",
      balance: 50000,
      balanceStartOfDay: 12000,
      userTarif: 1250,
      balanceKopecks: 5000000n,
      tariffPerPackageKopecks: 125000n
    }
  });

  const adminId = BigInt(900001);
  const user1Id = BigInt(1001);
  const user2Id = BigInt(1002);

  const admin = await prisma.user.upsert({
    where: { id: adminId },
    update: {
      fullName: "Admin User",
      role: UserRole.ADMIN,
      phone: "+79000000001",
      city: "Moscow",
      organizationId: null,
      orgName: null,
      orgEmail: null
    },
    create: {
      id: adminId,
      fullName: "Admin User",
      role: UserRole.ADMIN,
      phone: "+79000000001",
      city: "Moscow"
    }
  });

  const user1 = await prisma.user.upsert({
    where: { id: user1Id },
    update: {
      fullName: "Ivan Petrov",
      role: UserRole.USER,
      phone: "+79000000002",
      city: "Moscow",
      organizationId: org.id,
      userTarif: 1250,
      orgName: org.name,
      orgEmail: org.email
    },
    create: {
      id: user1Id,
      fullName: "Ivan Petrov",
      role: UserRole.USER,
      phone: "+79000000002",
      city: "Moscow",
      organizationId: org.id,
      userTarif: 1250,
      orgName: org.name,
      orgEmail: org.email
    }
  });

  await prisma.user.upsert({
    where: { id: user2Id },
    update: {
      fullName: "Maria Sidorova",
      role: UserRole.USER,
      phone: "+79000000003",
      city: "Moscow",
      organizationId: org.id,
      userTarif: 1250,
      orgName: org.name,
      orgEmail: org.email
    },
    create: {
      id: user2Id,
      fullName: "Maria Sidorova",
      role: UserRole.USER,
      phone: "+79000000003",
      city: "Moscow",
      organizationId: org.id,
      userTarif: 1250,
      orgName: org.name,
      orgEmail: org.email
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
