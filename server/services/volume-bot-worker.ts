import { AnchorProvider, BN } from "@coral-xyz/anchor";
import NodeWallet from "@coral-xyz/anchor/dist/cjs/nodewallet";
import {
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSolanaConnection } from "@/lib/solana/connection";
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
import type { VolumeBotConfigInput } from "@/server/schemas/volume-bot.schema";
import { walletService } from "@/server/services/wallet.service";

type VolumeBotWalletWithRelations = Prisma.VolumeBotWalletGetPayload<{
  include: { session: true; wallet: true };
}>;

type StoredVolumeBotConfig = VolumeBotConfigInput & {
  targetSolApplied?: number;
  targetDurationHours?: number;
};

type VolumeBotAction = "BUY" | "SELL" | "WAIT";

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
  const amount = tokenAccounts.value[0]?.account.data.parsed.info.tokenAmount
    .amount;
  return BigInt(amount ?? "0");
};

const randomBetween = (min: number, max: number) =>
  Math.random() * (max - min) + min;

const FEE_BUFFER_LAMPORTS = 3_000_000;
const SELL_RATIO_BPS = 10_000;

const isFeeError = (error: unknown) => {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("insufficient") ||
    message.includes("not enough") ||
    message.includes("lamports") ||
    message.includes("fee")
  );
};

const computeNextTickAt = (config: VolumeBotConfigInput) => {
  const delaySeconds = Math.floor(
    randomBetween(config.minIntervalSeconds, config.maxIntervalSeconds)
  );
  return new Date(Date.now() + delaySeconds * 1000);
};

const selectAction = (
  buyProbability: number,
  hasTokens: boolean
): VolumeBotAction => {
  if (!hasTokens) {
    return "BUY";
  }
  const clampedBias = Math.min(Math.max(buyProbability, 0), 100);
  return Math.random() * 100 < clampedBias ? "BUY" : "SELL";
};

const applyTradeVariance = (amount: number, variancePct: number) => {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (!Number.isFinite(variancePct) || variancePct <= 0) return amount;
  const variance = Math.min(Math.max(variancePct, 0), 100) / 100;
  const multiplier = 1 + (Math.random() * 2 - 1) * variance;
  return amount * multiplier;
};

const computeTargetTradeSol = (
  config: VolumeBotConfigInput,
  remainingSol: number,
  remainingSeconds: number,
  walletCount: number
) => {
  const absRemaining = Math.abs(remainingSol);
  if (absRemaining <= 0) {
    return 0;
  }
  const avgInterval =
    (config.minIntervalSeconds + config.maxIntervalSeconds) / 2;
  const safeInterval = Math.max(1, avgInterval);
  const ticksRemaining = Math.max(1, Math.ceil(remainingSeconds / safeInterval));
  const effectiveWallets = Math.max(1, walletCount);
  const desiredPerTick = absRemaining / ticksRemaining / effectiveWallets;
  return Math.min(config.maxTradeAmountSol, Math.max(0, desiredPerTick));
};

const computePacedSellRatio = (
  config: VolumeBotConfigInput,
  targetTradeSol: number
) => {
  if (!Number.isFinite(targetTradeSol) || targetTradeSol <= 0) {
    return 0;
  }
  if (!Number.isFinite(config.maxTradeAmountSol) || config.maxTradeAmountSol <= 0) {
    return 0;
  }
  const ratio = targetTradeSol / config.maxTradeAmountSol;
  const scaledRatio = config.sellRatio * Math.min(Math.max(ratio, 0), 1);
  return Math.min(Math.max(scaledRatio, 0), config.sellRatio);
};

export const processVolumeBotWallet = async (
  volumeWallet: VolumeBotWalletWithRelations
): Promise<Date | null> => {
  const walletId = volumeWallet.id;
  const walletPk = volumeWallet.walletPublicKey.slice(0, 8);
  console.log(`[Worker] Processing wallet ${walletPk} (${walletId})`);

  const session = volumeWallet.session;
  if (session.status !== "RUNNING") {
    console.log(`[Worker] Skipping ${walletPk}: session not RUNNING (${session.status})`);
    return null;
  }

  if (session.scheduledStopAt && session.scheduledStopAt <= new Date()) {
    console.log(`[Worker] Session ${session.id} scheduled stop reached`);
    await stopVolumeBotSession(session.id);
    return null;
  }

  if (volumeWallet.status !== "ACTIVE") {
    console.log(`[Worker] Skipping ${walletPk}: wallet not ACTIVE (${volumeWallet.status})`);
    return null;
  }
  if (volumeWallet.wallet.type === "DEV") {
    console.log(`[Worker] Skipping ${walletPk}: DEV wallet not allowed`);
    return null;
  }

  const config = session.config as StoredVolumeBotConfig;
  if (!volumeWallet.nextTickAt) {
    const nextTick = computeNextTickAt(config);
    console.log(`[Worker] ${walletPk}: No nextTickAt, scheduling for ${nextTick.toISOString()}`);
    await prisma.volumeBotWallet.update({
      where: { id: volumeWallet.id },
      data: { nextTickAt: nextTick },
    });
    return nextTick;
  }
  console.log(`[Worker] ${walletPk}: Fetching balances...`);
  const connection = getSolanaConnection();
  const mintPublicKey = new PublicKey(session.tokenPublicKey);
  const walletKeypair = Keypair.fromSecretKey(
    bs58.decode(volumeWallet.wallet.privateKey)
  );

  let solBalanceLamports = await connection.getBalance(
    walletKeypair.publicKey
  );
  const tokenBalance = await getTokenBalance(
    walletKeypair.publicKey,
    mintPublicKey
  );
  const hasTokens = tokenBalance > BigInt(0);

  console.log(`[Worker] ${walletPk}: SOL=${solBalanceLamports / 1e9}, tokens=${tokenBalance}, hasTokens=${hasTokens}`);

  const ensureWalletSol = async (minimumLamports: number) => {
    if (solBalanceLamports >= minimumLamports) {
      return true;
    }
    const shortfallLamports = minimumLamports - solBalanceLamports;
    const topUpLamports = shortfallLamports + FEE_BUFFER_LAMPORTS;
    const topUpSol = topUpLamports / 1_000_000_000;
    try {
      await walletService.sendSolFromMainWallet(
        session.tokenPublicKey,
        session.userId,
        [volumeWallet.walletPublicKey],
        topUpSol
      );
      solBalanceLamports = await connection.getBalance(
        walletKeypair.publicKey
      );
      return solBalanceLamports >= minimumLamports;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Worker] ${walletPk}: Fee top-up failed: ${message}`);
      return false;
    }
  };

  let targetTradeSol: number | null = null;
  let targetDirection: VolumeBotAction | null = null;
  let pacedSellRatio: number | null = null;
  let remainingSolAbs: number | null = null;
  let targetSolAbs: number | null = null;
  if (config.strategy !== "neutral") {
    const targetSol = config.targetSolApplied ?? config.strategyTargetSol ?? 0;
    if (targetSol > 0) {
      const targetSigned = config.strategy === "dump" ? -targetSol : targetSol;
      const progressSol = Number(session.totalPnlSol ?? 0) || 0;
      const targetDurationSeconds =
        config.targetDurationSeconds ??
        (config.targetDurationHours
          ? config.targetDurationHours * 60 * 60
          : null);
      const scheduledStopAt =
        session.scheduledStopAt ??
        (session.startedAt && targetDurationSeconds
          ? new Date(
              session.startedAt.getTime() +
                targetDurationSeconds * 1000
            )
          : null);
      const remainingSeconds = scheduledStopAt
        ? Math.max(0, (scheduledStopAt.getTime() - Date.now()) / 1000)
        : 0;
      if (remainingSeconds <= 0) {
        console.log(`[Worker] Session ${session.id} duration exceeded`);
        await stopVolumeBotSession(session.id);
        return null;
      }
      const remainingSigned = targetSigned - progressSol;
      const remainingSol = Math.abs(remainingSigned);
      if (remainingSol > 0) {
        targetDirection = remainingSigned > 0 ? "BUY" : "SELL";
      }
      remainingSolAbs = remainingSol;
      targetSolAbs = Math.abs(targetSigned);
      const totalWalletCount = Math.max(
        1,
        (config.generatedWalletCount ?? 0) +
          (config.selectedWalletPublicKeys?.length ?? 0)
      );
      const perWalletRemaining = remainingSol / totalWalletCount;
      const baseTradeSol = computeTargetTradeSol(
        config,
        remainingSol,
        remainingSeconds,
        totalWalletCount
      );
      let variedTrade = applyTradeVariance(baseTradeSol, config.tradeVariancePct);
      const maxPacedTradeSol = Math.min(config.maxTradeAmountSol, perWalletRemaining);
      const boundedTrade = Math.min(
        Math.max(0, variedTrade),
        Math.max(0, maxPacedTradeSol)
      );
      targetTradeSol = boundedTrade;
      pacedSellRatio = computePacedSellRatio(config, targetTradeSol);
    }
  }

  const baseBias = Math.min(Math.max(config.buyBiasPct ?? 50, 0), 100);
  let buyProbability = 50;
  if (config.strategy === "dump") {
    buyProbability = 100 - baseBias;
  } else if (config.strategy === "pump") {
    buyProbability = baseBias;
  }
  if (
    targetDirection &&
    remainingSolAbs !== null &&
    targetSolAbs !== null &&
    targetSolAbs > 0
  ) {
    const urgency = Math.min(Math.max(remainingSolAbs / targetSolAbs, 0), 1);
    buyProbability =
      targetDirection === "BUY"
        ? buyProbability + (100 - buyProbability) * urgency
        : buyProbability - buyProbability * urgency;
  }
  const action = selectAction(buyProbability, hasTokens);
  console.log(`[Worker] ${walletPk}: Selected action=${action} (strategy=${config.strategy})`);
  const isTargetAligned = Boolean(targetDirection && action === targetDirection);

  if (action === "WAIT") {
    const nextTick = computeNextTickAt(config);
    console.log(`[Worker] ${walletPk}: WAIT, next tick at ${nextTick.toISOString()}`);
    await prisma.volumeBotWallet.update({
      where: { id: volumeWallet.id },
      data: { nextTickAt: nextTick },
    });
    return nextTick;
  }

  let signature: string | null = null;
  let tradeAmountSol = 0;
  let tokenAmount = BigInt(0);
  let netSolChangeSol = 0;

  try {
    if (action === "BUY") {
      const baseTradeSol =
        targetTradeSol !== null && isTargetAligned
          ? targetTradeSol
          : randomBetween(config.minTradeAmountSol, config.maxTradeAmountSol);
      tradeAmountSol =
        targetTradeSol !== null && isTargetAligned
          ? baseTradeSol
          : applyTradeVariance(baseTradeSol, config.tradeVariancePct);
      tradeAmountSol =
        targetTradeSol !== null && isTargetAligned
          ? Math.min(config.maxTradeAmountSol, Math.max(0, tradeAmountSol))
          : Math.min(
              config.maxTradeAmountSol,
              Math.max(config.minTradeAmountSol, tradeAmountSol)
            );
      if (!isTargetAligned && targetTradeSol !== null) {
        tradeAmountSol = Math.min(
          tradeAmountSol,
          Math.max(0, targetTradeSol)
        );
      }
      if (tradeAmountSol <= 0) {
        const nextTick = computeNextTickAt(config);
        await prisma.volumeBotWallet.update({
          where: { id: volumeWallet.id },
          data: { nextTickAt: nextTick },
        });
        return nextTick;
      }
      const requiredLamports =
        tradeAmountSol * 1_000_000_000 + FEE_BUFFER_LAMPORTS;
      console.log(`[Worker] ${walletPk}: BUY ${tradeAmountSol} SOL, required=${requiredLamports / 1e9}, have=${solBalanceLamports / 1e9}`);

      const hasFunds = await ensureWalletSol(requiredLamports);
      if (!hasFunds) {
        console.log(`[Worker] ${walletPk}: Insufficient balance, skipping`);
        const nextTick = computeNextTickAt(config);
        await prisma.volumeBotWallet.update({
          where: { id: volumeWallet.id },
          data: { nextTickAt: nextTick },
        });
        return nextTick;
      }

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
          config.slippageBps
        );
        const buyQuote = computeBuyQuote(quoteState, buyLamports);
        netSolChangeSol = Number(buyQuote.netSolIn) / 1_000_000_000;
        tokenAmount = buyQuote.tokensOut;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[Worker] ${walletPk}: Slippage quote failed (buy): ${message}`);
      }
      console.log(`[Worker] ${walletPk}: Building buy tx for ${buyLamports} lamports`);
      const buyTx = await buildBuyTokenTransaction(
        walletKeypair,
        mintPublicKey,
        buyLamports,
        undefined,
        minTokensOut
      );
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      buyTx.recentBlockhash = blockhash;
      buyTx.lastValidBlockHeight = lastValidBlockHeight;
      buyTx.feePayer = walletKeypair.publicKey;
      console.log(`[Worker] ${walletPk}: Sending buy tx...`);
      try {
        signature = await sendAndConfirmTransaction(connection, buyTx, [
          walletKeypair,
        ]);
      } catch (error) {
        if (isFeeError(error)) {
          const toppedUp = await ensureWalletSol(requiredLamports);
          if (toppedUp) {
            signature = await sendAndConfirmTransaction(connection, buyTx, [
              walletKeypair,
            ]);
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
      console.log(`[Worker] ${walletPk}: Buy tx confirmed: ${signature}`);
    } else {
      const feeReady = await ensureWalletSol(FEE_BUFFER_LAMPORTS);
      if (!feeReady) {
        console.log(`[Worker] ${walletPk}: Fee shortage, skipping sell`);
        const nextTick = computeNextTickAt(config);
        await prisma.volumeBotWallet.update({
          where: { id: volumeWallet.id },
          data: { nextTickAt: nextTick },
        });
        return nextTick;
      }
      if (targetTradeSol !== null && isTargetAligned) {
        let targetQuoteFailed = false;
        tradeAmountSol = targetTradeSol;
        const desiredNetSolLamports = BigInt(
          Math.floor(targetTradeSol * 1_000_000_000)
        );
        try {
          const quoteState = await fetchPumpQuoteState(
            mintPublicKey,
            walletKeypair
          );
          const estimatedTokens = estimateTokenAmountForNetSolOut(
            quoteState,
            desiredNetSolLamports,
            tokenBalance
          );
          tokenAmount = estimatedTokens > tokenBalance ? tokenBalance : estimatedTokens;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[Worker] ${walletPk}: Target quote failed (sell): ${message}`);
          targetQuoteFailed = true;
        }
        if (targetQuoteFailed && tokenAmount === BigInt(0) && tokenBalance > BigInt(0)) {
          const baseSellRatio = pacedSellRatio ?? config.sellRatio;
          const variedSellRatio = Math.min(
            1,
            Math.max(0, applyTradeVariance(baseSellRatio, config.tradeVariancePct))
          );
          tokenAmount =
            (tokenBalance * BigInt(Math.floor(variedSellRatio * SELL_RATIO_BPS))) /
            BigInt(SELL_RATIO_BPS);
        }
      } else {
        const baseSellRatio =
          pacedSellRatio !== null ? pacedSellRatio : config.sellRatio;
        const variedSellRatio = Math.min(
          1,
          Math.max(0, applyTradeVariance(baseSellRatio, config.tradeVariancePct))
        );
        tokenAmount =
          (tokenBalance * BigInt(Math.floor(variedSellRatio * SELL_RATIO_BPS))) /
          BigInt(SELL_RATIO_BPS);
      }
      console.log(
        `[Worker] ${walletPk}: SELL ${tokenAmount} tokens (${config.sellRatio * 100}% of ${tokenBalance})`
      );

      if (tokenAmount <= BigInt(0)) {
        console.log(`[Worker] ${walletPk}: No tokens to sell, skipping`);
        const nextTick = computeNextTickAt(config);
        await prisma.volumeBotWallet.update({
          where: { id: volumeWallet.id },
          data: { nextTickAt: nextTick },
        });
        return nextTick;
      }
      let minSolOutput = new BN(0);
      try {
        const quoteState = await fetchPumpQuoteState(
          mintPublicKey,
          walletKeypair
        );
        minSolOutput = computeMinSolOutForSell(
          quoteState,
          tokenAmount,
          config.slippageBps
        );
        const sellQuote = computeSellQuote(quoteState, tokenAmount);
        netSolChangeSol = -Number(sellQuote.netSolOut) / 1_000_000_000;
        if (targetTradeSol === null) {
          tradeAmountSol = Math.abs(netSolChangeSol);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[Worker] ${walletPk}: Slippage quote failed (sell): ${message}`);
      }
      const provider = new AnchorProvider(
        connection,
        new NodeWallet(walletKeypair),
        { commitment: "finalized" }
      );
      const program = getPumpProgram(provider);
      console.log(`[Worker] ${walletPk}: Building sell tx...`);
      const sellTx = await sellTokensWithNewIdl(
        program,
        walletKeypair,
        mintPublicKey,
        new BN(tokenAmount.toString()),
        minSolOutput
      );
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      sellTx.recentBlockhash = blockhash;
      sellTx.lastValidBlockHeight = lastValidBlockHeight;
      sellTx.feePayer = walletKeypair.publicKey;
      console.log(`[Worker] ${walletPk}: Sending sell tx...`);
      try {
        signature = await sendAndConfirmTransaction(connection, sellTx, [
          walletKeypair,
        ]);
      } catch (error) {
        if (isFeeError(error)) {
          const toppedUp = await ensureWalletSol(FEE_BUFFER_LAMPORTS);
          if (toppedUp) {
            signature = await sendAndConfirmTransaction(connection, sellTx, [
              walletKeypair,
            ]);
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
      console.log(`[Worker] ${walletPk}: Sell tx confirmed: ${signature}`);
    }

    console.log(`[Worker] ${walletPk}: Updating balances after trade...`);
    const updatedSolLamports = await connection.getBalance(
      walletKeypair.publicKey
    );
    const updatedTokenBalance = await getTokenBalance(
      walletKeypair.publicKey,
      mintPublicKey
    );
    const solDelta =
      (updatedSolLamports - solBalanceLamports) / 1_000_000_000;
    const appliedNetSolChange =
      action === "BUY" ? Math.abs(solDelta) : -Math.abs(solDelta);
    netSolChangeSol = appliedNetSolChange;
    if (action === "SELL" && tradeAmountSol === 0) {
      tradeAmountSol = Math.abs(solDelta);
    }
    const now = new Date();
    const nextTick = computeNextTickAt(config);

    console.log(`[Worker] ${walletPk}: SOL delta=${solDelta}, new SOL=${updatedSolLamports / 1e9}, new tokens=${updatedTokenBalance}`);
    console.log(`[Worker] ${walletPk}: Next tick at ${nextTick.toISOString()}`);

    await prisma.volumeBotWallet.update({
      where: { id: volumeWallet.id },
      data: {
        solBalance: updatedSolLamports / 1_000_000_000,
        tokenBalance: Number(updatedTokenBalance) / 1_000_000,
        tradesExecuted: { increment: 1 },
        lastTradeAt: now,
        nextTickAt: nextTick,
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
          tokenAmount: tokenAmount.toString(),
          netSolChangeSol: appliedNetSolChange,
        },
      },
    });
    console.log(`[Worker] ${walletPk}: Trade complete!`);
    return nextTick;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Worker] ${walletPk}: ERROR - ${message}`);
    if (error instanceof Error && error.stack) {
      console.error(`[Worker] ${walletPk}: Stack:`, error.stack);
    }
    await prisma.volumeBotLog.create({
      data: {
        sessionId: session.id,
        level: "ERROR",
        type: "tick",
        message,
        walletPublicKey: volumeWallet.walletPublicKey,
      },
    });
    const nextTick = computeNextTickAt(config);
    await prisma.volumeBotWallet.update({
      where: { id: volumeWallet.id },
      data: { nextTickAt: nextTick },
    });
    return nextTick;
  }
};

export const stopVolumeBotSession = async (sessionId: string) => {
  console.log(`[Worker] stopVolumeBotSession called for ${sessionId}`);
  const session = await prisma.volumeBotSession.findUnique({
    where: { id: sessionId },
  });
  if (!session || ["STOPPED", "FAILED"].includes(session.status)) {
    console.log(`[Worker] Session ${sessionId} not found or already stopped/failed`);
    return;
  }
  console.log(`[Worker] Stopping session ${sessionId}, status=${session.status}`);

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
  const { createCloseAccountInstruction, TOKEN_PROGRAM_ID } = await import(
    "@solana/spl-token"
  );
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
      const tx = new Transaction().add(closeIx);
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.feePayer = walletKeypair.publicKey;
      await sendAndConfirmTransaction(connection, tx, [walletKeypair]);
    });
  });
};
