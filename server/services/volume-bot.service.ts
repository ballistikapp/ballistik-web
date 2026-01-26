import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { prisma } from "@/lib/prisma";
import { getVolumeBotConfig } from "@/lib/config/volume-bot.config";
import { getSolanaConnection } from "@/lib/solana/connection";
import { AppError } from "@/server/errors";
import type {
  CloseVolumeBotAccountsInput,
  ListVolumeBotSessionsInput,
  ReclaimVolumeBotInput,
  StartVolumeBotInput,
  VolumeBotConfigInput,
  VolumeBotEligibleWalletsInput,
  VolumeBotSelectionSummaryInput,
  VolumeBotStatusInput,
} from "@/server/schemas/volume-bot.schema";
import {
  closeVolumeBotAccounts,
  reclaimVolumeBotSession,
} from "@/server/services/volume-bot-worker";
import { volumeBotTimer } from "@/server/services/volume-bot-timer";
import { walletService } from "@/server/services/wallet.service";
import { computeSellQuote, fetchPumpQuoteState } from "@/server/solana/pump-quotes";

const validateConfig = (
  config: VolumeBotConfigInput,
  scheduledStopAt: Date | undefined,
  totalWalletCount: number
) => {
  const limits = getVolumeBotConfig();
  if (totalWalletCount < limits.minWallets || totalWalletCount > limits.maxWallets) {
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
  if (config.strategy !== "neutral" && !config.strategyTargetSol) {
    throw new AppError("Target SOL amount required for pump/dump", 400);
  }
  if (!config.targetDurationSeconds && !config.targetDurationHours && !scheduledStopAt) {
    throw new AppError(
      "Duration limit required: set targetDurationSeconds or scheduledStopAt",
      400
    );
  }
  const targetDurationSeconds =
    config.targetDurationSeconds ??
    (config.targetDurationHours ? config.targetDurationHours * 60 * 60 : undefined);
  if (
    targetDurationSeconds &&
    targetDurationSeconds > limits.maxDurationSeconds
  ) {
    const maxHours = limits.maxDurationHours;
    throw new AppError(
      `Duration exceeds maximum of ${maxHours} hours`,
      400
    );
  }
  if (scheduledStopAt) {
    const durationMs = scheduledStopAt.getTime() - Date.now();
    const durationHours = durationMs / (1000 * 60 * 60);
    if (durationHours > limits.maxDurationHours) {
      throw new AppError(
        `Scheduled stop exceeds maximum duration of ${limits.maxDurationHours} hours`,
        400
      );
    }
    if (durationHours <= 0) {
      throw new AppError("Scheduled stop time must be in the future", 400);
    }
  }
};

const resolveScheduledStopAt = (
  config: VolumeBotConfigInput,
  scheduledStopAt?: Date
) => {
  if (scheduledStopAt) {
    return scheduledStopAt;
  }
  if (config.targetDurationSeconds) {
    return new Date(Date.now() + config.targetDurationSeconds * 1000);
  }
  if (config.targetDurationHours) {
    return new Date(Date.now() + config.targetDurationHours * 60 * 60 * 1000);
  }
  return null;
};

const FEE_BUFFER_SOL = 0.003;

const randomBetween = (min: number, max: number) =>
  Math.random() * (max - min) + min;

const computeNextTickAt = (config: VolumeBotConfigInput) => {
  const delaySeconds = Math.floor(
    randomBetween(config.minIntervalSeconds, config.maxIntervalSeconds)
  );
  return new Date(Date.now() + delaySeconds * 1000);
};

const quotePayer = Keypair.generate();

const getMintDecimals = async (mint: PublicKey) => {
  const connection = getSolanaConnection();
  const mintInfo = await connection.getParsedAccountInfo(mint);
  return (
    (mintInfo.value?.data as { parsed?: { info?: { decimals?: number } } })
      ?.parsed?.info?.decimals ?? 6
  );
};

const formatTokenBalance = (raw: bigint, decimals: number) => {
  if (decimals <= 0) return Number(raw);
  const base = BigInt(10) ** BigInt(decimals);
  const integer = raw / base;
  const fraction = raw % base;
  const fractionStr = fraction
    .toString()
    .padStart(decimals, "0")
    .slice(0, 6);
  return Number(`${integer.toString()}.${fractionStr}`);
};

const fetchTokenBalances = async (
  mintPublicKey: PublicKey,
  walletPublicKeys: string[]
) => {
  if (walletPublicKeys.length === 0) {
    return { balances: [], tokenDecimals: await getMintDecimals(mintPublicKey) };
  }
  const connection = getSolanaConnection();
  const tokenDecimals = await getMintDecimals(mintPublicKey);
  const atas = await Promise.all(
    walletPublicKeys.map((walletPublicKey) =>
      getAssociatedTokenAddress(mintPublicKey, new PublicKey(walletPublicKey))
    )
  );
  const accountInfos = await connection.getMultipleParsedAccounts(atas);

  const balances = walletPublicKeys.map((walletPublicKey, index) => {
    const accountInfo = accountInfos.value[index];
    let raw = BigInt(0);
    let decimals = tokenDecimals;
    if (accountInfo?.data && "parsed" in accountInfo.data) {
      const parsed = accountInfo.data.parsed as {
        info?: { tokenAmount?: { amount?: string; decimals?: number } };
      };
      const tokenAmount = parsed?.info?.tokenAmount;
      if (tokenAmount?.amount) {
        raw = BigInt(tokenAmount.amount);
      }
      if (typeof tokenAmount?.decimals === "number") {
        decimals = tokenAmount.decimals;
      }
    }
    return {
      walletPublicKey,
      tokenBalanceRaw: raw,
      tokenBalanceUi: formatTokenBalance(raw, decimals),
      tokenDecimals: decimals,
    };
  });

  return { balances, tokenDecimals };
};

const resolveEligibleWallets = async (
  tokenPublicKey: string,
  userId: string
) => {
  const token = await prisma.token.findFirst({
    where: { publicKey: tokenPublicKey, userId },
    select: { publicKey: true, symbol: true },
  });

  if (!token) {
    throw new AppError("Token not found", 404);
  }

  const [operationalWallets, user] = await Promise.all([
    prisma.wallet.findMany({
      where: {
        tokenPublicKey,
        type: { in: ["BUNDLER", "VOLUME", "DISTRIBUTION"] },
      },
      select: {
        publicKey: true,
        type: true,
        balanceSol: true,
        balanceRefreshedAt: true,
        privateKey: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { mainWalletPublicKey: true },
    }),
  ]);

  const mainWalletPublicKey = user?.mainWalletPublicKey ?? null;
  const wallets = [
    ...operationalWallets,
  ].filter((wallet) => wallet.publicKey !== mainWalletPublicKey);

  return { token, wallets };
};

export const volumeBotService = {
  async startSession(input: StartVolumeBotInput, userId: string) {
    const { token, wallets: eligibleWallets } = await resolveEligibleWallets(
      input.tokenPublicKey,
      userId
    );

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

    const selectedWalletPublicKeys = Array.from(
      new Set(input.config.selectedWalletPublicKeys ?? [])
    );
    const selectedWallets = eligibleWallets.filter((wallet) =>
      selectedWalletPublicKeys.includes(wallet.publicKey)
    );
    if (selectedWalletPublicKeys.length !== selectedWallets.length) {
      throw new AppError("Selected wallets are not eligible for this token", 400);
    }
    const missingKey = selectedWallets.find((wallet) => !wallet.privateKey);
    if (missingKey) {
      throw new AppError("Selected wallet is missing a private key", 400);
    }
    if (input.config.strategy === "dump" && selectedWallets.length === 0) {
      throw new AppError("Select wallets for dump strategy", 400);
    }

    const totalWalletCount =
      selectedWallets.length + input.config.generatedWalletCount;
    validateConfig(input.config, input.scheduledStopAt, totalWalletCount);
    const scheduledStopAt = resolveScheduledStopAt(
      input.config,
      input.scheduledStopAt
    );

    const keypairs = Array.from({ length: input.config.generatedWalletCount }, () =>
      Keypair.generate()
    );
    const now = new Date();
    let targetSolApplied = input.config.strategyTargetSol ?? 0;
    if (input.config.strategy === "dump" && targetSolApplied > 0) {
      const mintPublicKey = new PublicKey(token.publicKey);
      const { balances } = await fetchTokenBalances(
        mintPublicKey,
        selectedWalletPublicKeys
      );
      const totalTokenRaw = balances.reduce(
        (sum, balance) => sum + balance.tokenBalanceRaw,
        BigInt(0)
      );
      try {
        const quoteState = await fetchPumpQuoteState(mintPublicKey, quotePayer);
        const { netSolOut } = computeSellQuote(quoteState, totalTokenRaw);
        const maxNetSolOutSol = Number(netSolOut) / 1_000_000_000;
        targetSolApplied = Math.min(targetSolApplied, maxNetSolOutSol);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[VolumeBot] Target cap quote failed: ${message}`);
      }
    }

    const session = await prisma.$transaction(async (tx) => {
      const configSnapshot = {
        ...input.config,
        selectedWalletPublicKeys,
        generatedWalletCount: input.config.generatedWalletCount,
        targetSolApplied,
      };
      console.log("[VolumeBot] Starting session", {
        tokenPublicKey: token.publicKey,
        userId,
        config: {
          ...configSnapshot,
          selectedWalletCount: selectedWallets.length,
          generatedWalletCount: keypairs.length,
        },
        scheduledStopAt,
      });
      const createdSession = await tx.volumeBotSession.create({
        data: {
          userId,
          tokenPublicKey: token.publicKey,
          status: "RUNNING",
          config: configSnapshot,
          startedAt: now,
          scheduledStopAt,
        },
      });

      if (keypairs.length > 0) {
        await tx.wallet.createMany({
          data: keypairs.map((keypair) => ({
            publicKey: keypair.publicKey.toBase58(),
            privateKey: bs58.encode(keypair.secretKey),
            type: "VOLUME",
            tokenPublicKey: token.publicKey,
            userId,
          })),
        });
      }

      if (selectedWallets.length > 0) {
        await tx.volumeBotWallet.createMany({
          data: selectedWallets.map((wallet) => ({
            sessionId: createdSession.id,
            walletPublicKey: wallet.publicKey,
            nextTickAt: computeNextTickAt(input.config),
          })),
        });
      }

      if (keypairs.length > 0) {
        await tx.volumeBotWallet.createMany({
          data: keypairs.map((keypair) => ({
            sessionId: createdSession.id,
            walletPublicKey: keypair.publicKey.toBase58(),
            nextTickAt: computeNextTickAt(input.config),
          })),
        });
      }

      return createdSession;
    });

    const walletPublicKeys = keypairs.map((keypair) =>
      keypair.publicKey.toBase58()
    );
    const fundingAmountSol = Math.max(
      input.config.fundingPerWalletSol + FEE_BUFFER_SOL,
      FEE_BUFFER_SOL
    );

    try {
      if (walletPublicKeys.length > 0) {
        await walletService.sendSolFromMainWallet(
          token.publicKey,
          userId,
          walletPublicKeys,
          fundingAmountSol
        );
      }
      if (selectedWallets.length > 0) {
        const connection = getSolanaConnection();
        await Promise.all(
          selectedWallets.map(async (wallet) => {
            const balanceLamports = await connection.getBalance(
              new PublicKey(wallet.publicKey)
            );
            const balanceSol = balanceLamports / 1_000_000_000;
            if (balanceSol >= FEE_BUFFER_SOL) {
              return;
            }
            const topUpSol = FEE_BUFFER_SOL - balanceSol;
            if (topUpSol <= 0) {
              return;
            }
            await walletService.sendSolFromMainWallet(
              token.publicKey,
              userId,
              [wallet.publicKey],
              topUpSol
            );
          })
        );
      }
    } catch (error) {
      await prisma.volumeBotSession.update({
        where: { id: session.id },
        data: { status: "FAILED", stoppedAt: new Date() },
      });
      const message = error instanceof Error ? error.message : String(error);
      throw new AppError(message, 500);
    }

    await volumeBotTimer.scheduleSession(session.id);
    return {
      sessionId: session.id,
      targetSolApplied,
      selectedWalletCount: selectedWallets.length,
      generatedWalletCount: keypairs.length,
    };
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
    const totalPnlSol = Number(session.totalPnlSol ?? 0) || 0;
    return { session: { ...session, totalPnlSol }, wallets };
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

  async listEligibleWallets(input: VolumeBotEligibleWalletsInput, userId: string) {
    const { token, wallets } = await resolveEligibleWallets(
      input.tokenPublicKey,
      userId
    );
    const walletPublicKeys = wallets.map((wallet) => wallet.publicKey);
    const mintPublicKey = new PublicKey(token.publicKey);
    const { balances } = await fetchTokenBalances(mintPublicKey, walletPublicKeys);
    const balanceMap = new Map(
      balances.map((balance) => [balance.walletPublicKey, balance])
    );
    let quoteState: Awaited<ReturnType<typeof fetchPumpQuoteState>> | null = null;
    try {
      quoteState = await fetchPumpQuoteState(mintPublicKey, quotePayer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[VolumeBot] Failed to fetch quote state: ${message}`);
    }
    const tokenSolMap = new Map<string, number>();
    if (quoteState) {
      const priceLamportsPerToken =
        Number(quoteState.virtualSolReserves) /
        Number(quoteState.virtualTokenReserves);
      for (const balance of balances) {
        const { netSolOut } = computeSellQuote(
          quoteState,
          balance.tokenBalanceRaw
        );
        let tokenBalanceSol = Number(netSolOut) / 1_000_000_000;
        if (
          tokenBalanceSol === 0 &&
          balance.tokenBalanceRaw > BigInt(0) &&
          Number.isFinite(priceLamportsPerToken)
        ) {
          tokenBalanceSol =
            (balance.tokenBalanceUi * priceLamportsPerToken) / 1_000_000_000;
        }
        tokenSolMap.set(balance.walletPublicKey, tokenBalanceSol);
      }
    }
    return {
      token,
      wallets: wallets.map((wallet) => {
        const balance = balanceMap.get(wallet.publicKey);
        return {
          publicKey: wallet.publicKey,
          type: wallet.type,
          balanceSol: wallet.balanceSol,
          balanceRefreshedAt: wallet.balanceRefreshedAt,
          tokenBalanceUi: balance?.tokenBalanceUi ?? 0,
          tokenBalanceRaw: balance?.tokenBalanceRaw?.toString() ?? "0",
          tokenDecimals: balance?.tokenDecimals ?? 0,
          tokenBalanceSol: tokenSolMap.get(wallet.publicKey) ?? null,
        };
      }),
    };
  },

  async getSelectionSummary(
    input: VolumeBotSelectionSummaryInput,
    userId: string
  ) {
    const { token, wallets } = await resolveEligibleWallets(
      input.tokenPublicKey,
      userId
    );
    const selectedWallets = wallets.filter((wallet) =>
      input.selectedWalletPublicKeys.includes(wallet.publicKey)
    );
    if (input.selectedWalletPublicKeys.length !== selectedWallets.length) {
      throw new AppError("Selected wallets are not eligible for this token", 400);
    }
    const mintPublicKey = new PublicKey(token.publicKey);
    const { balances, tokenDecimals } = await fetchTokenBalances(
      mintPublicKey,
      input.selectedWalletPublicKeys
    );
    const totalTokenRaw = balances.reduce(
      (sum, balance) => sum + balance.tokenBalanceRaw,
      BigInt(0)
    );
    const totalTokenUi = balances.reduce(
      (sum, balance) => sum + balance.tokenBalanceUi,
      0
    );
    let maxNetSolOutSol = 0;
    let priceUnavailable = false;
    try {
      const quoteState = await fetchPumpQuoteState(mintPublicKey, quotePayer);
      const { netSolOut } = computeSellQuote(quoteState, totalTokenRaw);
      maxNetSolOutSol = Number(netSolOut) / 1_000_000_000;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[VolumeBot] Selection quote failed: ${message}`);
      priceUnavailable = true;
    }
    const targetSol = input.targetSol ?? null;
    const targetSolApplied =
      input.strategy === "dump" && targetSol !== null && !priceUnavailable
        ? Math.min(targetSol, maxNetSolOutSol)
        : targetSol;
    const insufficient =
      input.strategy === "dump" &&
      targetSol !== null &&
      !priceUnavailable &&
      targetSol > maxNetSolOutSol;

    return {
      token,
      selectedWallets: balances.map((balance) => {
        const wallet = selectedWallets.find(
          (item) => item.publicKey === balance.walletPublicKey
        );
        return {
          publicKey: balance.walletPublicKey,
          type: wallet?.type ?? "VOLUME",
          tokenBalanceUi: balance.tokenBalanceUi,
          tokenBalanceRaw: balance.tokenBalanceRaw.toString(),
          tokenDecimals: balance.tokenDecimals,
        };
      }),
      totalTokenUi,
      tokenDecimals,
      estimatedNetSolOut: maxNetSolOutSol,
      targetSol,
      targetSolApplied,
      insufficient,
      priceUnavailable,
    };
  },

  async getLogs(sessionId: string, userId: string) {
    return await prisma.volumeBotLog.findMany({
      where: { sessionId, session: { userId } },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
  },
};

export type VolumeBotSessionItem = Awaited<
  ReturnType<typeof volumeBotService.listSessions>
>[number];
