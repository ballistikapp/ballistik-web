import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { prisma } from "@/lib/prisma";
import { getVolumeBotConfig } from "@/lib/config/volume-bot.config";
import { rpcConfig } from "@/lib/config/rpc.config";
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
import {
  computeSellQuote,
  fetchPumpQuoteState,
} from "@/server/solana/pump-quotes";

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getAverageRangeAmount = (range: VolumeBotConfigInput["ranges"][number]) =>
  (range.solMin + range.solMax) / 2;

const getAverageRangeInterval = (
  range: VolumeBotConfigInput["ranges"][number]
) => (range.intervalMin + range.intervalMax) / 2;

const getRangeSellProbability = (
  range: VolumeBotConfigInput["ranges"][number]
) => {
  if (range.direction === "buy") {
    return 0;
  }
  if (range.direction === "sell") {
    return 1;
  }
  return 1 - (range.buyProbability ?? 0);
};

const computeNetSolDirection = (ranges: VolumeBotConfigInput["ranges"]) => {
  return ranges.reduce((sum, range) => {
    const avgAmount = getAverageRangeAmount(range);
    if (range.direction === "buy") {
      return sum + avgAmount;
    }
    if (range.direction === "sell") {
      return sum - avgAmount;
    }
    const buyProbability = range.buyProbability ?? 0;
    return sum + avgAmount * (2 * buyProbability - 1);
  }, 0);
};

const computeNetSolRanges = (
  ranges: VolumeBotConfigInput["ranges"],
  totalWalletCount: number,
  targetDurationSeconds: number
) => {
  let minPerMinute = 0;
  let maxPerMinute = 0;
  for (const range of ranges) {
    const avgInterval = getAverageRangeInterval(range);
    if (avgInterval <= 0) continue;
    const tradesPerMinute = (60 / avgInterval) * totalWalletCount;
    if (range.direction === "buy") {
      minPerMinute += range.solMin * tradesPerMinute;
      maxPerMinute += range.solMax * tradesPerMinute;
    } else if (range.direction === "sell") {
      minPerMinute -= range.solMax * tradesPerMinute;
      maxPerMinute -= range.solMin * tradesPerMinute;
    } else {
      const buyProbability = range.buyProbability ?? 0;
      const sellProbability = 1 - buyProbability;
      minPerMinute +=
        (buyProbability * range.solMin - sellProbability * range.solMax) *
        tradesPerMinute;
      maxPerMinute +=
        (buyProbability * range.solMax - sellProbability * range.solMin) *
        tradesPerMinute;
    }
  }
  const minutes = targetDurationSeconds / 60;
  return {
    perMinute: { min: minPerMinute, max: maxPerMinute },
    total: { min: minPerMinute * minutes, max: maxPerMinute * minutes },
  };
};

const computeVolumeEstimates = (
  ranges: VolumeBotConfigInput["ranges"],
  totalWalletCount: number,
  targetDurationSeconds: number
) => {
  let minPerMinute = 0;
  let maxPerMinute = 0;
  for (const range of ranges) {
    minPerMinute +=
      ((range.solMin * 60) / range.intervalMax) * totalWalletCount;
    maxPerMinute +=
      ((range.solMax * 60) / range.intervalMin) * totalWalletCount;
  }
  const minutes = targetDurationSeconds / 60;
  return {
    perMinute: { min: minPerMinute, max: maxPerMinute },
    total: { min: minPerMinute * minutes, max: maxPerMinute * minutes },
  };
};

const computeSuggestedFunding = (
  ranges: VolumeBotConfigInput["ranges"],
  totalWalletCount: number,
  targetDurationSeconds: number
) => {
  let estimatedTradesPerWallet = 0;
  let totalVolumePerWallet = 0;
  for (const range of ranges) {
    const avgInterval = getAverageRangeInterval(range);
    const avgAmount = getAverageRangeAmount(range);
    if (avgInterval > 0) {
      const tradesFromRange = targetDurationSeconds / avgInterval;
      estimatedTradesPerWallet += tradesFromRange;
      totalVolumePerWallet += tradesFromRange * avgAmount;
    }
  }
  const avgIntervalWeighted =
    estimatedTradesPerWallet > 0
      ? targetDurationSeconds / estimatedTradesPerWallet
      : 0;
  const avgTradeSizeWeighted =
    estimatedTradesPerWallet > 0
      ? totalVolumePerWallet / estimatedTradesPerWallet
      : 0;
  const netSolDirection = computeNetSolDirection(ranges);
  const totalExpectedVolume = totalVolumePerWallet * totalWalletCount;
  const bufferMultiplier =
    netSolDirection > 0 && totalExpectedVolume > 0
      ? clampNumber(1 + netSolDirection / totalExpectedVolume, 1, 2)
      : 1;
  const baseFunding = totalVolumePerWallet;
  const suggestedFunding =
    Math.ceil(baseFunding * bufferMultiplier * 1.1 * 100) / 100;
  return {
    avgIntervalWeighted,
    avgTradeSizeWeighted,
    estimatedTradesPerWallet,
    netSolDirection,
    totalExpectedVolume,
    bufferMultiplier,
    baseFunding,
    suggestedFunding,
  };
};

const computeEstimatedSellVolume = (
  ranges: VolumeBotConfigInput["ranges"],
  estimatedTradesPerWallet: number,
  totalWalletCount: number
) => {
  let totalRate = 0;
  let sellVolumeRate = 0;
  for (const range of ranges) {
    const avgInterval = getAverageRangeInterval(range);
    const avgAmount = getAverageRangeAmount(range);
    const sellProbability = getRangeSellProbability(range);
    if (avgInterval > 0) {
      const rate = 1 / avgInterval;
      totalRate += rate;
      sellVolumeRate += rate * sellProbability * avgAmount;
    }
  }
  if (totalRate <= 0) return 0;
  const sellVolumePerTrade = sellVolumeRate / totalRate;
  return sellVolumePerTrade * estimatedTradesPerWallet * totalWalletCount;
};

const validateSchedule = (
  config: VolumeBotConfigInput,
  scheduledStartAt?: Date,
  scheduledStopAt?: Date
) => {
  const limits = getVolumeBotConfig();
  if (scheduledStartAt) {
    const delayMs = scheduledStartAt.getTime() - Date.now();
    if (delayMs <= 0) {
      throw new AppError("Scheduled start time must be in the future", 400);
    }
    if (delayMs > 30 * 24 * 60 * 60 * 1000) {
      throw new AppError("Scheduled start must be within 30 days", 400);
    }
  }
  const effectiveStart = scheduledStartAt ?? new Date();
  if (scheduledStopAt) {
    const durationMs = scheduledStopAt.getTime() - effectiveStart.getTime();
    if (durationMs <= 0) {
      throw new AppError("Scheduled stop must be after start time", 400);
    }
    if (durationMs > limits.maxDurationSeconds * 1000) {
      throw new AppError(
        `Scheduled stop exceeds maximum duration of ${limits.maxDurationHours} hours`,
        400
      );
    }
  }
  if (config.targetDurationSeconds > limits.maxDurationSeconds) {
    throw new AppError(
      `Duration exceeds maximum of ${limits.maxDurationHours} hours`,
      400
    );
  }
};

const resolveScheduledStopAt = (
  config: VolumeBotConfigInput,
  scheduledStartAt: Date | null,
  scheduledStopAt?: Date
) => {
  if (scheduledStopAt) {
    return scheduledStopAt;
  }
  const startAt = scheduledStartAt ?? new Date();
  return new Date(startAt.getTime() + config.targetDurationSeconds * 1000);
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
  const fractionStr = fraction.toString().padStart(decimals, "0").slice(0, 6);
  return Number(`${integer.toString()}.${fractionStr}`);
};

const RPC_BATCH_SIZE = rpcConfig.tuning.solBalanceBatchSize;
const RPC_BATCH_CONCURRENCY = rpcConfig.tuning.tokenBalanceConcurrency;

const fetchTokenBalances = async (
  mintPublicKey: PublicKey,
  walletPublicKeys: string[]
) => {
  if (walletPublicKeys.length === 0) {
    return {
      balances: [],
      tokenDecimals: await getMintDecimals(mintPublicKey),
    };
  }
  const connection = getSolanaConnection();
  const tokenDecimals = await getMintDecimals(mintPublicKey);
  const atas = await Promise.all(
    walletPublicKeys.map((walletPublicKey) =>
      getAssociatedTokenAddress(mintPublicKey, new PublicKey(walletPublicKey))
    )
  );

  const batches: PublicKey[][] = [];
  for (let i = 0; i < atas.length; i += RPC_BATCH_SIZE) {
    batches.push(atas.slice(i, i + RPC_BATCH_SIZE));
  }

  const allAccountInfos: (
    | Awaited<
        ReturnType<typeof connection.getMultipleParsedAccounts>
      >["value"][number]
    | null
  )[] = new Array(atas.length).fill(null);

  for (let i = 0; i < batches.length; i += RPC_BATCH_CONCURRENCY) {
    const concurrentBatches = batches.slice(i, i + RPC_BATCH_CONCURRENCY);
    const results = await Promise.all(
      concurrentBatches.map((batch) =>
        connection.getMultipleParsedAccounts(batch)
      )
    );
    let offset = i * RPC_BATCH_SIZE;
    for (const result of results) {
      for (const accountInfo of result.value) {
        allAccountInfos[offset++] = accountInfo;
      }
    }
  }

  const balances = walletPublicKeys.map((walletPublicKey, index) => {
    const accountInfo = allAccountInfos[index];
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
  const wallets = [...operationalWallets].filter(
    (wallet) => wallet.publicKey !== mainWalletPublicKey
  );

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
        status: { in: ["SCHEDULED", "RUNNING", "STOP_REQUESTED", "STOPPING"] },
      },
      select: { id: true },
    });

    if (activeSession) {
      throw new AppError("Volume bot already running for this token", 409);
    }

    const selectedWalletPublicKeys = Array.from(
      new Set(input.config.walletConfig.selectedWalletPublicKeys ?? [])
    );
    const selectedWallets = eligibleWallets.filter((wallet) =>
      selectedWalletPublicKeys.includes(wallet.publicKey)
    );
    if (selectedWalletPublicKeys.length !== selectedWallets.length) {
      throw new AppError(
        "Selected wallets are not eligible for this token",
        400
      );
    }
    const missingKey = selectedWallets.find((wallet) => !wallet.privateKey);
    if (missingKey) {
      throw new AppError("Selected wallet is missing a private key", 400);
    }
    const totalWalletCount =
      selectedWallets.length + input.config.walletConfig.generatedWalletCount;
    validateSchedule(
      input.config,
      input.scheduledStartAt,
      input.scheduledStopAt
    );
    const scheduledStartAt = input.scheduledStartAt ?? null;
    const scheduledStopAt = resolveScheduledStopAt(
      input.config,
      scheduledStartAt,
      input.scheduledStopAt
    );
    const now = new Date();
    const isScheduled = scheduledStartAt ? scheduledStartAt > now : false;
    const status = isScheduled ? "SCHEDULED" : "RUNNING";
    const startedAt = isScheduled ? null : now;

    const netSolDirection = computeNetSolDirection(input.config.ranges);
    if (netSolDirection < 0) {
      if (selectedWallets.length === 0) {
        throw new AppError(
          "Net sell sessions require wallets with token holdings",
          400
        );
      }
      const mintPublicKey = new PublicKey(token.publicKey);
      const { balances } = await fetchTokenBalances(
        mintPublicKey,
        selectedWalletPublicKeys
      );
      const totalTokenRaw = balances.reduce(
        (sum, balance) => sum + balance.tokenBalanceRaw,
        BigInt(0)
      );
      if (totalTokenRaw === BigInt(0)) {
        throw new AppError(
          "Net sell sessions require wallets with token holdings",
          400
        );
      }
    }

    const keypairs = Array.from(
      { length: input.config.walletConfig.generatedWalletCount },
      () => Keypair.generate()
    );

    const session = await prisma.$transaction(async (tx) => {
      const configSnapshot = {
        ...input.config,
        walletConfig: {
          ...input.config.walletConfig,
          selectedWalletPublicKeys,
        },
      };
      console.log("[VolumeBot] Starting session", {
        tokenPublicKey: token.publicKey,
        userId,
        config: {
          ...configSnapshot,
          selectedWalletCount: selectedWallets.length,
          generatedWalletCount: keypairs.length,
        },
        scheduledStartAt,
        scheduledStopAt,
      });
      const createdSession = await tx.volumeBotSession.create({
        data: {
          userId,
          tokenPublicKey: token.publicKey,
          status,
          config: configSnapshot,
          scheduledStartAt,
          startedAt,
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
            nextTickAt: null,
          })),
        });
      }

      if (keypairs.length > 0) {
        await tx.volumeBotWallet.createMany({
          data: keypairs.map((keypair) => ({
            sessionId: createdSession.id,
            walletPublicKey: keypair.publicKey.toBase58(),
            nextTickAt: null,
          })),
        });
      }

      return createdSession;
    });

    if (status === "RUNNING") {
      const walletPublicKeys = keypairs.map((keypair) =>
        keypair.publicKey.toBase58()
      );
      const fundingAmountSol = Math.max(
        input.config.walletConfig.fundingPerGeneratedWallet,
        0
      );
      try {
        if (walletPublicKeys.length > 0) {
          console.log(
            `[VolumeBot] Funding ${walletPublicKeys.length} generated wallets with ${fundingAmountSol} SOL`
          );
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
              if (balanceSol >= input.config.walletConfig.topUpAmount) {
                console.log(
                  `[VolumeBot] Wallet ${wallet.publicKey} has sufficient balance (${balanceSol} SOL)`
                );
                return;
              }
              const topUpSol =
                input.config.walletConfig.topUpAmount - balanceSol;
              if (topUpSol <= 0) {
                return;
              }
              console.log(
                `[VolumeBot] Topping up wallet ${wallet.publicKey} by ${topUpSol} SOL`
              );
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
    }

    await volumeBotTimer.scheduleSession(session.id);
    return {
      sessionId: session.id,
      selectedWalletCount: selectedWallets.length,
      generatedWalletCount: keypairs.length,
      scheduledStartAt,
      scheduledStopAt,
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
        ...(input.tokenPublicKey
          ? { tokenPublicKey: input.tokenPublicKey }
          : {}),
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
            wallet: { select: { type: true } },
          },
        },
      },
    });

    if (!sessionWithWallets) {
      throw new AppError("Volume bot session not found", 404);
    }

    const { wallets, ...session } = sessionWithWallets;
    const totalPnlSol = Number(session.totalPnlSol ?? 0) || 0;
    const runtimeSeconds = session.runtimeSeconds || 0;
    const runtimeMinutes = runtimeSeconds / 60;
    const netDeltaSolPerMinute =
      runtimeMinutes > 0 ? totalPnlSol / runtimeMinutes : 0;

    const config = session.config as VolumeBotConfigInput | undefined;
    const ranges = config?.ranges ?? [];
    const rangeMetrics = ranges.map((range, index) => {
      const avgAmount = getAverageRangeAmount(range);
      const avgInterval = getAverageRangeInterval(range);
      let expectedNetDeltaPerTrade = 0;
      if (range.direction === "buy") {
        expectedNetDeltaPerTrade = avgAmount;
      } else if (range.direction === "sell") {
        expectedNetDeltaPerTrade = -avgAmount;
      } else {
        const buyProbability = range.buyProbability ?? 0;
        expectedNetDeltaPerTrade = avgAmount * (2 * buyProbability - 1);
      }
      const tradesPerMinute = avgInterval > 0 ? 60 / avgInterval : 0;
      const expectedNetDeltaPerMinute =
        expectedNetDeltaPerTrade * tradesPerMinute;
      const totalWalletCount = wallets.length || 1;
      const expectedNetDeltaPerMinuteTotal =
        expectedNetDeltaPerMinute * totalWalletCount;

      return {
        rangeIndex: index,
        expectedNetDeltaSolPerTrade: expectedNetDeltaPerTrade,
        expectedNetDeltaSolPerMinute: expectedNetDeltaPerMinuteTotal,
      };
    });

    return {
      session: { ...session, totalPnlSol, netDeltaSolPerMinute },
      wallets,
      rangeMetrics,
    };
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
    console.log(
      `[VolumeBot] Session ${sessionId} current status: ${session.status}`
    );

    if (["STOPPED", "FAILED"].includes(session.status)) {
      console.log(
        `[VolumeBot] Session ${sessionId} already completed, skipping`
      );
      return { sessionId: session.id };
    }

    if (!["STOP_REQUESTED", "STOPPING"].includes(session.status)) {
      await prisma.volumeBotSession.update({
        where: { id: session.id },
        data: { status: "STOP_REQUESTED", stopRequestedAt: new Date() },
      });
      console.log(`[VolumeBot] Session ${sessionId} marked as STOP_REQUESTED`);
    } else {
      console.log(
        `[VolumeBot] Session ${sessionId} already stopping, retrying stop`
      );
    }

    console.log(
      `[VolumeBot] Calling volumeBotTimer.requestStop for ${sessionId}`
    );
    volumeBotTimer
      .requestStop(session.id)
      .then(() => {
        console.log(
          `[VolumeBot] requestStop promise resolved for ${sessionId}`
        );
      })
      .catch((error) => {
        console.error(
          `[VolumeBot] requestStop failed for ${session.id}:`,
          error
        );
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
        ...(input.tokenPublicKey
          ? { tokenPublicKey: input.tokenPublicKey }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: input.limit,
    });
  },

  async listEligibleWallets(
    input: VolumeBotEligibleWalletsInput,
    userId: string
  ) {
    const { token, wallets } = await resolveEligibleWallets(
      input.tokenPublicKey,
      userId
    );
    const walletPublicKeys = wallets.map((wallet) => wallet.publicKey);
    const mintPublicKey = new PublicKey(token.publicKey);
    const { balances } = await fetchTokenBalances(
      mintPublicKey,
      walletPublicKeys
    );
    const balanceMap = new Map(
      balances.map((balance) => [balance.walletPublicKey, balance])
    );
    let quoteState: Awaited<ReturnType<typeof fetchPumpQuoteState>> | null =
      null;
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
    const selectedWalletPublicKeys = Array.from(
      new Set(input.config.walletConfig.selectedWalletPublicKeys ?? [])
    );
    const selectedWallets = wallets.filter((wallet) =>
      selectedWalletPublicKeys.includes(wallet.publicKey)
    );
    if (selectedWalletPublicKeys.length !== selectedWallets.length) {
      throw new AppError(
        "Selected wallets are not eligible for this token",
        400
      );
    }
    const mintPublicKey = new PublicKey(token.publicKey);
    let balances: Awaited<ReturnType<typeof fetchTokenBalances>>["balances"] =
      [];
    let tokenDecimals = 0;
    try {
      const tokenData = await fetchTokenBalances(
        mintPublicKey,
        selectedWalletPublicKeys
      );
      balances = tokenData.balances;
      tokenDecimals = tokenData.tokenDecimals;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[VolumeBot] Failed to fetch token balances: ${message}`);
    }

    const totalWalletCount =
      input.config.walletConfig.generatedWalletCount +
      selectedWalletPublicKeys.length;
    const netSolDirection = computeNetSolDirection(input.config.ranges);
    const hasSellRanges = input.config.ranges.some(
      (range) => range.direction !== "buy"
    );
    const fundingMetrics = computeSuggestedFunding(
      input.config.ranges,
      totalWalletCount,
      input.config.targetDurationSeconds
    );
    const volumeEstimates = computeVolumeEstimates(
      input.config.ranges,
      totalWalletCount,
      input.config.targetDurationSeconds
    );
    const netSolRanges = computeNetSolRanges(
      input.config.ranges,
      totalWalletCount,
      input.config.targetDurationSeconds
    );
    const estimatedSellVolume = computeEstimatedSellVolume(
      input.config.ranges,
      fundingMetrics.estimatedTradesPerWallet,
      totalWalletCount
    );

    let totalSellableValue = 0;
    let priceUnavailable = false;
    try {
      const quoteState = await fetchPumpQuoteState(mintPublicKey, quotePayer);
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
        totalSellableValue += tokenBalanceSol;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[VolumeBot] Selection quote failed: ${message}`);
      priceUnavailable = true;
    }
    const sellWarning =
      hasSellRanges &&
      netSolDirection >= 0 &&
      !priceUnavailable &&
      totalSellableValue > 0 &&
      estimatedSellVolume > totalSellableValue * 0.5;

    return {
      token,
      tokenDecimals,
      selectedWalletCount: selectedWallets.length,
      totalWalletCount,
      netSolDirection,
      netSolRangePerMinute: netSolRanges.perMinute,
      netSolRangeTotal: netSolRanges.total,
      hasSellRanges,
      volumePerMinute: volumeEstimates.perMinute,
      totalVolume: volumeEstimates.total,
      avgIntervalWeighted: fundingMetrics.avgIntervalWeighted,
      avgTradeSizeWeighted: fundingMetrics.avgTradeSizeWeighted,
      estimatedTradesPerWallet: fundingMetrics.estimatedTradesPerWallet,
      suggestedFundingPerGeneratedWallet: fundingMetrics.suggestedFunding,
      fundingBelowSuggested:
        input.config.walletConfig.fundingPerGeneratedWallet <
        fundingMetrics.suggestedFunding,
      estimatedSellVolume,
      totalSellableValue: priceUnavailable ? null : totalSellableValue,
      sellWarning,
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
