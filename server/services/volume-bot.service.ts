import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { prisma } from "@/lib/prisma";
import { getVolumeBotConfig } from "@/lib/config/volume-bot.config";
import {
  getVolumeBotControlQueue,
  getVolumeBotQueue,
} from "@/lib/queue/volume-bot-queues";
import { AppError } from "@/server/errors";
import type {
  CloseVolumeBotAccountsInput,
  ListVolumeBotSessionsInput,
  ReclaimVolumeBotInput,
  StartVolumeBotInput,
  VolumeBotConfigInput,
  VolumeBotStatusInput,
} from "@/server/schemas/volume-bot.schema";
import { walletService } from "@/server/services/wallet.service";

const validateConfig = (config: VolumeBotConfigInput) => {
  const limits = getVolumeBotConfig();
  if (config.walletCount < limits.minWallets || config.walletCount > limits.maxWallets) {
    throw new AppError("Wallet count out of bounds", 400);
  }
  if (config.fundingPerWalletSol < limits.minFundingPerWalletSol) {
    throw new AppError("Funding per wallet too low", 400);
  }
  if (config.minTradeAmountSol > config.maxTradeAmountSol) {
    throw new AppError("Min trade amount exceeds max trade amount", 400);
  }
  if (config.minIntervalSeconds > config.maxIntervalSeconds) {
    throw new AppError("Min interval exceeds max interval", 400);
  }
};

const resolveScheduledStopAt = (
  config: VolumeBotConfigInput,
  scheduledStopAt?: Date
) => {
  if (scheduledStopAt) {
    return scheduledStopAt;
  }
  if (config.targetDurationHours) {
    return new Date(Date.now() + config.targetDurationHours * 60 * 60 * 1000);
  }
  return null;
};

export const volumeBotService = {
  async startSession(input: StartVolumeBotInput, userId: string) {
    const token = await prisma.token.findFirst({
      where: { publicKey: input.tokenPublicKey, userId },
      select: { publicKey: true },
    });

    if (!token) {
      throw new AppError("Token not found", 404);
    }

    const activeSession = await prisma.volumeBotSession.findFirst({
      where: {
        userId,
        tokenPublicKey: token.publicKey,
        status: { in: ["RUNNING", "STOP_REQUESTED", "STOPPING"] },
      },
      select: { id: true },
    });

    if (activeSession) {
      throw new AppError("Volume bot already running for this token", 409);
    }

    validateConfig(input.config);
    const scheduledStopAt = resolveScheduledStopAt(
      input.config,
      input.scheduledStopAt
    );

    const keypairs = Array.from({ length: input.config.walletCount }, () =>
      Keypair.generate()
    );
    const now = new Date();

    const session = await prisma.$transaction(async (tx) => {
      const createdSession = await tx.volumeBotSession.create({
        data: {
          userId,
          tokenPublicKey: token.publicKey,
          status: "RUNNING",
          config: input.config,
          startedAt: now,
          scheduledStopAt,
        },
      });

      await tx.wallet.createMany({
        data: keypairs.map((keypair) => ({
          publicKey: keypair.publicKey.toBase58(),
          privateKey: bs58.encode(keypair.secretKey),
          type: "VOLUME",
          tokenPublicKey: token.publicKey,
          userId,
        })),
      });

      await tx.volumeBotWallet.createMany({
        data: keypairs.map((keypair) => ({
          sessionId: createdSession.id,
          walletPublicKey: keypair.publicKey.toBase58(),
        })),
      });

      return createdSession;
    });

    const walletPublicKeys = keypairs.map((keypair) =>
      keypair.publicKey.toBase58()
    );

    try {
      await walletService.sendSolFromMainWallet(
        token.publicKey,
        userId,
        walletPublicKeys,
        input.config.fundingPerWalletSol
      );
    } catch (error) {
      await prisma.volumeBotSession.update({
        where: { id: session.id },
        data: { status: "FAILED", stoppedAt: new Date() },
      });
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError(message, 500);
    }

    const queue = getVolumeBotQueue();
    await queue.add(
      "start",
      { sessionId: session.id },
      { jobId: `start:${session.id}` }
    );

    return { sessionId: session.id };
  },

  async getStatus(input: VolumeBotStatusInput, userId: string) {
    if (!input.sessionId && !input.tokenPublicKey) {
      throw new AppError("Session id or token public key required", 400);
    }

    const session = await prisma.volumeBotSession.findFirst({
      where: {
        userId,
        ...(input.sessionId ? { id: input.sessionId } : {}),
        ...(input.tokenPublicKey ? { tokenPublicKey: input.tokenPublicKey } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    if (!session) {
      throw new AppError("Volume bot session not found", 404);
    }

    const wallets = await prisma.volumeBotWallet.findMany({
      where: { sessionId: session.id },
      include: {
        wallet: {
          select: { publicKey: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return { session, wallets };
  },

  async stopSession(sessionId: string, userId: string) {
    const session = await prisma.volumeBotSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true, status: true },
    });
    if (!session) {
      throw new AppError("Volume bot session not found", 404);
    }
    if (["STOPPING", "STOPPED", "FAILED"].includes(session.status)) {
      return { sessionId: session.id };
    }

    await prisma.volumeBotSession.update({
      where: { id: session.id },
      data: { status: "STOP_REQUESTED", stopRequestedAt: new Date() },
    });

    const controlQueue = getVolumeBotControlQueue();
    await controlQueue.add(
      "stop",
      { sessionId: session.id },
      { jobId: `stop:${session.id}` }
    );

    return { sessionId: session.id };
  },

  async reclaimFunds(input: ReclaimVolumeBotInput, userId: string) {
    const session = await prisma.volumeBotSession.findFirst({
      where: { id: input.sessionId, userId },
      select: { id: true },
    });
    if (!session) {
      throw new AppError("Volume bot session not found", 404);
    }
    const controlQueue = getVolumeBotControlQueue();
    await controlQueue.add(
      "reclaim",
      { sessionId: session.id },
      { jobId: `reclaim:${session.id}` }
    );
    return { sessionId: session.id };
  },

  async closeTokenAccounts(input: CloseVolumeBotAccountsInput, userId: string) {
    const session = await prisma.volumeBotSession.findFirst({
      where: { id: input.sessionId, userId },
      select: { id: true },
    });
    if (!session) {
      throw new AppError("Volume bot session not found", 404);
    }
    const controlQueue = getVolumeBotControlQueue();
    await controlQueue.add(
      "close-accounts",
      { sessionId: session.id },
      { jobId: `close-accounts:${session.id}` }
    );
    return { sessionId: session.id };
  },

  async listSessions(input: ListVolumeBotSessionsInput, userId: string) {
    return await prisma.volumeBotSession.findMany({
      where: {
        userId,
        ...(input.tokenPublicKey ? { tokenPublicKey: input.tokenPublicKey } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: input.limit,
    });
  },
};
