import "server-only";

import { prisma } from "@/lib/prisma";
import { AppError } from "@/server/errors";
import type {
  MarketerApplicationSummary,
  OpsGetMarketerApplicationInput,
  OpsListMarketerApplicationsInput,
  OpsRejectMarketerApplicationInput,
  SubmitMarketerApplicationInput,
} from "@/server/schemas";

const applicationSelect = {
  id: true,
  userId: true,
  message: true,
  operatorNote: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

function projectApplication(application: {
  id: string;
  message: string;
  operatorNote: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: Date;
  updatedAt: Date;
}): MarketerApplicationSummary {
  return {
    id: application.id,
    message: application.message,
    operatorNote: application.operatorNote,
    status: application.status,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
  };
}

async function requireOperator(callerUserId: string) {
  const caller = await prisma.user.findUnique({
    where: { id: callerUserId },
    select: { isOperator: true },
  });
  if (!caller?.isOperator) {
    throw new AppError("Not found", 404);
  }
}

export const marketerApplicationService = {
  async submitApplication(
    userId: string,
    input: SubmitMarketerApplicationInput
  ) {
    const [marketer, pending] = await Promise.all([
      prisma.marketer.findUnique({
        where: { userId },
        select: { id: true },
      }),
      prisma.marketerApplication.findFirst({
        where: { userId, status: "PENDING" },
        select: { id: true },
      }),
    ]);

    if (marketer) {
      throw new AppError("Already a Marketer", 400);
    }
    if (pending) {
      throw new AppError("A Marketer Application is already pending", 400);
    }

    const created = await prisma.marketerApplication.create({
      data: {
        userId,
        message: input.message,
        status: "PENDING",
      },
      select: applicationSelect,
    });

    return projectApplication(created);
  },

  async getLatestForUser(userId: string) {
    const application = await prisma.marketerApplication.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: applicationSelect,
    });
    return application ? projectApplication(application) : null;
  },

  async listApplications(
    callerUserId: string,
    input: OpsListMarketerApplicationsInput
  ) {
    await requireOperator(callerUserId);

    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 25;
    const sortDir = input.sortDir ?? "desc";
    const where = input.status ? { status: input.status } : {};

    const [totalCount, rows] = await Promise.all([
      prisma.marketerApplication.count({ where }),
      prisma.marketerApplication.findMany({
        where,
        orderBy: { createdAt: sortDir },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          ...applicationSelect,
          user: {
            select: {
              id: true,
              name: true,
              mainWalletPublicKey: true,
            },
          },
        },
      }),
    ]);

    return {
      totalCount,
      items: rows.map((row) => ({
        ...projectApplication(row),
        userId: row.userId,
        userName: row.user.name,
        mainWalletPublicKey: row.user.mainWalletPublicKey,
      })),
    };
  },

  async getApplication(
    callerUserId: string,
    input: OpsGetMarketerApplicationInput
  ) {
    await requireOperator(callerUserId);

    const application = await prisma.marketerApplication.findUnique({
      where: { id: input.applicationId },
      select: {
        ...applicationSelect,
        user: {
          select: {
            id: true,
            name: true,
            mainWalletPublicKey: true,
            marketer: { select: { id: true } },
          },
        },
      },
    });

    if (!application) {
      throw new AppError("Not found", 404);
    }

    return {
      ...projectApplication(application),
      userId: application.userId,
      userName: application.user.name,
      mainWalletPublicKey: application.user.mainWalletPublicKey,
      isAlreadyMarketer: Boolean(application.user.marketer),
    };
  },

  async rejectApplication(
    callerUserId: string,
    input: OpsRejectMarketerApplicationInput
  ) {
    await requireOperator(callerUserId);

    const existing = await prisma.marketerApplication.findUnique({
      where: { id: input.applicationId },
      select: { id: true, status: true },
    });

    if (!existing) {
      throw new AppError("Not found", 404);
    }
    if (existing.status !== "PENDING") {
      throw new AppError("Only pending Applications can be rejected", 400);
    }

    const updated = await prisma.marketerApplication.update({
      where: { id: existing.id },
      data: {
        status: "REJECTED",
        ...(input.operatorNote !== undefined
          ? { operatorNote: input.operatorNote || null }
          : {}),
      },
      select: applicationSelect,
    });

    return projectApplication(updated);
  },

  /**
   * Approves the User's pending Marketer Application, if any.
   * No-op when none is pending. Used by Ops Marketer create.
   */
  async approvePendingForUser(
    userId: string,
    db: {
      marketerApplication: {
        findFirst: typeof prisma.marketerApplication.findFirst;
        update: typeof prisma.marketerApplication.update;
      };
    } = prisma
  ) {
    const pending = await db.marketerApplication.findFirst({
      where: { userId, status: "PENDING" },
      select: { id: true },
    });

    if (!pending) {
      return null;
    }

    const updated = await db.marketerApplication.update({
      where: { id: pending.id },
      data: { status: "APPROVED" },
      select: applicationSelect,
    });

    return projectApplication(updated);
  },
};
