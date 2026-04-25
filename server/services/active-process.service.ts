import "server-only";

import { prisma } from "@/lib/prisma";

type ActiveProcessKind = "launch" | "exit";

interface ActiveProcessSummary {
  id: string;
  kind: ActiveProcessKind;
  status: string;
  progress: number;
  label: string;
  currentStep: string | null;
  tokenPublicKey: string | null;
  tokenSymbol?: string | null;
  createdAt: Date;
  startedAt: Date | null;
}

export const activeProcessService = {
  async list(userId: string): Promise<ActiveProcessSummary[]> {
    const launch = await prisma.launch.findFirst({
      where: {
        userId,
        status: { in: ["PENDING", "RUNNING"] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        progress: true,
        currentStep: true,
        tokenPublicKey: true,
        createdAt: true,
        startedAt: true,
      },
    });

    const exits = await prisma.holdingExit.findMany({
      where: {
        userId,
        status: { in: ["PENDING", "RUNNING"] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        progress: true,
        currentStep: true,
        tokenPublicKey: true,
        createdAt: true,
        startedAt: true,
        token: {
          select: {
            symbol: true,
          },
        },
      },
    });

    const processes: ActiveProcessSummary[] = [];

    if (launch) {
      processes.push({
        id: launch.id,
        kind: "launch",
        status: launch.status,
        progress: launch.progress,
        label: "Launch",
        currentStep: launch.currentStep,
        tokenPublicKey: launch.tokenPublicKey,
        createdAt: launch.createdAt,
        startedAt: launch.startedAt,
      });
    }

    for (const exit of exits) {
      processes.push({
        id: exit.id,
        kind: "exit",
        status: exit.status,
        progress: exit.progress,
        label: "Exit",
        currentStep: exit.currentStep,
        tokenPublicKey: exit.tokenPublicKey,
        tokenSymbol: exit.token.symbol,
        createdAt: exit.createdAt,
        startedAt: exit.startedAt,
      });
    }

    return processes.sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
    );
  },
};
