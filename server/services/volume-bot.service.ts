import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { prisma } from "@/lib/prisma";
import { getVolumeBotConfig } from "@/lib/config/volume-bot.config";
import { AppError } from "@/server/errors";
import type {
  CloseVolumeBotAccountsInput,
  ListVolumeBotSessionsInput,
  ReclaimVolumeBotInput,
  StartVolumeBotInput,
  VolumeBotConfigInput,
  VolumeBotStatusInput,
} from "@/server/schemas/volume-bot.schema";
import {
  closeVolumeBotAccounts,
  reclaimVolumeBotSession,
} from "@/server/services/volume-bot-worker";
import { volumeBotTimer } from "@/server/services/volume-bot-timer";
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

const randomBetween = (min: number, max: number) =>
  Math.random() * (max - min) + min;

const computeNextTickAt = (config: VolumeBotConfigInput) => {
  const delaySeconds = Math.floor(
    randomBetween(config.minIntervalSeconds, config.maxIntervalSeconds)
  );
  return new Date(Date.now() + delaySeconds * 1000);
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
          nextTickAt: computeNextTickAt(input.config),
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

    await volumeBotTimer.scheduleSession(session.id);
    return { sessionId: session.id };
  },

  async getStatus(input: VolumeBotStatusInput, userId: string) {
    if (!input.sessionId && !input.tokenPublicKey) {
      throw new AppError("Session id or token public key required", 400);
    }

    const sessionWithWallets = await prisma.volumeBotSession.findFirst({
      where: {
        userId,
        ...(input.sessionId ? { id: input.sessionId } : {}),
        ...(input.tokenPublicKey ? { tokenPublicKey: input.tokenPublicKey } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        wallets: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            walletPublicKey: true,
            role: true,
            status: true,
            solBalance: true,
            tokenBalance: true,
            tradesExecuted: true,
            pnlSol: true,
            lastTradeAt: true,
            nextTickAt: true,
            reclaimedAt: true,
          },
        },
      },
    });

    if (!sessionWithWallets) {
      throw new AppError("Volume bot session not found", 404);
    }

    const { wallets, ...session } = sessionWithWallets;
    return { session, wallets };
  },

  async stopSession(sessionId: string, userId: string) {
    console.log(`[VolumeBot] stopSession called for ${sessionId}`);
    const session = await prisma.volumeBotSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true, status: true },
    });
    if (!session) {
      throw new AppError("Volume bot session not found", 404);
    }
    console.log(`[VolumeBot] Session ${sessionId} current status: ${session.status}`);
    
    if (["STOPPED", "FAILED"].includes(session.status)) {
      console.log(`[VolumeBot] Session ${sessionId} already completed, skipping`);
      return { sessionId: session.id };
    }

    if (!["STOP_REQUESTED", "STOPPING"].includes(session.status)) {
      await prisma.volumeBotSession.update({
        where: { id: session.id },
        data: { status: "STOP_REQUESTED", stopRequestedAt: new Date() },
      });
      console.log(`[VolumeBot] Session ${sessionId} marked as STOP_REQUESTED`);
    } else {
      console.log(`[VolumeBot] Session ${sessionId} already stopping, retrying stop`);
    }

    console.log(`[VolumeBot] Calling volumeBotTimer.requestStop for ${sessionId}`);
    volumeBotTimer
      .requestStop(session.id)
      .then(() => {
        console.log(`[VolumeBot] requestStop promise resolved for ${sessionId}`);
      })
      .catch((error) => {
        console.error(`[VolumeBot] requestStop failed for ${session.id}:`, error);
      });
    
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
    await reclaimVolumeBotSession(session.id);
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
    await closeVolumeBotAccounts(session.id);
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
