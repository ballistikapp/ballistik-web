import { AnchorProvider, BN } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSolanaConnection } from "@/lib/solana/connection";
import { rpcLimiter } from "@/lib/solana/rpc-limiter";
import { mapWithConcurrency } from "@/lib/utils/async";
import { getPumpProgram } from "@/server/solana/pump-idl";
import { buildBuyTokenTransaction } from "@/server/solana/pump-transaction-builders";
import { sellTokensWithNewIdl } from "@/server/solana/pump-new-idl";
import {
  computeBuyQuote,
  computeSellQuote,
  estimateTokenAmountForNetSolOut,
  computeMinSolOutForSell,
  computeMinTokensOutForBuy,
  fetchPumpQuoteState,
} from "@/server/solana/pump-quotes";
import { volumeBotGrpc } from "@/server/solana/volume-bot-grpc";
import type { VolumeBotConfigInput } from "@/server/schemas/volume-bot.schema";
import { getVolumeBotConfig } from "@/lib/config/volume-bot.config";
import { walletService } from "@/server/services/wallet.service";
import { shyftCallbackService } from "@/server/services/shyft-callback.service";

type VolumeBotWalletWithRelations = Prisma.VolumeBotWalletGetPayload<{
  include: { session: true; wallet: true };
}>;

type StoredVolumeBotConfig = VolumeBotConfigInput;

type VolumeBotAction = "BUY" | "SELL";

const getTokenBalance = async (
  walletPublicKey: PublicKey,
  mintPublicKey: PublicKey
) => {
  const connection = getSolanaConnection();
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
    walletPublicKey,
    { mint: mintPublicKey }
  );
  if (tokenAccounts.value.length === 0) {
    return BigInt(0);
  }
  const amount =
    tokenAccounts.value[0]?.account.data.parsed.info.tokenAmount.amount;
  return BigInt(amount ?? "0");
};

const randomBetween = (min: number, max: number) =>
  Math.random() * (max - min) + min;

const FEE_BUFFER_LAMPORTS = 3_000_000;
const SELL_RATIO_BPS = 10_000;
const FEE_TOP_UP_SOL = 0.005;

const inFlightTrades = new Set<string>();
const slippageFailures = new Map<string, number>();

const isFeeError = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  return (
    message.includes("insufficient") ||
    message.includes("not enough") ||
    message.includes("lamports") ||
    message.includes("fee")
  );
};

const isBlockHeightExceeded = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("block height exceeded") ||
    message.includes("blockhash not found") ||
    message.includes("BlockhashNotFound")
  );
};

const addComputeBudget = (
  tx: Transaction,
  computeUnits: number,
  priorityFeeMicroLamports: number
) => {
  const newTx = new Transaction();
  newTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
  if (priorityFeeMicroLamports > 0) {
    newTx.add(
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityFeeMicroLamports,
      })
    );
  }
  newTx.add(...tx.instructions);
  return newTx;
};

const computeNextTickAt = (range: VolumeBotConfigInput["ranges"][number]) => {
  const delaySeconds = Math.floor(
    randomBetween(range.intervalMin, range.intervalMax)
  );
  return new Date(Date.now() + delaySeconds * 1000);
};


const selectDirection = (
  range: VolumeBotConfigInput["ranges"][number]
): VolumeBotAction => {
  if (range.direction === "buy") {
    return "BUY";
  }
  if (range.direction === "sell") {
    return "SELL";
  }
  const r2 = Math.random();
  const buyProbability = range.buyProbability ?? 0;
  return r2 < buyProbability ? "BUY" : "SELL";
};

const buildIncrementSteps = (range: VolumeBotConfigInput["ranges"][number]) => {
  const increment = range.increment ?? 0;
  if (increment <= 0) {
    return [];
  }
  const steps =
    Math.floor((range.solMax - range.solMin) / increment + 1e-9) + 1;
  if (steps < 2) {
    return [];
  }
  return Array.from({ length: steps }, (_, index) => {
    const value = range.solMin + increment * index;
    return Math.min(value, range.solMax);
  });
};

const selectTradeAmountSol = (
  range: VolumeBotConfigInput["ranges"][number]
) => {
  const steps = buildIncrementSteps(range);
  if (steps.length > 1) {
    const index = Math.floor(Math.random() * steps.length);
    return steps[index] ?? range.solMin;
  }
  return randomBetween(range.solMin, range.solMax);
};

const getCooldownSeconds = (range: VolumeBotConfigInput["ranges"][number]) =>
  Math.max(range.intervalMin * 0.5, 0.5);

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const markInFlight = (walletId: string, inFlight: boolean) => {
  if (inFlight) {
    inFlightTrades.add(walletId);
  } else {
    inFlightTrades.delete(walletId);
  }
};


export const processVolumeBotWalletRange = async (
  volumeWallet: VolumeBotWalletWithRelations,
  rangeIndex: number
): Promise<Date | null> => {
  const walletId = volumeWallet.id;
  const walletPk = volumeWallet.walletPublicKey.slice(0, 8);
  console.log(`[Worker] Processing wallet ${walletPk} range ${rangeIndex} (${walletId})`);

  const session = volumeWallet.session;
  if (session.status !== "RUNNING") {
    console.log(
      `[Worker] Skipping ${walletPk}: session not RUNNING (${session.status})`
    );
    return null;
  }

  if (session.scheduledStopAt && session.scheduledStopAt <= new Date()) {
    console.log(`[Worker] Session ${session.id} scheduled stop reached`);
    await stopVolumeBotSession(session.id);
    return null;
  }

  if (volumeWallet.status !== "ACTIVE") {
    console.log(
      `[Worker] Skipping ${walletPk}: wallet not ACTIVE (${volumeWallet.status})`
    );
    return null;
  }
  if (volumeWallet.wallet.type === "DEV") {
    console.log(`[Worker] Skipping ${walletPk}: DEV wallet not allowed`);
    return null;
  }

  const config = session.config as StoredVolumeBotConfig;
  const range = config.ranges[rangeIndex];
  if (!range) {
    console.log(`[Worker] ${walletPk}: Range ${rangeIndex} not found`);
    return null;
  }

  const nextTickAt = computeNextTickAt(range);

  if (Math.random() > range.probability) {
    console.log(`[Worker] ${walletPk} range ${rangeIndex}: Skipping execution (probability check failed)`);
    return nextTickAt;
  }

  if (inFlightTrades.has(walletId)) {
    console.log(`[Worker] ${walletPk} range ${rangeIndex}: Skipping, trade already in flight`);
    return nextTickAt;
  }

  const cooldownSeconds = getCooldownSeconds(range);
  const lastTradeAt = volumeWallet.lastTradeAt;

  const tradeAmountSol = selectTradeAmountSol(range);
  if (!Number.isFinite(tradeAmountSol) || tradeAmountSol <= 0) {
    console.log(`[Worker] ${walletPk} range ${rangeIndex}: Invalid trade amount`);
    return nextTickAt;
  }

  const action = selectDirection(range);
  console.log(
    `[Worker] ${walletPk} range ${rangeIndex}: Selected action=${action} (range=${range.solMin}-${range.solMax}, interval=${range.intervalMin}-${range.intervalMax})`
  );

  const connection = getSolanaConnection();
  const mintPublicKey = new PublicKey(session.tokenPublicKey);
  const walletKeypair = Keypair.fromSecretKey(
    bs58.decode(volumeWallet.wallet.privateKey)
  );

  const requiredLamports =
    action === "BUY"
      ? Math.floor(tradeAmountSol * 1_000_000_000) + FEE_BUFFER_LAMPORTS
      : FEE_BUFFER_LAMPORTS;

  const checkEligibility = async () => {
    const reasons: string[] = [];
    if (inFlightTrades.has(walletId)) {
      reasons.push("in_flight");
    }
    if (
      lastTradeAt &&
      Date.now() - lastTradeAt.getTime() <= cooldownSeconds * 1000
    ) {
      reasons.push("cooldown");
    }

    const walletPubkeyStr = walletKeypair.publicKey.toBase58();
    const mintPubkeyStr = mintPublicKey.toBase58();

    let solBalanceLamports = volumeBotGrpc.getSolBalance(walletPubkeyStr);
    let tokenBalance = volumeBotGrpc.getTokenBalance(
      walletPubkeyStr,
      mintPubkeyStr
    );

    const needsSolFetch = solBalanceLamports === null;
    const needsTokenFetch = tokenBalance === null;

    if (needsSolFetch || needsTokenFetch) {
      const rpcCallCount = (needsSolFetch ? 1 : 0) + (needsTokenFetch ? 1 : 0);
      await rpcLimiter.acquire(rpcCallCount);

      const [fetchedSol, fetchedToken] = await Promise.all([
        needsSolFetch
          ? connection.getBalance(walletKeypair.publicKey)
          : Promise.resolve(null),
        needsTokenFetch
          ? getTokenBalance(walletKeypair.publicKey, mintPublicKey)
          : Promise.resolve(null),
      ]);

      if (fetchedSol !== null) solBalanceLamports = fetchedSol;
      if (fetchedToken !== null) tokenBalance = fetchedToken;
    }

    const finalSolBalance = solBalanceLamports ?? 0;
    const finalTokenBalance = tokenBalance ?? BigInt(0);

    if (action === "BUY" && finalSolBalance < requiredLamports) {
      reasons.push("insufficient_sol");
    }
    if (action === "SELL" && finalTokenBalance <= BigInt(0)) {
      reasons.push("no_tokens");
    }
    return {
      reasons,
      solBalanceLamports: finalSolBalance,
      tokenBalance: finalTokenBalance,
    };
  };

  let eligibility: {
    reasons: string[];
    solBalanceLamports: number;
    tokenBalance: bigint;
  } | null = null;
  let eligible = false;
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    const result = await checkEligibility();
    eligibility = result;
    if (result.reasons.length === 0) {
      eligible = true;
      break;
    }
    if (attempt < 3) {
      await sleep(5000);
    }
  }

  if (!eligible || !eligibility) {
    await prisma.volumeBotLog.create({
      data: {
        sessionId: session.id,
        level: "WARN",
        type: "eligibility",
        message: "Wallet not eligible for trade",
        walletPublicKey: volumeWallet.walletPublicKey,
        data: {
          reasons: eligibility?.reasons ?? [],
          action,
          tradeAmountSol,
          rangeIndex,
        },
      },
    });
    return nextTickAt;
  }

  let solBalanceLamports = eligibility.solBalanceLamports;
  let tokenBalance = eligibility.tokenBalance;
  let signature: string | null = null;
  let tokenAmount = BigInt(0);
  let sellMode: string | null = null;

  const topUpForFees = async () => {
    try {
      await walletService.sendSolFromMainWallet(
        session.tokenPublicKey,
        session.userId,
        [volumeWallet.walletPublicKey],
        FEE_TOP_UP_SOL
      );
      solBalanceLamports = await connection.getBalance(walletKeypair.publicKey);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Worker] ${walletPk}: Fee top-up failed: ${message}`);
      return false;
    }
  };

  markInFlight(walletId, true);

  const globalConfig = getVolumeBotConfig();
  const priorityFee =
    config.behaviorConfig.priorityFeeMicroLamports ??
    globalConfig.defaultPriorityFeeMicroLamports;
  const computeUnits =
    config.behaviorConfig.computeUnitLimit ??
    globalConfig.defaultComputeUnitLimit;
  const maxRetries =
    config.behaviorConfig.maxRetries ?? globalConfig.defaultMaxRetries;

  try {
    if (action === "BUY") {
      const buyLamports = BigInt(Math.floor(tradeAmountSol * 1_000_000_000));
      let minTokensOut = new BN(1);
      try {
        const quoteState = await fetchPumpQuoteState(
          mintPublicKey,
          walletKeypair
        );
        minTokensOut = computeMinTokensOutForBuy(
          quoteState,
          buyLamports,
          config.behaviorConfig.slippageBps
        );
        const buyQuote = computeBuyQuote(quoteState, buyLamports);
        tokenAmount = buyQuote.tokensOut;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[Worker] ${walletPk}: Slippage quote failed (buy): ${message}`
        );
      }
      let baseBuyTx = await buildBuyTokenTransaction(
        walletKeypair,
        mintPublicKey,
        buyLamports,
        undefined,
        minTokensOut
      );
      baseBuyTx = addComputeBudget(baseBuyTx, computeUnits, priorityFee);

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const { blockhash, lastValidBlockHeight } =
            await connection.getLatestBlockhash("confirmed");
          baseBuyTx.recentBlockhash = blockhash;
          baseBuyTx.lastValidBlockHeight = lastValidBlockHeight;
          baseBuyTx.feePayer = walletKeypair.publicKey;
          signature = await sendAndConfirmTransaction(connection, baseBuyTx, [
            walletKeypair,
          ]);
          break;
        } catch (error) {
          if (isFeeError(error)) {
            const toppedUp = await topUpForFees();
            if (toppedUp) continue;
          }
          if (isBlockHeightExceeded(error) && attempt < maxRetries) {
            console.log(
              `[Worker] ${walletPk}: Block height exceeded, retry ${attempt + 1}/${maxRetries}`
            );
            await sleep(1000);
            continue;
          }
          throw error;
        }
      }
    } else {
      if (tokenBalance <= BigInt(0)) {
        await prisma.volumeBotLog.create({
          data: {
            sessionId: session.id,
            level: "WARN",
            type: "sell_skipped",
            message: "Sell skipped: no tokens",
            walletPublicKey: volumeWallet.walletPublicKey,
            data: { rangeIndex },
          },
        });
        return nextTickAt;
      }

      const desiredNetSolLamports = BigInt(
        Math.floor(tradeAmountSol * 1_000_000_000)
      );
      const quoteState = await fetchPumpQuoteState(
        mintPublicKey,
        walletKeypair
      );
      const requiredTokens = estimateTokenAmountForNetSolOut(
        quoteState,
        desiredNetSolLamports,
        tokenBalance
      );
      if (requiredTokens > BigInt(0) && tokenBalance >= requiredTokens) {
        tokenAmount = requiredTokens;
        sellMode = "target";
      } else if (
        requiredTokens > BigInt(0) &&
        tokenBalance >= requiredTokens / BigInt(2)
      ) {
        tokenAmount = tokenBalance;
        sellMode = "partial_all";
        console.log(
          `[Worker] ${walletPk}: Partial sell, target ${tradeAmountSol} SOL, selling all tokens`
        );
      } else {
        const fallbackRatio = Math.min(
          Math.max(config.behaviorConfig.sellFallbackRatio, 0),
          1
        );
        tokenAmount =
          (tokenBalance * BigInt(Math.floor(fallbackRatio * SELL_RATIO_BPS))) /
          BigInt(SELL_RATIO_BPS);
        sellMode = "fallback_ratio";
        console.log(
          `[Worker] ${walletPk}: Fallback ratio sell, target ${tradeAmountSol} SOL`
        );
      }

      if (tokenAmount <= BigInt(0)) {
        await prisma.volumeBotLog.create({
          data: {
            sessionId: session.id,
            level: "WARN",
            type: "sell_skipped",
            message: "Sell skipped: no tokens",
            walletPublicKey: volumeWallet.walletPublicKey,
            data: { rangeIndex },
          },
        });
        return nextTickAt;
      }

      let minSolOutput = new BN(0);
      try {
        minSolOutput = computeMinSolOutForSell(
          quoteState,
          tokenAmount,
          config.behaviorConfig.slippageBps
        );
        const sellQuote = computeSellQuote(quoteState, tokenAmount);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[Worker] ${walletPk}: Slippage quote failed (sell): ${message}`
        );
      }
      const provider = new AnchorProvider(
        connection,
        new NodeWallet(walletKeypair),
        { commitment: "finalized" }
      );
      const program = getPumpProgram(provider);
      let baseSellTx = await sellTokensWithNewIdl(
        program,
        walletKeypair,
        mintPublicKey,
        new BN(tokenAmount.toString()),
        minSolOutput
      );
      baseSellTx = addComputeBudget(baseSellTx, computeUnits, priorityFee);

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const { blockhash, lastValidBlockHeight } =
            await connection.getLatestBlockhash("confirmed");
          baseSellTx.recentBlockhash = blockhash;
          baseSellTx.lastValidBlockHeight = lastValidBlockHeight;
          baseSellTx.feePayer = walletKeypair.publicKey;
          signature = await sendAndConfirmTransaction(connection, baseSellTx, [
            walletKeypair,
          ]);
          break;
        } catch (error) {
          if (isFeeError(error)) {
            const toppedUp = await topUpForFees();
            if (toppedUp) continue;
          }
          if (isBlockHeightExceeded(error) && attempt < maxRetries) {
            console.log(
              `[Worker] ${walletPk}: Block height exceeded, retry ${attempt + 1}/${maxRetries}`
            );
            await sleep(1000);
            continue;
          }
          throw error;
        }
      }
    }

    const updatedSolLamports = await connection.getBalance(
      walletKeypair.publicKey
    );
    const updatedTokenBalance = await getTokenBalance(
      walletKeypair.publicKey,
      mintPublicKey
    );
    const solDelta = (updatedSolLamports - solBalanceLamports) / 1_000_000_000;
    const appliedNetSolChange =
      action === "BUY" ? Math.abs(solDelta) : -Math.abs(solDelta);
    const now = new Date();
    const actualSolAbs = Math.abs(solDelta);
    let pauseWallet = false;
    if (tradeAmountSol > 0) {
      const slippage = Math.abs(actualSolAbs - tradeAmountSol) / tradeAmountSol;
      if (slippage > config.behaviorConfig.slippageBps / 10000) {
        const nextCount = (slippageFailures.get(walletId) ?? 0) + 1;
        slippageFailures.set(walletId, nextCount);
        if (
          config.behaviorConfig.pauseOnHighSlippage &&
          nextCount >= config.behaviorConfig.maxSlippageFailures
        ) {
          pauseWallet = true;
        }
      } else {
        slippageFailures.set(walletId, 0);
      }
    }

    if (pauseWallet) {
      await prisma.volumeBotWallet.update({
        where: { id: volumeWallet.id },
        data: {
          status: "PAUSED",
          pausedAt: now,
          pauseReason: "High slippage",
          solBalance: updatedSolLamports / 1_000_000_000,
          tokenBalance: Number(updatedTokenBalance) / 1_000_000,
          tradesExecuted: { increment: 1 },
          lastTradeAt: now,
        },
      });
      await prisma.volumeBotSession.update({
        where: { id: session.id },
        data: {
          totalTrades: { increment: 1 },
          totalVolumeUsd: {
            increment: action === "BUY" ? tradeAmountSol : Math.abs(solDelta),
          },
          totalPnlSol: {
            increment: appliedNetSolChange,
          },
          runtimeSeconds: session.startedAt
            ? Math.floor((Date.now() - session.startedAt.getTime()) / 1000)
            : 0,
          lastTickAt: now,
        },
      });
      await prisma.volumeBotLog.create({
        data: {
          sessionId: session.id,
          level: "WARN",
          type: "slippage_pause",
          message: "Wallet paused due to high slippage",
          walletPublicKey: volumeWallet.walletPublicKey,
          data: {
            tradeAmountSol,
            actualSol: actualSolAbs,
            rangeIndex,
          },
        },
      });
      return null;
    }

    await prisma.volumeBotWallet.update({
      where: { id: volumeWallet.id },
      data: {
        solBalance: updatedSolLamports / 1_000_000_000,
        tokenBalance: Number(updatedTokenBalance) / 1_000_000,
        tradesExecuted: { increment: 1 },
        lastTradeAt: now,
      },
    });

    await prisma.volumeBotSession.update({
      where: { id: session.id },
      data: {
        totalTrades: { increment: 1 },
        totalVolumeUsd: {
          increment: action === "BUY" ? tradeAmountSol : Math.abs(solDelta),
        },
        totalPnlSol: {
          increment: appliedNetSolChange,
        },
        runtimeSeconds: session.startedAt
          ? Math.floor((Date.now() - session.startedAt.getTime()) / 1000)
          : 0,
        lastTickAt: now,
      },
    });

    await prisma.volumeBotLog.create({
      data: {
        sessionId: session.id,
        level: "TRADE",
        type: action.toLowerCase(),
        message: "Trade executed",
        walletPublicKey: volumeWallet.walletPublicKey,
        signature,
        data: {
          tradeAmountSol,
          actualSol: actualSolAbs,
          tokenAmount: tokenAmount.toString(),
          netSolChangeSol: appliedNetSolChange,
          sellMode,
          rangeIndex,
        },
      },
    });
    return nextTickAt;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Worker] ${walletPk} range ${rangeIndex}: ERROR - ${message}`);
    if (error instanceof Error && error.stack) {
      console.error(`[Worker] ${walletPk} range ${rangeIndex}: Stack:`, error.stack);
    }
    await prisma.volumeBotLog.create({
      data: {
        sessionId: session.id,
        level: "ERROR",
        type: "tick",
        message,
        walletPublicKey: volumeWallet.walletPublicKey,
        data: { rangeIndex },
      },
    });
    return nextTickAt;
  } finally {
    markInFlight(walletId, false);
  }
};

export const stopVolumeBotSession = async (sessionId: string) => {
  console.log(`[Worker] stopVolumeBotSession called for ${sessionId}`);
  const session = await prisma.volumeBotSession.findUnique({
    where: { id: sessionId },
  });
  if (!session || ["STOPPED", "FAILED"].includes(session.status)) {
    console.log(
      `[Worker] Session ${sessionId} not found or already stopped/failed`
    );
    return;
  }
  console.log(
    `[Worker] Stopping session ${sessionId}, status=${session.status}`
  );

  await prisma.volumeBotSession.update({
    where: { id: session.id },
    data: { status: "STOPPING" },
  });

  try {
    const wallets = await prisma.volumeBotWallet.findMany({
      where: { sessionId: session.id },
      include: { wallet: true },
    });

    const walletPublicKeys = wallets.map((wallet) => wallet.walletPublicKey);
    const reclaimResults = await walletService.returnSolToMainWallet(
      session.tokenPublicKey,
      session.userId,
      walletPublicKeys,
      undefined,
      true
    );

    const now = new Date();
    await prisma.$transaction(
      reclaimResults.map((result) =>
        prisma.volumeBotWallet.updateMany({
          where: { sessionId: session.id, walletPublicKey: result.publicKey },
          data: {
            status: result.signature ? "RECLAIMED" : undefined,
            reclaimedAt: result.signature ? now : undefined,
            reclaimTxSignature: result.signature ?? undefined,
          },
        })
      )
    );

    await prisma.volumeBotSession.update({
      where: { id: session.id },
      data: { status: "STOPPED", stoppedAt: now },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.volumeBotLog.create({
      data: {
        sessionId: session.id,
        level: "ERROR",
        type: "stop",
        message,
      },
    });
    await prisma.volumeBotSession.update({
      where: { id: session.id },
      data: { status: "FAILED", stoppedAt: new Date() },
    });
  }
};

export const reclaimVolumeBotSession = async (sessionId: string) => {
  const session = await prisma.volumeBotSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) {
    return;
  }
  const wallets = await prisma.volumeBotWallet.findMany({
    where: { sessionId: session.id },
  });
  const walletPublicKeys = wallets.map((wallet) => wallet.walletPublicKey);
  const reclaimResults = await walletService.returnSolToMainWallet(
    session.tokenPublicKey,
    session.userId,
    walletPublicKeys,
    undefined,
    true
  );
  const now = new Date();
  await prisma.$transaction(
    reclaimResults.map((result) =>
      prisma.volumeBotWallet.updateMany({
        where: { sessionId: session.id, walletPublicKey: result.publicKey },
        data: {
          status: result.signature ? "RECLAIMED" : undefined,
          reclaimedAt: result.signature ? now : undefined,
          reclaimTxSignature: result.signature ?? undefined,
        },
      })
    )
  );
  await prisma.volumeBotLog.create({
    data: {
      sessionId: session.id,
      level: "INFO",
      type: "reclaim",
      message: "Reclaim requested",
      data: { signatures: reclaimResults.map((result) => result.signature) },
    },
  });

  for (const publicKey of walletPublicKeys) {
    try {
      await shyftCallbackService.removeCallbacksByAddress(publicKey);
    } catch {
      // best-effort cleanup
    }
  }
};

export const closeVolumeBotAccounts = async (sessionId: string) => {
  const session = await prisma.volumeBotSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) {
    return;
  }
  const wallets = await prisma.volumeBotWallet.findMany({
    where: { sessionId: session.id },
    include: { wallet: true },
  });
  const connection = getSolanaConnection();
  const { createCloseAccountInstruction, TOKEN_PROGRAM_ID } =
    await import("@solana/spl-token");
  await mapWithConcurrency(wallets, 2, async (volumeWallet) => {
    const walletKeypair = Keypair.fromSecretKey(
      bs58.decode(volumeWallet.wallet.privateKey)
    );
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      walletKeypair.publicKey,
      { programId: TOKEN_PROGRAM_ID }
    );
    await mapWithConcurrency(tokenAccounts.value, 2, async (account) => {
      const tokenAmount = account.account.data.parsed.info.tokenAmount.amount;
      if (tokenAmount !== "0") {
        return;
      }
      const closeIx = createCloseAccountInstruction(
        account.pubkey,
        walletKeypair.publicKey,
        walletKeypair.publicKey
      );
      let tx = new Transaction().add(closeIx);
      tx = addComputeBudget(tx, 50_000, 10_000);
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.feePayer = walletKeypair.publicKey;
      await sendAndConfirmTransaction(connection, tx, [walletKeypair]);
    });
  });
};
